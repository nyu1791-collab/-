/* ゆるレンジャー — 横スクロール型ディフェンスゲーム
 *
 * マナをためてユニットを召喚し、敵のとりでを撃破するゲーム。
 * 依存ライブラリなし。描画は Canvas、効果音は WebAudio、保存は localStorage。
 *
 * 構成:
 *   1. ユーティリティ / セーブ
 *   2. 効果音（WebAudio シンセ）
 *   3. ユニット・敵・ステージのデータ定義
 *   4. キャラクター描画（ベクター手描き）
 *   5. 戦闘エンジン（Fighter / Projectile / Battle）
 *   6. 戦場レンダリング（背景・とりで・エフェクト）
 *   7. 画面遷移と DOM HUD
 *   8. メインループ
 */
"use strict";

/* ============================================================
 * 1. ユーティリティ / セーブ
 * ============================================================ */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const TAU = Math.PI * 2;

const SAVE_KEY = "rangers-save-v1";

function defaultSave() {
  return {
    gold: 0, stars: {}, unitLv: {}, sound: true, bgm: true,
    tutorialDone: false, totalKills: 0,
    bestEndless: { time: 0, kills: 0 },
  };
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    return Object.assign(defaultSave(), JSON.parse(raw));
  } catch {
    return defaultSave();
  }
}

const save = loadSave();
function persist() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    /* プライベートモード等では保存できないが続行可能 */
  }
}

function clearedCount() {
  return Object.keys(save.stars).filter((k) => save.stars[k] > 0).length;
}

/* ============================================================
 * 2. 効果音（WebAudio シンセ）
 * ============================================================ */
const SFX = (() => {
  let ctx = null;
  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function tone(freq, dur, { type = "square", vol = 0.12, slide = 0, delay = 0 } = {}) {
    if (!save.sound) return;
    try {
      const a = ac();
      const t0 = a.currentTime + delay;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g).connect(a.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    } catch {
      /* 音が出せなくてもゲームは続行 */
    }
  }
  function noise(dur, { vol = 0.1, delay = 0, low = false } = {}) {
    if (!save.sound) return;
    try {
      const a = ac();
      const t0 = a.currentTime + delay;
      const len = Math.max(1, (dur * a.sampleRate) | 0);
      const buf = a.createBuffer(1, len, a.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = a.createBufferSource();
      src.buffer = buf;
      const g = a.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      let node = src;
      if (low) {
        const f = a.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 420;
        src.connect(f);
        node = f;
      }
      node.connect(g).connect(a.destination);
      src.start(t0);
    } catch {
      /* noop */
    }
  }
  // ---- BGM：32 ステップのチップチューンをループ再生 ----
  const BGM_MELODY = [
    523, 0, 659, 0, 784, 659, 523, 0, 587, 0, 698, 587, 523, 0, 392, 0,
    523, 0, 659, 0, 880, 784, 659, 0, 784, 698, 659, 587, 523, 0, 0, 0,
  ];
  const BGM_BASS = [
    131, 0, 165, 0, 131, 0, 165, 0, 147, 0, 175, 0, 131, 0, 98, 0,
    131, 0, 165, 0, 131, 0, 165, 0, 175, 0, 147, 0, 131, 0, 131, 0,
  ];
  let bgmTimer = null;
  let bgmStep = 0;
  function bgmStart() {
    if (!save.sound || !save.bgm || bgmTimer) return;
    try { ac(); } catch { return; }
    bgmStep = 0;
    bgmTimer = setInterval(() => {
      if (!save.sound || !save.bgm) { bgmStop(); return; }
      const i = bgmStep % BGM_MELODY.length;
      if (BGM_MELODY[i]) tone(BGM_MELODY[i], 0.16, { type: "triangle", vol: 0.04 });
      if (BGM_BASS[i]) tone(BGM_BASS[i], 0.2, { type: "square", vol: 0.028 });
      if (i % 4 === 0) noise(0.025, { vol: 0.012 });
      bgmStep++;
    }, 150);
  }
  function bgmStop() {
    if (bgmTimer) clearInterval(bgmTimer);
    bgmTimer = null;
  }

  return {
    bgmStart,
    bgmStop,
    unlock: () => { try { ac(); } catch { /* noop */ } },
    tap: () => tone(660, 0.06, { type: "triangle", vol: 0.1 }),
    summon: () => { tone(420, 0.08, { type: "triangle", slide: 320 }); noise(0.08, { vol: 0.05 }); },
    hit: () => noise(0.07, { vol: 0.08 }),
    shoot: () => tone(900, 0.07, { type: "sawtooth", vol: 0.05, slide: -500 }),
    magic: () => tone(520, 0.18, { type: "sine", vol: 0.09, slide: 420 }),
    heal: () => { tone(720, 0.12, { type: "sine", vol: 0.08 }); tone(960, 0.14, { type: "sine", vol: 0.08, delay: 0.08 }); },
    towerHit: () => { noise(0.22, { vol: 0.16, low: true }); tone(140, 0.2, { type: "square", vol: 0.07, slide: -60 }); },
    knock: () => tone(220, 0.12, { type: "square", vol: 0.09, slide: -120 }),
    manaUp: () => { tone(523, 0.1, { type: "triangle", vol: 0.1 }); tone(784, 0.14, { type: "triangle", vol: 0.1, delay: 0.07 }); },
    meteor: () => { noise(0.5, { vol: 0.2, low: true }); tone(90, 0.5, { type: "sawtooth", vol: 0.1, slide: -50 }); },
    victory: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: "triangle", vol: 0.12, delay: i * 0.14 })),
    defeat: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, { type: "triangle", vol: 0.1, delay: i * 0.18 })),
  };
})();

/* ============================================================
 * 3. データ定義
 * ============================================================ */

// 味方ユニット。cost=召喚マナ, cd=再召喚までの秒数, interval=攻撃間隔(秒),
// unlock=解放に必要なクリアステージ数（0 は最初から使える）
const UNITS = [
  { key: "mike",  name: "みけ",  look: "cat",    desc: "すばやい近接アタッカー", unlock: 0,
    cost: 40,  cd: 1.4,  hp: 240, atk: 30, range: 28,  interval: 0.7,  speed: 66 },
  { key: "usa",   name: "うさ",  look: "rabbit", desc: "遠くから弓ですないぱー", unlock: 0,
    cost: 85,  cd: 2.6,  hp: 150, atk: 36, range: 195, interval: 1.15, speed: 56, proj: "arrow" },
  { key: "pochi", name: "ぽち",  look: "dog",    desc: "かたい盾やく。前線を守る", unlock: 0,
    cost: 150, cd: 5.0,  hp: 980, atk: 24, range: 30,  interval: 1.2,  speed: 36 },
  { key: "moko",  name: "もこ",  look: "sheep",  desc: "味方をもこもこ回復", unlock: 2,
    cost: 130, cd: 6.0,  hp: 250, atk: 12, range: 150, interval: 1.4,  speed: 50, heal: 50 },
  { key: "fuku",  name: "ふく",  look: "owl",    desc: "魔法で範囲こうげき", unlock: 4,
    cost: 180, cd: 7.0,  hp: 175, atk: 62, range: 215, interval: 1.9,  speed: 46, proj: "orb", aoe: 72 },
  { key: "kuma",  name: "くま",  look: "bear",   desc: "強烈な一撃＋ふっとばし", unlock: 6,
    cost: 280, cd: 11.0, hp: 680, atk: 96, range: 42,  interval: 1.7,  speed: 40, aoeMelee: true, knock: 30, r: 24 },
];

function isUnitUnlocked(u) { return clearedCount() >= (u.unlock || 0); }

// エンドレスモードの解放条件（クリアステージ数）
const ENDLESS_UNLOCK = 4;

// 敵ユニット。bounty=撃破時に得られるマナ, pop=出現枠の消費量（強敵ほど枠を食う）
const ENEMIES = {
  slime:  { key: "slime",  name: "スライム",     look: "slime",  hp: 140,  atk: 18,  range: 26,  interval: 1.0,  speed: 42, bounty: 14, r: 16, pop: 1 },
  bat:    { key: "bat",    name: "こうもり",     look: "bat",    hp: 95,   atk: 15,  range: 24,  interval: 0.8,  speed: 88, bounty: 13, r: 14, pop: 1, fly: true },
  goblin: { key: "goblin", name: "ゴブリン",     look: "goblin", hp: 290,  atk: 34,  range: 30,  interval: 1.1,  speed: 55, bounty: 22, pop: 1 },
  imp:    { key: "imp",    name: "インプ",       look: "imp",    hp: 175,  atk: 28,  range: 178, interval: 1.3,  speed: 50, bounty: 25, pop: 2, proj: "darkArrow" },
  golem:  { key: "golem",  name: "ゴーレム",     look: "golem",  hp: 1150, atk: 56,  range: 36,  interval: 1.6,  speed: 26, bounty: 62, r: 26, pop: 3 },
  witch:  { key: "witch",  name: "まじょ",       look: "witch",  hp: 245,  atk: 52,  range: 205, interval: 1.8,  speed: 44, bounty: 42, pop: 3, proj: "hex", aoe: 62 },
  boss:   { key: "boss",   name: "まおうグラル", look: "demon",  hp: 3600, atk: 110, range: 56,  interval: 1.9,  speed: 30, bounty: 320, r: 30, pop: 6, boss: true, aoeMelee: true, knock: 42 },
};

// ステージ。lineup は [敵キー, 出現重み] の組
const STAGES = [
  { name: "みどりの草原",   lineup: [["slime", 1]],                                            interval: 3.4 },
  { name: "そよかぜ丘",     lineup: [["slime", 3], ["bat", 2]],                                interval: 3.0 },
  { name: "こもれび林道",   lineup: [["slime", 2], ["goblin", 2]],                             interval: 2.9 },
  { name: "ゴブリンの巣",   lineup: [["goblin", 3], ["bat", 2], ["slime", 1]],                 interval: 2.6, rush: true },
  { name: "ささやきの森",   lineup: [["goblin", 2], ["imp", 2], ["slime", 1]],                 interval: 2.6 },
  { name: "きりの沼地",     lineup: [["imp", 2], ["bat", 2], ["goblin", 2]],                   interval: 2.4 },
  { name: "いわかげ峠",     lineup: [["golem", 1], ["goblin", 2], ["imp", 1]],                 interval: 2.7 },
  { name: "番人の石門",     lineup: [["golem", 2], ["imp", 2], ["bat", 2]],                    interval: 2.4, rush: true },
  { name: "まよいの古城",   lineup: [["witch", 2], ["goblin", 2], ["slime", 2]],               interval: 2.3 },
  { name: "やみのほこら",   lineup: [["witch", 2], ["golem", 1], ["imp", 2]],                  interval: 2.3 },
  { name: "まおう街道",     lineup: [["witch", 2], ["golem", 1], ["goblin", 3], ["bat", 2]],   interval: 2.1, rush: true },
  { name: "まおう城・決戦", lineup: [["witch", 2], ["golem", 1], ["imp", 3], ["bat", 1]],      interval: 2.3, boss: true },
];

const STAGE_COUNT = STAGES.length;

function stageEnemyMult(n) { return 1 + (n - 1) * 0.17; }     // n は 1 始まり
function stageTowerHp(n) { return 800 + n * 330; }
function stageReward(n) { return 70 + n * 35; }

const MAX_UNIT_LV = 12;
function unitLevel(key) { return save.unitLv[key] || 1; }
function unitStatMult(key) { return 1 + 0.13 * (unitLevel(key) - 1); }
function upgradeCost(key) { return Math.round((80 * Math.pow(1.55, unitLevel(key) - 1)) / 10) * 10; }

/* ============================================================
 * 4. キャラクター描画
 *  原点 = 足元中央、右向きが正面。スケールや反転は呼び出し側で行う。
 * ============================================================ */
const LOOKS = {
  cat:    { body: "#f7b35c", belly: "#ffe9c7", ear: "cat",    tail: "cat",   weapon: "sword", cheek: "#ff9d7a" },
  rabbit: { body: "#f8f3ff", belly: "#ffffff", ear: "rabbit", weapon: "bow", cheek: "#ffb7c5" },
  dog:    { body: "#cfa06a", belly: "#eed9b8", ear: "flop",   shield: true,  helmet: true },
  sheep:  { body: "#fffdfa", fluffy: "#fff",   ear: "round",  weapon: "heal", cheek: "#ffc9d4" },
  owl:    { body: "#9b7fd4", belly: "#cdbcf0", ear: "tuft",   hat: "wizard", weapon: "staff" },
  bear:   { body: "#a4713f", belly: "#d3a979", ear: "round",  weapon: "club", big: true },
  slime:  { body: "#7ed957", jelly: true },
  bat:    { body: "#6f5bd0", wings: true, ear: "cat" },
  goblin: { body: "#7fae4e", belly: "#a8cf83", ear: "point",  weapon: "club", fang: true },
  imp:    { body: "#e06666", belly: "#f3a6a6", horns: true,   weapon: "bow", fang: true },
  golem:  { body: "#8d8d99", rocky: true, big: true },
  witch:  { body: "#b07fd4", belly: "#d9c2ef", hat: "witch",  weapon: "staff" },
  demon:  { body: "#8a3ab5", belly: "#b977dd", horns: true,   wings: true, weapon: "club", big: true, fang: true },
};

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((((n >> 16) & 255) * f) | 0, 0, 255);
  const g = clamp((((n >> 8) & 255) * f) | 0, 0, 255);
  const b = clamp(((n & 255) * f) | 0, 0, 255);
  return `rgb(${r},${g},${b})`;
}

/**
 * キャラクターを描く。
 * o: { t:経過秒, moving:歩行中か, attackT:攻撃モーション進行0..1(-1で無し),
 *      deadT:死亡演出0..1(-1で無し), flash:被弾白フラッシュ0..1, boss:ボスか }
 */
function drawCharacter(ctx, look, r, o) {
  const L = LOOKS[look];
  const t = o.t || 0;
  const walk = o.moving ? Math.sin(t * 11) : 0;
  const bob = o.moving ? Math.abs(Math.sin(t * 11)) * r * 0.12 : Math.sin(t * 2.4) * r * 0.05;
  const atk = o.attackT >= 0 ? Math.sin(o.attackT * Math.PI) : 0; // 0→1→0 のひと振り

  ctx.save();

  if (o.deadT >= 0) {
    const d = o.deadT;
    ctx.globalAlpha = 1 - d;
    ctx.translate(0, -r * 0.2 * d);
    ctx.rotate(-d * 1.4);
  }

  // 攻撃時に前へ踏み込む
  ctx.translate(atk * r * 0.45, -bob);

  const cy = -r; // 体の中心

  // しっぽ（体より先に描く）
  if (L.tail === "cat") {
    ctx.strokeStyle = shade(L.body, 0.85);
    ctx.lineWidth = r * 0.28;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-r * 0.8, cy + r * 0.5);
    ctx.quadraticCurveTo(-r * 1.5, cy + r * 0.2, -r * 1.3, cy - r * 0.5 + walk * 2);
    ctx.stroke();
  }

  // 羽（こうもり・デーモン）
  if (L.wings) {
    const flap = Math.sin(t * (o.moving ? 14 : 6)) * 0.5;
    ctx.fillStyle = shade(L.body, 0.65);
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(-r * 0.3, cy - r * 0.1);
      ctx.rotate(s * (0.6 + flap));
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-r * 1.3, -r * 0.9 * s, -r * 1.7, r * 0.2 * s);
      ctx.quadraticCurveTo(-r * 1.0, r * 0.1, 0, r * 0.35);
      ctx.fill();
      ctx.restore();
    }
  }

  // 足（ぷにっとした楕円）
  if (!L.jelly && !o.fly) {
    ctx.fillStyle = shade(L.body, 0.8);
    const lw = r * 0.32;
    for (const s of [-1, 1]) {
      const lx = s * r * 0.35 + walk * 3.2 * s;
      ctx.beginPath();
      ctx.ellipse(lx, -lw * 0.5, lw, lw * 0.62, 0, 0, TAU);
      ctx.fill();
    }
  }

  // 体
  ctx.fillStyle = L.body;
  if (L.jelly) {
    // スライム：ぷるぷる変形
    const sq = 1 + Math.sin(t * 8) * 0.08;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.75, r * 1.05 / sq, r * 0.85 * sq, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(-r * 0.3, -r * 1.05, r * 0.3, r * 0.18, -0.4, 0, TAU);
    ctx.fill();
  } else if (L.rocky) {
    // ゴーレム：ごつごつ多角形
    ctx.beginPath();
    const pts = 8;
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * TAU;
      const rr = r * (1 + ((i * 7) % 3) * 0.07);
      const px = Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr * 0.95;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = shade(L.body, 0.7);
    ctx.lineWidth = 2;
    ctx.stroke();
    // ひび
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, cy - r * 0.5);
    ctx.lineTo(0, cy - r * 0.1);
    ctx.lineTo(-r * 0.25, cy + r * 0.3);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.ellipse(0, cy, r, r * 0.95, 0, 0, TAU);
    ctx.fill();
    if (L.fluffy) {
      // ひつじ：もこもこの輪郭
      ctx.fillStyle = L.fluffy;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.78, r * 0.34, 0, TAU);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.ellipse(0, cy, r * 0.85, r * 0.8, 0, 0, TAU);
      ctx.fill();
    }
    if (L.belly) {
      ctx.fillStyle = L.belly;
      ctx.beginPath();
      ctx.ellipse(r * 0.15, cy + r * 0.25, r * 0.55, r * 0.45, 0, 0, TAU);
      ctx.fill();
    }
  }

  // 耳・角
  ctx.fillStyle = L.jelly ? L.body : shade(L.body, 0.92);
  const earY = cy - r * 0.75;
  if (L.ear === "cat" || L.ear === "point") {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * r * 0.25, earY);
      ctx.lineTo(s * r * (L.ear === "point" ? 0.95 : 0.7), earY - r * 0.55);
      ctx.lineTo(s * r * 0.75, earY + r * 0.25);
      ctx.closePath();
      ctx.fill();
    }
  } else if (L.ear === "rabbit") {
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * r * 0.35, earY);
      ctx.rotate(s * 0.22 + walk * 0.06 * s);
      ctx.fillStyle = L.body;
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.7, r * 0.22, r * 0.75, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#ffd2dc";
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.65, r * 0.1, r * 0.45, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  } else if (L.ear === "round") {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * r * 0.55, earY, r * 0.3, 0, TAU);
      ctx.fill();
    }
  } else if (L.ear === "flop") {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * r * 0.62, earY + r * 0.25, r * 0.22, r * 0.5, s * 0.5, 0, TAU);
      ctx.fill();
    }
  } else if (L.ear === "tuft") {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * r * 0.4, earY);
      ctx.lineTo(s * r * 0.62, earY - r * 0.5);
      ctx.lineTo(s * r * 0.8, earY + r * 0.1);
      ctx.closePath();
      ctx.fill();
    }
  }
  if (L.horns) {
    ctx.fillStyle = "#f3e2c0";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * r * 0.35, earY + r * 0.1);
      ctx.quadraticCurveTo(s * r * 0.8, earY - r * 0.5, s * r * 0.55, earY - r * 0.75);
      ctx.quadraticCurveTo(s * r * 0.55, earY - r * 0.2, s * r * 0.15, earY + r * 0.15);
      ctx.fill();
    }
  }

  // 帽子
  if (L.hat === "wizard" || L.hat === "witch") {
    const hc = L.hat === "witch" ? "#5e3a8c" : "#4a3aa8";
    ctx.fillStyle = hc;
    ctx.beginPath();
    ctx.ellipse(0, earY + r * 0.05, r * 0.85, r * 0.22, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, earY);
    ctx.quadraticCurveTo(0, earY - r * 1.5, r * 0.35, earY - r * 1.15);
    ctx.quadraticCurveTo(r * 0.25, earY - r * 0.5, r * 0.5, earY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffd54a";
    ctx.beginPath();
    ctx.arc(r * 0.33, earY - r * 1.12, r * 0.12, 0, TAU);
    ctx.fill();
  }

  // ヘルメット（ぽち）
  if (L.helmet) {
    ctx.fillStyle = "#7d8aa5";
    ctx.beginPath();
    ctx.arc(0, cy - r * 0.25, r * 0.78, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = "#9aa8c4";
    ctx.fillRect(-r * 0.78, cy - r * 0.3, r * 1.56, r * 0.14);
  }

  // 顔
  const ex = r * 0.32;
  const eyeY = cy - r * 0.12;
  ctx.fillStyle = "#2c2333";
  if (o.deadT >= 0) {
    // やられ顔（ばつ目）
    ctx.strokeStyle = "#2c2333";
    ctx.lineWidth = r * 0.09;
    for (const s of [-0.15, 0.6]) {
      const cx0 = r * s + r * 0.1;
      ctx.beginPath();
      ctx.moveTo(cx0 - r * 0.12, eyeY - r * 0.12);
      ctx.lineTo(cx0 + r * 0.12, eyeY + r * 0.12);
      ctx.moveTo(cx0 + r * 0.12, eyeY - r * 0.12);
      ctx.lineTo(cx0 - r * 0.12, eyeY + r * 0.12);
      ctx.stroke();
    }
  } else {
    const blink = (t % 3.4) > 3.25 ? 0.15 : 1;
    for (const s of [0.05, 1]) {
      ctx.beginPath();
      ctx.ellipse(ex * 0.4 + ex * s, eyeY, r * 0.11, r * 0.14 * blink, 0, 0, TAU);
      ctx.fill();
    }
    // 口
    ctx.strokeStyle = "#2c2333";
    ctx.lineWidth = r * 0.07;
    ctx.beginPath();
    if (L.fang) {
      ctx.moveTo(r * 0.45, cy + r * 0.28);
      ctx.lineTo(r * 0.75, cy + r * 0.22);
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(r * 0.52, cy + r * 0.26);
      ctx.lineTo(r * 0.6, cy + r * 0.42);
      ctx.lineTo(r * 0.68, cy + r * 0.25);
      ctx.fill();
    } else {
      ctx.arc(r * 0.6, cy + r * 0.2, r * 0.12, 0.2, Math.PI - 0.4);
      ctx.stroke();
    }
    // ほっぺ
    if (L.cheek) {
      ctx.fillStyle = L.cheek;
      ctx.globalAlpha *= 0.7;
      ctx.beginPath();
      ctx.ellipse(ex * 0.1, cy + r * 0.18, r * 0.14, r * 0.09, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha /= 0.7;
    }
  }

  // 武器・盾
  const handX = r * 0.85;
  const handY = cy + r * 0.3;
  if (L.weapon === "sword") {
    ctx.save();
    ctx.translate(handX, handY);
    ctx.rotate(-0.5 + atk * 1.9);
    ctx.fillStyle = "#cdd6e4";
    ctx.fillRect(-r * 0.07, -r * 1.15, r * 0.14, r * 1.0);
    ctx.fillStyle = "#8b6230";
    ctx.fillRect(-r * 0.2, -r * 0.18, r * 0.4, r * 0.3);
    ctx.restore();
  } else if (L.weapon === "club") {
    ctx.save();
    ctx.translate(handX, handY);
    ctx.rotate(-0.9 + atk * 2.2);
    ctx.strokeStyle = "#8b6230";
    ctx.lineWidth = r * 0.18;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -r * 0.95);
    ctx.stroke();
    ctx.fillStyle = "#6e4a20";
    ctx.beginPath();
    ctx.arc(0, -r * 1.0, r * 0.3, 0, TAU);
    ctx.fill();
    ctx.restore();
  } else if (L.weapon === "bow") {
    ctx.save();
    ctx.translate(handX, handY - r * 0.2);
    ctx.strokeStyle = "#8b6230";
    ctx.lineWidth = r * 0.1;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, -Math.PI / 2.4, Math.PI / 2.4);
    ctx.stroke();
    ctx.strokeStyle = "#eee";
    ctx.lineWidth = r * 0.05;
    const pull = atk * r * 0.4;
    ctx.beginPath();
    ctx.moveTo(Math.cos(-Math.PI / 2.4) * r * 0.55, Math.sin(-Math.PI / 2.4) * r * 0.55);
    ctx.lineTo(-pull, 0);
    ctx.lineTo(Math.cos(Math.PI / 2.4) * r * 0.55, Math.sin(Math.PI / 2.4) * r * 0.55);
    ctx.stroke();
    ctx.restore();
  } else if (L.weapon === "staff" || L.weapon === "heal") {
    ctx.save();
    ctx.translate(handX, handY);
    ctx.rotate(-0.25 + atk * 0.6);
    ctx.strokeStyle = "#8b6230";
    ctx.lineWidth = r * 0.12;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, r * 0.3);
    ctx.lineTo(0, -r * 1.0);
    ctx.stroke();
    const orb = L.weapon === "heal" ? "#7ce7a2" : "#ffd54a";
    ctx.fillStyle = orb;
    ctx.beginPath();
    ctx.arc(0, -r * 1.1, r * 0.22 + atk * r * 0.12, 0, TAU);
    ctx.fill();
    if (atk > 0.3) {
      ctx.globalAlpha *= 0.5;
      ctx.beginPath();
      ctx.arc(0, -r * 1.1, r * (0.3 + atk * 0.4), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
  if (L.shield) {
    ctx.save();
    ctx.translate(r * 0.95, cy + r * 0.25);
    ctx.fillStyle = "#b9c6dd";
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.3, r * 0.55, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#7d8aa5";
    ctx.lineWidth = r * 0.1;
    ctx.stroke();
    ctx.fillStyle = "#ffd54a";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.12, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // 被弾フラッシュ
  if (o.flash > 0) {
    ctx.globalAlpha = o.flash * 0.75;
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(0, cy, r * 1.5, r * 1.6, 0, 0, TAU);
    ctx.fill();
  }

  ctx.restore();
}

/* ============================================================
 * 5. 戦闘エンジン
 * ============================================================ */
const WORLD_W = 1600;       // 戦場のワールド幅
const WORLD_H = 540;        // デザイン上の高さ（キャンバスに合わせて拡縮）
const GROUND_Y = 460;       // 地面の基準線
const TOWER_HALF = 46;      // とりでの当たり判定半幅
const PLAYER_TOWER_X = 90;
const ENEMY_TOWER_X = WORLD_W - 90;
const MAX_ALLIES = 18;      // 重くならないよう召喚上限

class Fighter {
  constructor(spec, side, x, mult) {
    this.spec = spec;
    this.side = side;                       // 1=味方(右へ), -1=敵(左へ)
    this.x = x;
    this.yOff = rand(-16, 16);              // 奥行き表現のレーンずれ
    this.r = spec.r || 18;
    this.halfW = this.r * 0.9;
    this.maxHp = Math.round(spec.hp * mult.hp);
    this.hp = this.maxHp;
    this.atk = Math.round(spec.atk * mult.atk);
    this.heal = spec.heal ? Math.round(spec.heal * mult.atk) : 0;
    this.atkTimer = spec.interval * 0.4;    // 召喚直後に即攻撃しない
    this.animT = rand(0, 10);
    this.attackAnim = -1;                   // 0..1 で攻撃モーション
    this.deadT = -1;
    this.flash = 0;
    this.moving = false;
    this.fly = !!spec.fly;
  }

  get alive() { return this.deadT < 0; }
  get feetY() { return GROUND_Y + this.yOff - (this.fly ? 46 + Math.sin(this.animT * 3) * 6 : 0); }

  takeDamage(dmg, battle, knock = 0) {
    if (!this.alive) return;
    this.hp -= dmg;
    this.flash = 1;
    battle.addPopup(this.x, this.feetY - this.r * 2.4, `${dmg}`, this.side === 1 ? "#ff8d9d" : "#fff");
    battle.addHitSpark(this.x, this.feetY - this.r);
    if (knock > 0) {
      this.x = clamp(this.x - this.side * knock, PLAYER_TOWER_X + 10, ENEMY_TOWER_X - 10);
      this.atkTimer = Math.max(this.atkTimer, 0.35);
    }
    if (this.hp <= 0) {
      this.deadT = 0;
      battle.onDeath(this);
    }
  }

  update(dt, battle) {
    this.animT += dt;
    this.flash = Math.max(0, this.flash - dt * 5);
    if (!this.alive) {
      this.deadT += dt * 1.7;
      return;
    }
    if (this.attackAnim >= 0) {
      this.attackAnim += dt / 0.28;
      if (this.attackAnim >= 1) this.attackAnim = -1;
    }
    this.atkTimer -= dt;

    // 回復役：傷ついた味方が射程内にいれば最優先で回復
    if (this.heal > 0) {
      const ally = battle.findHealTarget(this);
      if (ally) {
        this.moving = false;
        if (this.atkTimer <= 0) {
          this.atkTimer = this.spec.interval;
          this.attackAnim = 0;
          ally.hp = Math.min(ally.maxHp, ally.hp + this.heal);
          battle.addPopup(ally.x, ally.feetY - ally.r * 2.4, `+${this.heal}`, "#7ce7a2");
          battle.addHealSpark(ally.x, ally.feetY - ally.r);
          SFX.heal();
        }
        return;
      }
    }

    const target = battle.findTarget(this);
    if (target) {
      this.moving = false;
      if (this.atkTimer <= 0) {
        this.atkTimer = this.spec.interval;
        this.attackAnim = 0;
        if (this.spec.proj) {
          battle.addProjectile(this, target);
          this.spec.proj === "arrow" || this.spec.proj === "darkArrow" ? SFX.shoot() : SFX.magic();
        } else if (this.spec.aoeMelee) {
          battle.meleeAoe(this);
          SFX.knock();
        } else {
          battle.dealDamage(this, target, this.atk);
          SFX.hit();
        }
      }
    } else {
      this.moving = true;
      this.x = clamp(
        this.x + this.side * this.spec.speed * dt,
        PLAYER_TOWER_X + 6,
        ENEMY_TOWER_X - 6
      );
    }
  }
}

class Battle {
  constructor(stageNo, opts = {}) {
    this.endless = !!opts.endless;
    this.stageNo = stageNo;                 // 1 始まり（エンドレスは 0）
    this.stage = this.endless
      ? { name: "エンドレス", interval: 2.7,
          lineup: [["slime", 2], ["bat", 2], ["goblin", 2], ["imp", 2], ["golem", 1], ["witch", 1]] }
      : STAGES[stageNo - 1];
    this.time = 0;
    this.kills = 0;
    this.summons = 0;
    this.fighters = [];
    this.projectiles = [];
    this.particles = [];
    this.popups = [];
    this.shake = 0;
    this.over = null;                       // { win, t }

    this.playerTower = { x: PLAYER_TOWER_X, halfW: TOWER_HALF, hp: 1200, maxHp: 1200, isTower: true, side: 1, shake: 0 };
    this.enemyTower = this.endless
      // エンドレスは敵側が「破壊できないポータル」。守り抜いた時間を競う
      ? { x: ENEMY_TOWER_X, halfW: TOWER_HALF, hp: Infinity, maxHp: Infinity, isTower: true, side: -1, shake: 0, portal: true }
      : { x: ENEMY_TOWER_X, halfW: TOWER_HALF, hp: stageTowerHp(stageNo), maxHp: stageTowerHp(stageNo), isTower: true, side: -1, shake: 0 };
    this.nextMiniBoss = 75;                 // エンドレス：定期的にボス級が出現

    // マナ
    this.manaLv = 1;
    this.mana = 80;
    this.cardCd = UNITS.map(() => 0);

    // 必殺技（メテオ）
    this.skillCdMax = 45;
    this.skillCd = 20;

    // 敵スポーン管理
    this.spawnTimer = 4.5;                  // 開始直後の猶予
    this.rushAt = 40;
    this.bossSpawned = false;
    this.bossPauseUntil = 0;

    // 出現テーブル（重み展開）
    this.pool = [];
    for (const [key, w] of this.stage.lineup) {
      for (let i = 0; i < w; i++) this.pool.push(ENEMIES[key]);
    }
  }

  // 敵の強さ。エンドレスは時間とともに際限なく強くなる
  enemyMult() {
    return this.endless ? 1 + this.time * 0.011 : stageEnemyMult(this.stageNo);
  }

  get manaMax() { return 350 + (this.manaLv - 1) * 110; }
  get manaRegen() { return 14 + (this.manaLv - 1) * 7; }
  get manaUpCost() { return 70 * this.manaLv; }
  get manaUpMaxed() { return this.manaLv >= 6; }

  allies() { return this.fighters.filter((f) => f.side === 1 && f.alive); }
  foesOf(side) { return this.fighters.filter((f) => f.side !== side && f.alive); }
  towerOf(side) { return side === 1 ? this.enemyTower : this.playerTower; }

  summon(idx) {
    const spec = UNITS[idx];
    if (!isUnitUnlocked(spec)) return false;
    if (this.over || this.cardCd[idx] > 0 || this.mana < spec.cost) return false;
    if (this.allies().length >= MAX_ALLIES) return false;
    this.mana -= spec.cost;
    this.cardCd[idx] = spec.cd;
    this.summons++;
    const m = unitStatMult(spec.key);
    const f = new Fighter(spec, 1, PLAYER_TOWER_X + TOWER_HALF + 14, { hp: m, atk: m });
    this.fighters.push(f);
    this.addPoof(f.x, f.feetY - f.r);
    SFX.summon();
    return true;
  }

  upgradeMana() {
    if (this.over || this.manaUpMaxed || this.mana < this.manaUpCost) return;
    this.mana -= this.manaUpCost;
    this.manaLv++;
    SFX.manaUp();
  }

  fireSkill() {
    if (this.over || this.skillCd > 0) return;
    this.skillCd = this.skillCdMax;
    SFX.meteor();
    const foes = this.foesOf(1);
    // 敵がいる位置＋敵陣に向けて 4 発のメテオを落とす
    const xs = [];
    for (let i = 0; i < 4; i++) {
      const base = foes.length ? pick(foes).x : lerp(WORLD_W * 0.45, ENEMY_TOWER_X, i / 3);
      xs.push(clamp(base + rand(-60, 60), 200, ENEMY_TOWER_X));
    }
    for (const x of xs) {
      this.projectiles.push({
        kind: "meteor", side: 1,
        x: x + 120, y: -80, tx: x, ty: GROUND_Y,
        vx: -124, vy: 560, dmg: 300, aoe: 95,
      });
    }
  }

  // 場にいる敵の「出現枠」合計。強敵が湧きすぎて物量で詰むのを防ぐ
  alivePop() {
    return this.fighters.reduce((n, f) => n + (f.side === -1 && f.alive ? (f.spec.pop || 1) : 0), 0);
  }

  canSpawn(spec) {
    return this.alivePop() + (spec.pop || 1) <= this.enemyCap();
  }

  spawnEnemy(spec, multScale = 1, force = false) {
    if (!force && !this.canSpawn(spec)) return false;
    const m = this.enemyMult() * multScale;
    const f = new Fighter(spec, -1, ENEMY_TOWER_X - TOWER_HALF - 14, { hp: m, atk: m });
    this.fighters.push(f);
    this.addPoof(f.x, f.feetY - f.r, "#caa8ff");
    return true;
  }

  /* ---- 索敵 ---- */
  findTarget(f) {
    let best = null;
    let bestD = Infinity;
    const consider = (o) => {
      const d = (o.x - f.x) * f.side - (o.halfW + f.halfW);
      if (d <= f.spec.range && (o.x - f.x) * f.side > -6 && d < bestD) {
        bestD = d;
        best = o;
      }
    };
    for (const e of this.foesOf(f.side)) consider(e);
    consider(this.towerOf(f.side));
    return best;
  }

  findHealTarget(f) {
    let best = null;
    let worst = 0.92; // ほぼ満タンの味方は無視
    for (const a of this.fighters) {
      if (a.side !== f.side || !a.alive || a === f) continue;
      if (Math.abs(a.x - f.x) > f.spec.range + a.halfW) continue;
      const ratio = a.hp / a.maxHp;
      if (ratio < worst) {
        worst = ratio;
        best = a;
      }
    }
    return best;
  }

  /* ---- ダメージ処理 ---- */
  dealDamage(src, target, dmg, knock = 0) {
    if (target.isTower) {
      target.hp -= dmg;
      target.shake = 1;
      this.shake = Math.max(this.shake, 4);
      this.addPopup(target.x, GROUND_Y - 180, `${dmg}`, "#ffd54a");
      SFX.towerHit();
      this.checkEnd();
    } else {
      target.takeDamage(dmg, this, knock);
    }
  }

  meleeAoe(src) {
    const hitR = src.spec.range + src.halfW + 30;
    let any = false;
    for (const e of this.foesOf(src.side)) {
      if ((e.x - src.x) * src.side > -10 && Math.abs(e.x - src.x) <= hitR + e.halfW) {
        e.takeDamage(src.atk, this, src.spec.knock || 0);
        any = true;
      }
    }
    const tower = this.towerOf(src.side);
    if (Math.abs(tower.x - src.x) <= hitR + tower.halfW) {
      this.dealDamage(src, tower, src.atk);
      any = true;
    }
    if (any) this.shake = Math.max(this.shake, 3);
  }

  addProjectile(src, target) {
    const y = src.feetY - src.r * 1.2;
    this.projectiles.push({
      kind: src.spec.proj, side: src.side,
      x: src.x + src.side * src.r, y,
      target, lastX: target.x, lastY: target.isTower ? GROUND_Y - 90 : target.feetY - target.r,
      speed: 430, dmg: src.atk, aoe: src.spec.aoe || 0, trail: 0,
    });
  }

  onDeath(f) {
    this.addPoof(f.x, f.feetY - f.r, f.side === 1 ? "#ffe3b3" : "#caa8ff");
    if (f.side === -1) {
      this.kills++;
      this.mana = Math.min(this.manaMax, this.mana + f.spec.bounty);
      this.addPopup(f.x, f.feetY - f.r * 2.8, `+${f.spec.bounty}マナ`, "#7ce7ff");
    }
  }

  checkEnd() {
    if (this.over) return;
    if (this.enemyTower.hp <= 0) {
      this.enemyTower.hp = 0;
      this.over = { win: true, t: 0 };
      this.addConfetti(ENEMY_TOWER_X, GROUND_Y - 120);
      SFX.victory();
    } else if (this.playerTower.hp <= 0) {
      this.playerTower.hp = 0;
      this.over = { win: false, t: 0 };
      SFX.defeat();
    }
  }

  /* ---- エフェクト ---- */
  addPopup(x, y, text, color) {
    this.popups.push({ x, y, text, color, t: 0 });
    if (this.popups.length > 40) this.popups.shift();
  }
  addParticle(p) {
    this.particles.push(p);
    if (this.particles.length > 220) this.particles.shift();
  }
  addPoof(x, y, color = "#fff") {
    for (let i = 0; i < 7; i++) {
      const a = rand(0, TAU);
      this.addParticle({ x, y, vx: Math.cos(a) * rand(20, 70), vy: Math.sin(a) * rand(20, 70) - 30, r: rand(4, 9), t: 0, life: 0.5, color, fade: true });
    }
  }
  addHitSpark(x, y) {
    for (let i = 0; i < 4; i++) {
      this.addParticle({ x, y, vx: rand(-90, 90), vy: rand(-130, -30), r: rand(2, 4), t: 0, life: 0.35, color: "#ffd54a", grav: 500 });
    }
  }
  addHealSpark(x, y) {
    for (let i = 0; i < 5; i++) {
      this.addParticle({ x: x + rand(-14, 14), y: y + rand(-8, 8), vx: rand(-10, 10), vy: rand(-70, -40), r: rand(2.5, 5), t: 0, life: 0.7, color: "#7ce7a2", fade: true });
    }
  }
  addConfetti(x, y) {
    const colors = ["#ffd54a", "#7ce7a2", "#7ce7ff", "#ff8d9d", "#caa8ff"];
    for (let i = 0; i < 50; i++) {
      this.addParticle({ x: x + rand(-60, 60), y: y + rand(-60, 0), vx: rand(-160, 160), vy: rand(-260, -60), r: rand(3, 6), t: 0, life: rand(0.8, 1.6), color: pick(colors), grav: 320, fade: true });
    }
  }

  /* ---- 敵スポーンのスケジューリング ---- */
  // 同時に存在できる敵の上限。物量で詰まないようにするための安全弁
  enemyCap() {
    return this.endless ? 20 : Math.min(14, 8 + Math.floor(this.stageNo / 2));
  }

  updateSpawns(dt) {
    if (this.over) return;
    this.spawnTimer -= dt;

    // エンドレス：定期的にボス級（弱体化版）が乱入。枠は無視して登場する
    if (this.endless && this.time >= this.nextMiniBoss) {
      this.nextMiniBoss += 85;
      this.spawnEnemy(ENEMIES.boss, 0.5, true);
      this.shake = 7;
      SFX.meteor();
    }

    // ボスステージ：30 秒でボス登場、その間ザコは一時停止
    // （ボスはステージ補正をやや弱めて受ける。素の能力が十分高いため）
    if (this.stage.boss && !this.bossSpawned && this.time >= 30) {
      this.bossSpawned = true;
      this.bossPauseUntil = this.time + 9;
      this.spawnEnemy(ENEMIES.boss, 0.7, true);
      this.shake = 8;
      SFX.meteor();
    }
    if (this.time < this.bossPauseUntil) return;

    // ラッシュステージ：一定間隔でまとめて出現（枠が空いている分だけ）
    if (this.stage.rush && this.time >= this.rushAt) {
      this.rushAt += 38;
      for (let i = 0; i < 4; i++) {
        const spec = pick(this.pool);
        setTimeoutSafe(() => { if (!this.over) this.spawnEnemy(spec); }, i * 350);
      }
    }

    if (this.spawnTimer <= 0) {
      // 時間とともに出現間隔を詰めて圧力を上げる（通常ステージは下限あり）
      const floor = this.endless ? 1.1 : 1.5;
      const interval = Math.max(floor, this.stage.interval - this.time * 0.012);
      // 枠に収まる敵だけが候補。すべて埋まっていれば少し待つ
      const candidates = this.pool.filter((s) => this.canSpawn(s));
      if (candidates.length === 0) {
        this.spawnTimer = 0.5;
      } else {
        this.spawnTimer = interval * rand(0.8, 1.2);
        this.spawnEnemy(pick(candidates));
      }
    }
  }

  update(dt) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 14);
    this.playerTower.shake = Math.max(0, this.playerTower.shake - dt * 4);
    this.enemyTower.shake = Math.max(0, this.enemyTower.shake - dt * 4);

    if (!this.over) {
      this.mana = Math.min(this.manaMax, this.mana + this.manaRegen * dt);
      this.skillCd = Math.max(0, this.skillCd - dt);
      for (let i = 0; i < this.cardCd.length; i++) this.cardCd[i] = Math.max(0, this.cardCd[i] - dt);
      this.updateSpawns(dt);
    } else {
      this.over.t += dt;
    }

    for (const f of this.fighters) f.update(dt, this);
    this.fighters = this.fighters.filter((f) => f.deadT < 1);

    // 弾の更新
    for (const p of this.projectiles) {
      p.trail = (p.trail || 0) + dt;
      if (p.kind === "meteor") {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y >= p.ty) {
          p.done = true;
          this.shake = Math.max(this.shake, 7);
          SFX.towerHit();
          for (let i = 0; i < 10; i++) {
            this.addParticle({ x: p.tx + rand(-30, 30), y: GROUND_Y - rand(0, 30), vx: rand(-140, 140), vy: rand(-260, -60), r: rand(3, 7), t: 0, life: 0.6, color: pick(["#ff9d5c", "#ffd54a", "#9c5c33"]), grav: 600 });
          }
          for (const e of this.foesOf(p.side)) {
            if (Math.abs(e.x - p.tx) <= p.aoe + e.halfW) e.takeDamage(p.dmg, this, 18);
          }
          const tower = this.towerOf(p.side);
          if (Math.abs(tower.x - p.tx) <= p.aoe + tower.halfW) this.dealDamage(null, tower, Math.round(p.dmg * 0.5));
        }
        continue;
      }
      // 通常弾：目標（消滅後は最後の位置）へ追尾
      const tx = p.target && (p.target.isTower || p.target.alive) ? p.target.x : p.lastX;
      const ty = p.target && (p.target.isTower || p.target.alive)
        ? (p.target.isTower ? GROUND_Y - 90 : p.target.feetY - p.target.r)
        : p.lastY;
      p.lastX = tx;
      p.lastY = ty;
      const dx = tx - p.x;
      const dy = ty - p.y;
      const dist = Math.hypot(dx, dy);
      const step = p.speed * dt;
      if (dist <= step + 4) {
        p.done = true;
        const live = p.target && (p.target.isTower ? p.target.hp > 0 : p.target.alive);
        if (p.aoe) {
          for (const e of this.foesOf(p.side)) {
            if (Math.abs(e.x - tx) <= p.aoe + e.halfW) e.takeDamage(p.dmg, this);
          }
          const tower = this.towerOf(p.side);
          if (Math.abs(tower.x - tx) <= p.aoe + tower.halfW) this.dealDamage(null, tower, p.dmg);
          this.addPoof(tx, ty, p.kind === "hex" ? "#caa8ff" : "#ffd54a");
        } else if (live) {
          this.dealDamage(null, p.target, p.dmg);
          if (!p.target.isTower) SFX.hit();
        }
      } else {
        p.x += (dx / dist) * step;
        p.y += (dy / dist) * step;
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.done);

    // パーティクル / ポップアップ
    for (const p of this.particles) {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.grav) p.vy += p.grav * dt;
    }
    this.particles = this.particles.filter((p) => p.t < p.life);
    for (const p of this.popups) p.t += dt;
    this.popups = this.popups.filter((p) => p.t < 0.9);
  }
}

// ポーズ中に発火しないよう、戦闘内の遅延はゲーム時間ではなく実時間+生存チェックで簡易に行う
function setTimeoutSafe(fn, ms) { setTimeout(fn, ms); }

/* ============================================================
 * 6. 戦場レンダリング
 * ============================================================ */
const canvas = document.getElementById("field");
const fctx = canvas.getContext("2d");

const camera = { x: 0, manualUntil: 0 };

let viewScale = 1;
let viewW = WORLD_W;

function resizeCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  viewScale = (rect.height / WORLD_H) * dpr;
  viewW = canvas.width / viewScale;
}
window.addEventListener("resize", resizeCanvas);

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBackground(ctx, camX, t) {
  // 空
  const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  sky.addColorStop(0, "#8ed4ff");
  sky.addColorStop(0.6, "#cfeeff");
  sky.addColorStop(1, "#eafff0");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, viewW, WORLD_H);

  // 太陽
  ctx.fillStyle = "#fff3b0";
  ctx.beginPath();
  ctx.arc(viewW * 0.82 - camX * 0.05, 80, 38, 0, TAU);
  ctx.fill();

  // 雲（ゆっくり流れる）
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  for (let i = 0; i < 5; i++) {
    const cx = ((i * 380 + t * 12 - camX * 0.25) % (viewW + 300)) - 150;
    const cy = 60 + (i % 3) * 46;
    for (const [ox, oy, r] of [[0, 0, 26], [24, 6, 20], [-24, 8, 18]]) {
      ctx.beginPath();
      ctx.arc(cx + ox, cy + oy, r, 0, TAU);
      ctx.fill();
    }
  }

  // 遠景の山
  ctx.fillStyle = "#a8d8b9";
  for (let i = -1; i < viewW / 220 + 2; i++) {
    const bx = i * 220 - ((camX * 0.4) % 220);
    ctx.beginPath();
    ctx.moveTo(bx - 130, GROUND_Y - 30);
    ctx.quadraticCurveTo(bx, GROUND_Y - 190 - (i % 2) * 40, bx + 130, GROUND_Y - 30);
    ctx.fill();
  }

  // 地面
  const grd = ctx.createLinearGradient(0, GROUND_Y - 40, 0, WORLD_H);
  grd.addColorStop(0, "#8fce6e");
  grd.addColorStop(1, "#5ba84a");
  ctx.fillStyle = grd;
  ctx.fillRect(0, GROUND_Y - 28, viewW, WORLD_H - GROUND_Y + 28);

  // 草むらのアクセント
  ctx.fillStyle = "rgba(70, 140, 60, 0.45)";
  for (let i = 0; i < viewW / 90 + 2; i++) {
    const gx = i * 90 - (camX % 90);
    ctx.beginPath();
    ctx.ellipse(gx, GROUND_Y + 26, 34, 8, 0, 0, TAU);
    ctx.fill();
  }
}

function drawTower(ctx, tower, isPlayer, t) {
  const x = tower.x;

  // エンドレスの「やみのポータル」：破壊不能。渦と瘴気だけ描く
  if (tower.portal) {
    ctx.save();
    ctx.translate(x, GROUND_Y - 90);
    for (let i = 3; i >= 1; i--) {
      ctx.save();
      ctx.rotate(t * (i % 2 ? 0.9 : -0.7));
      ctx.fillStyle = `rgba(${110 + i * 30}, ${40 + i * 18}, ${160 + i * 22}, ${0.32 + i * 0.16})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, 26 * i + Math.sin(t * 3 + i) * 4, 34 * i, 0.5, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = "#1a0a2e";
    ctx.beginPath();
    ctx.ellipse(0, 0, 22, 30, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    // 立ちのぼる瘴気
    ctx.fillStyle = "rgba(150, 90, 200, 0.35)";
    for (let i = 0; i < 3; i++) {
      const sy = GROUND_Y - 140 - ((t * 26 + i * 44) % 130);
      ctx.beginPath();
      ctx.arc(x + Math.sin(t * 2 + i * 2) * 16, sy, 9 + i * 3, 0, TAU);
      ctx.fill();
    }
    return;
  }

  const destroyed = tower.hp <= 0;
  const shake = tower.shake > 0 ? Math.sin(t * 60) * tower.shake * 3 : 0;
  ctx.save();
  ctx.translate(x + shake, GROUND_Y);

  if (destroyed) {
    // がれき
    ctx.fillStyle = isPlayer ? "#9c7b4f" : "#5d5d6e";
    for (const [ox, oy, w, h] of [[-40, -26, 36, 26], [-4, -20, 42, 20], [-22, -44, 30, 20]]) {
      roundRect(ctx, ox, oy, w, h, 5);
      ctx.fill();
    }
    // 煙
    ctx.fillStyle = "rgba(120,120,130,0.5)";
    for (let i = 0; i < 3; i++) {
      const sy = -50 - ((t * 30 + i * 40) % 120);
      ctx.beginPath();
      ctx.arc(((i - 1) * 14), sy, 14 + i * 4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  if (isPlayer) {
    // 木のとりで
    ctx.fillStyle = "#b08a55";
    roundRect(ctx, -46, -150, 92, 150, 10);
    ctx.fill();
    ctx.fillStyle = "#9c7b4f";
    for (let i = 0; i < 4; i++) ctx.fillRect(-46, -150 + 12 + i * 36, 92, 6);
    // とんがり屋根
    ctx.fillStyle = "#e06a5a";
    ctx.beginPath();
    ctx.moveTo(-58, -150);
    ctx.lineTo(0, -208);
    ctx.lineTo(58, -150);
    ctx.closePath();
    ctx.fill();
    // 旗
    ctx.strokeStyle = "#6e4a20";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -208);
    ctx.lineTo(0, -244);
    ctx.stroke();
    ctx.fillStyle = "#ffd54a";
    ctx.beginPath();
    ctx.moveTo(0, -244);
    ctx.quadraticCurveTo(26 + Math.sin(t * 4) * 4, -238, 30, -230);
    ctx.lineTo(0, -226);
    ctx.closePath();
    ctx.fill();
    // 扉
    ctx.fillStyle = "#6e4a20";
    roundRect(ctx, -16, -44, 32, 44, 8);
    ctx.fill();
  } else {
    // 敵の石塔
    ctx.fillStyle = "#6b6b7e";
    roundRect(ctx, -46, -170, 92, 170, 8);
    ctx.fill();
    ctx.fillStyle = "#57576a";
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        ctx.fillRect(-40 + col * 30 + (row % 2) * 8, -160 + row * 32, 22, 12);
      }
    }
    // ギザギザの上部
    ctx.fillStyle = "#6b6b7e";
    for (let i = 0; i < 4; i++) ctx.fillRect(-46 + i * 26, -186, 16, 18);
    // どくろの旗
    ctx.strokeStyle = "#3c3c4a";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -186);
    ctx.lineTo(0, -226);
    ctx.stroke();
    ctx.fillStyle = "#4a2a66";
    ctx.beginPath();
    ctx.moveTo(0, -226);
    ctx.quadraticCurveTo(-28 - Math.sin(t * 4) * 4, -220, -32, -210);
    ctx.lineTo(0, -206);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#eee";
    ctx.beginPath();
    ctx.arc(-16, -216, 5, 0, TAU);
    ctx.fill();
    // 暗い入口
    ctx.fillStyle = "#2c2333";
    roundRect(ctx, -14, -40, 28, 40, 6);
    ctx.fill();
  }
  ctx.restore();

  // HP バー
  const ratio = clamp(tower.hp / tower.maxHp, 0, 1);
  const barW = 110;
  const by = GROUND_Y - (isPlayer ? 262 : 248);
  ctx.fillStyle = "rgba(20, 12, 40, 0.75)";
  roundRect(ctx, x - barW / 2 - 3, by - 3, barW + 6, 18, 8);
  ctx.fill();
  ctx.fillStyle = ratio > 0.4 ? "#7ce7a2" : "#ff6b81";
  roundRect(ctx, x - barW / 2, by, Math.max(2, barW * ratio), 12, 6);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${Math.max(0, Math.ceil(tower.hp))}`, x, by + 11 + 14);
}

function drawFighter(ctx, f) {
  ctx.save();
  ctx.translate(f.x, f.feetY);

  // 影
  ctx.fillStyle = "rgba(40, 70, 35, 0.3)";
  ctx.beginPath();
  ctx.ellipse(0, GROUND_Y + f.yOff - f.feetY + 2, f.r * 0.9, f.r * 0.26, 0, 0, TAU);
  ctx.fill();

  if (f.side === -1) ctx.scale(-1, 1); // 敵は左向き
  drawCharacter(ctx, f.spec.look, f.r, {
    t: f.animT,
    moving: f.moving && f.alive,
    attackT: f.attackAnim,
    deadT: f.deadT,
    flash: f.flash,
    fly: f.fly,
  });
  ctx.restore();

  // HP バー（満タン時は出さない）
  if (f.alive && f.hp < f.maxHp) {
    const w = f.r * 2.2;
    const y = f.feetY - f.r * 2.55;
    ctx.fillStyle = "rgba(20, 12, 40, 0.7)";
    roundRect(ctx, f.x - w / 2 - 1, y - 1, w + 2, 6, 3);
    ctx.fill();
    ctx.fillStyle = f.side === 1 ? "#7ce7a2" : "#ff6b81";
    roundRect(ctx, f.x - w / 2, y, Math.max(1, w * (f.hp / f.maxHp)), 4, 2);
    ctx.fill();
  }
}

function drawProjectile(ctx, p) {
  ctx.save();
  if (p.kind === "meteor") {
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(p.vy, p.vx));
    // 尾
    const grad = ctx.createLinearGradient(-46, 0, 10, 0);
    grad.addColorStop(0, "rgba(255, 157, 92, 0)");
    grad.addColorStop(1, "rgba(255, 213, 74, 0.9)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-48, -7);
    ctx.lineTo(8, -11);
    ctx.lineTo(8, 11);
    ctx.lineTo(-48, 7);
    ctx.fill();
    ctx.fillStyle = "#9c5c33";
    ctx.beginPath();
    ctx.arc(6, 0, 12, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ff9d5c";
    ctx.beginPath();
    ctx.arc(6, 0, 7, 0, TAU);
    ctx.fill();
  } else if (p.kind === "arrow" || p.kind === "darkArrow") {
    const dx = p.lastX - p.x;
    const dy = p.lastY - p.y;
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.strokeStyle = p.kind === "arrow" ? "#8b6230" : "#4a2a66";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(8, 0);
    ctx.stroke();
    ctx.fillStyle = p.kind === "arrow" ? "#cdd6e4" : "#caa8ff";
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(4, -4);
    ctx.lineTo(4, 4);
    ctx.fill();
  } else {
    // 魔法弾（orb / hex）
    const col = p.kind === "hex" ? "#caa8ff" : "#ffd54a";
    ctx.translate(p.x, p.y);
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(0, 0, 11 + Math.sin(p.trail * 20) * 2, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function renderBattle(battle, t) {
  resizeCanvasIfNeeded();
  fctx.setTransform(viewScale, 0, 0, viewScale, 0, 0);

  // カメラ：手動操作後しばらくはそのまま、それ以外は前線を追従
  if (performance.now() < camera.manualUntil) {
    /* ドラッグ位置を維持 */
  } else {
    let front = PLAYER_TOWER_X;
    for (const f of battle.fighters) if (f.side === 1 && f.alive) front = Math.max(front, f.x);
    const want = clamp(front - viewW * 0.38, 0, Math.max(0, WORLD_W - viewW));
    camera.x = lerp(camera.x, want, 0.04);
  }
  camera.x = clamp(camera.x, 0, Math.max(0, WORLD_W - viewW));

  const shakeX = battle.shake > 0 ? rand(-battle.shake, battle.shake) : 0;
  const shakeY = battle.shake > 0 ? rand(-battle.shake, battle.shake) : 0;

  drawBackground(fctx, camera.x, t);

  fctx.save();
  fctx.translate(-camera.x + shakeX, shakeY);

  drawTower(fctx, battle.playerTower, true, t);
  drawTower(fctx, battle.enemyTower, false, t);

  // 奥のユニットから描く
  const sorted = [...battle.fighters].sort((a, b) => a.yOff - b.yOff);
  for (const f of sorted) drawFighter(fctx, f);

  for (const p of battle.projectiles) drawProjectile(fctx, p);

  for (const p of battle.particles) {
    fctx.globalAlpha = p.fade ? clamp(1 - p.t / p.life, 0, 1) : clamp(1.4 - p.t / p.life, 0, 1);
    fctx.fillStyle = p.color;
    fctx.beginPath();
    fctx.arc(p.x, p.y, p.r, 0, TAU);
    fctx.fill();
  }
  fctx.globalAlpha = 1;

  for (const p of battle.popups) {
    const a = clamp(1 - p.t / 0.9, 0, 1);
    fctx.globalAlpha = a;
    fctx.font = "bold 17px sans-serif";
    fctx.textAlign = "center";
    fctx.lineWidth = 4;
    fctx.strokeStyle = "rgba(20, 12, 40, 0.8)";
    const py = p.y - p.t * 42;
    fctx.strokeText(p.text, p.x, py);
    fctx.fillStyle = p.color;
    fctx.fillText(p.text, p.x, py);
  }
  fctx.globalAlpha = 1;

  fctx.restore();

  // エンドレス：生存タイムと撃破数を表示
  if (battle.endless) {
    fctx.font = "bold 26px sans-serif";
    fctx.textAlign = "center";
    fctx.lineWidth = 5;
    fctx.strokeStyle = "rgba(20, 12, 40, 0.8)";
    const label = `⏱ ${fmtTime(battle.time)}  ／  💀 ${battle.kills}`;
    fctx.strokeText(label, viewW / 2, 44);
    fctx.fillStyle = "#fff";
    fctx.fillText(label, viewW / 2, 44);
  }

  // 勝敗の帯
  if (battle.over) {
    const a = clamp(battle.over.t / 0.4, 0, 1);
    fctx.fillStyle = `rgba(13, 7, 30, ${a * 0.45})`;
    fctx.fillRect(0, WORLD_H * 0.34, viewW, WORLD_H * 0.2);
    fctx.fillStyle = battle.over.win ? "#ffd54a" : "#ff8d9d";
    fctx.font = "bold 52px sans-serif";
    fctx.textAlign = "center";
    fctx.globalAlpha = a;
    fctx.fillText(
      battle.over.win ? "とりで撃破！" : battle.endless ? "ちからつきた…" : "ぼうえい失敗…",
      viewW / 2, WORLD_H * 0.47
    );
    fctx.globalAlpha = 1;
  }
}

let lastCanvasW = 0;
let lastCanvasH = 0;
function resizeCanvasIfNeeded() {
  const rect = canvas.parentElement.getBoundingClientRect();
  if (rect.width !== lastCanvasW || rect.height !== lastCanvasH) {
    lastCanvasW = rect.width;
    lastCanvasH = rect.height;
    resizeCanvas();
  }
}

/* ---- カメラのドラッグ操作 ---- */
let dragLastX = null;
canvas.addEventListener("pointerdown", (e) => {
  if (game.mode !== "battle") return;
  dragLastX = e.clientX;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (dragLastX === null || game.mode !== "battle") return;
  const rect = canvas.parentElement.getBoundingClientRect();
  const worldPerPx = viewW / rect.width;
  camera.x = clamp(camera.x - (e.clientX - dragLastX) * worldPerPx, 0, Math.max(0, WORLD_W - viewW));
  dragLastX = e.clientX;
  camera.manualUntil = performance.now() + 2600;
});
const endDrag = () => { dragLastX = null; };
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

/* ============================================================
 * 7. 画面遷移と DOM HUD
 * ============================================================ */
const $ = (id) => document.getElementById(id);
const screens = ["title-screen", "select-screen", "upgrade-screen", "achv-screen", "result-screen", "pause-screen"];

function showScreen(id) {
  for (const s of screens) $(s).classList.toggle("visible", s === id);
  const inBattle = id === null || id === "pause-screen";
  $("hud").style.display = inBattle ? "flex" : "none";
  $("battle-top").style.display = id === null ? "flex" : "none";
}

const game = {
  mode: "menu",        // menu | battle | paused | over
  battle: null,
  speed: 1,
  upgradeFrom: "title", // 強化画面からの戻り先
  resultStage: 1,
  tutorial: null,       // チュートリアル表示中のステップ番号
};

/* ---- ミニキャラアイコンをカードに描く ---- */
function paintIcon(cv, look, r) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = cv.clientWidth || 42;
  cv.width = size * dpr;
  cv.height = size * dpr;
  const c = cv.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.translate(size / 2, size * 0.88);
  const s = (size * 0.42) / r;
  c.scale(s, s);
  drawCharacter(c, look, r, { t: 0.6, moving: false, attackT: -1, deadT: -1, flash: 0 });
}

/* ---- ユニットカード ---- */
const cardEls = [];
function buildCards() {
  const row = $("card-row");
  row.innerHTML = "";
  cardEls.length = 0;
  UNITS.forEach((u, i) => {
    const btn = document.createElement("button");
    const locked = !isUnitUnlocked(u);
    btn.className = "unit-card" + (locked ? " locked" : "");
    btn.innerHTML = `
      <span class="u-lv">${locked ? "" : `Lv${unitLevel(u.key)}`}</span>
      <canvas></canvas>
      <span class="u-name">${u.name}</span>
      <span class="u-cost">${locked ? `ステージ${u.unlock}クリア` : u.cost}</span>
      ${locked ? '<span class="u-lock">🔒</span>' : ""}
      <div class="cd-mask"></div>`;
    if (!locked) {
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (game.mode === "battle") game.battle.summon(i);
      });
    }
    row.appendChild(btn);
    paintIcon(btn.querySelector("canvas"), u.look, u.r || 18);
    cardEls.push(btn);
  });

  const skill = document.createElement("button");
  skill.id = "skill-btn";
  skill.innerHTML = `<span class="s-icon">☄️</span><span class="s-label">メテオ</span><div class="cd-mask"></div>`;
  skill.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (game.mode === "battle") game.battle.fireSkill();
  });
  row.appendChild(skill);
}

function updateHud() {
  const b = game.battle;
  if (!b) return;
  $("mana-fill").style.width = `${(b.mana / b.manaMax) * 100}%`;
  $("mana-text").textContent = `${Math.floor(b.mana)} / ${b.manaMax}  (Lv${b.manaLv})`;
  const up = $("mana-up");
  if (b.manaUpMaxed) {
    up.disabled = true;
    $("mana-up-cost").textContent = "MAX";
  } else {
    up.disabled = b.mana < b.manaUpCost || !!b.over;
    $("mana-up-cost").textContent = `${b.manaUpCost} マナ`;
  }
  cardEls.forEach((el, i) => {
    const u = UNITS[i];
    if (!isUnitUnlocked(u)) return;
    el.classList.toggle("unaffordable", b.mana < u.cost || !!b.over);
    el.querySelector(".cd-mask").style.height = `${(b.cardCd[i] / u.cd) * 100}%`;
  });
  const skill = $("skill-btn");
  if (skill) {
    skill.disabled = b.skillCd > 0 || !!b.over;
    skill.querySelector(".cd-mask").style.height = `${(b.skillCd / b.skillCdMax) * 100}%`;
  }
}

/* ---- ステージ選択 ---- */
function buildStageGrid() {
  const grid = $("stage-grid");
  grid.innerHTML = "";
  const unlocked = clearedCount() + 1;
  for (let n = 1; n <= STAGE_COUNT; n++) {
    const node = document.createElement("button");
    node.className = "stage-node";
    const stars = save.stars[n] || 0;
    const locked = n > unlocked;
    if (locked) node.classList.add("locked");
    node.innerHTML = `
      <span class="n">${locked ? "🔒" : n}</span>
      ${STAGES[n - 1].boss ? '<span class="boss-mark">BOSS</span>' : ""}
      <span class="stars">${stars ? "★".repeat(stars) + "☆".repeat(3 - stars) : locked ? "" : "ー"}</span>`;
    if (!locked) {
      node.addEventListener("click", () => {
        SFX.tap();
        startBattle(n);
      });
    }
    grid.appendChild(node);
  }

  // エンドレスモード（ステージ4クリアで解放）
  const endless = document.createElement("button");
  const endlessLocked = clearedCount() < ENDLESS_UNLOCK;
  endless.className = "stage-node endless" + (endlessLocked ? " locked" : "");
  const best = save.bestEndless;
  endless.innerHTML = endlessLocked
    ? `<span class="n">🔒 エンドレスモード</span><span class="best">ステージ${ENDLESS_UNLOCK}クリアで解放</span>`
    : `<span class="n">🌀 エンドレスモード</span>
       <span class="best">${best.time > 0 ? `さいこうきろく ⏱ ${fmtTime(best.time)} ／ 💀 ${best.kills}たい` : "おしよせる敵からどこまで守れる？"}</span>`;
  if (!endlessLocked) {
    endless.addEventListener("click", () => {
      SFX.tap();
      startBattle(0);
    });
  }
  grid.appendChild(endless);

  $("gold-label").textContent = save.gold;
}

/* ---- 強化 ---- */
function buildUpgradeList() {
  const list = $("upgrade-list");
  list.innerHTML = "";
  $("upgrade-gold-label").textContent = save.gold;
  for (const u of UNITS) {
    const lv = unitLevel(u.key);
    const cost = upgradeCost(u.key);
    const maxed = lv >= MAX_UNIT_LV;
    const locked = !isUnitUnlocked(u);
    const m = unitStatMult(u.key);
    const row = document.createElement("div");
    row.className = "up-row";
    if (locked) row.style.opacity = "0.55";
    row.innerHTML = `
      <canvas></canvas>
      <div class="up-info">
        <div class="nm">${locked ? "？？？" : u.name} <small>${locked ? "" : `Lv${lv}`}</small></div>
        <div class="desc">${locked ? `ステージ${u.unlock}をクリアすると仲間になる` : u.desc}</div>
        <div class="st">${locked ? "" : `HP ${Math.round(u.hp * m)} ／ こうげき ${Math.round((u.heal || u.atk) * m)}${u.heal ? "(回復)" : ""}`}</div>
      </div>
      <button class="up-btn">${locked ? "🔒" : maxed ? "MAX" : `🪙 ${cost}`}</button>`;
    const btn = row.querySelector(".up-btn");
    btn.disabled = locked || maxed || save.gold < cost;
    btn.addEventListener("click", () => {
      if (locked || maxed || save.gold < cost) return;
      save.gold -= cost;
      save.unitLv[u.key] = lv + 1;
      persist();
      SFX.manaUp();
      buildUpgradeList();
    });
    list.appendChild(row);
    if (locked) row.querySelector("canvas").style.filter = "grayscale(1) brightness(0.4)";
    paintIcon(row.querySelector("canvas"), u.look, u.r || 18);
  }
}

/* ---- 戦闘の開始と終了 ---- */
// stageNo: 1〜12 が通常ステージ、0 はエンドレスモード
function startBattle(stageNo) {
  game.battle = new Battle(stageNo, { endless: stageNo === 0 });
  game.mode = "battle";
  game.speed = 1;
  game.resultStage = stageNo;
  $("speed-btn").textContent = "x1";
  camera.x = 0;
  camera.manualUntil = 0;
  buildCards();
  showScreen(null);
  SFX.bgmStart();
  if (!save.tutorialDone) showTutorial(0);
}

function finishBattle() {
  const b = game.battle;
  const n = b.stageNo;
  game.mode = "over";
  SFX.bgmStop();
  save.totalKills += b.kills;

  const statsLine = `たたかいの記録：⏱ ${fmtTime(b.time)} ／ 💀 ${b.kills}たい撃破 ／ 召喚 ${b.summons}回`;
  let gold = 0;

  if (b.endless) {
    // エンドレス：生存時間がスコア。ベスト更新を判定
    gold = Math.min(500, b.kills * 2 + Math.floor(b.time));
    const isBest = b.time > save.bestEndless.time;
    if (isBest) save.bestEndless = { time: Math.floor(b.time), kills: b.kills };
    $("result-title").textContent = "ここまで守り抜いた！";
    $("result-stars").textContent = isBest ? "🏆 ベスト更新！" : "";
    $("result-detail").innerHTML =
      `${statsLine}<br />ベスト：⏱ ${fmtTime(save.bestEndless.time)} ／ 💀 ${save.bestEndless.kills}たい<br />かくとく：🪙 ${gold} G`;
    $("result-next-btn").style.display = "none";
  } else if (b.over.win) {
    const ratio = b.playerTower.hp / b.playerTower.maxHp;
    const stars = ratio >= 0.85 ? 3 : ratio >= 0.45 ? 2 : 1;
    gold = stageReward(n);
    const firstClear = !(save.stars[n] > 0);
    if (firstClear) gold *= 2;
    save.stars[n] = Math.max(save.stars[n] || 0, stars);

    // このクリアで新ユニットやモードが解放されたか
    const nowCleared = clearedCount();
    const unlockedUnit = firstClear ? UNITS.find((u) => u.unlock === nowCleared) : null;
    const unlockedEndless = firstClear && nowCleared === ENDLESS_UNLOCK;
    let unlockMsg = "";
    if (unlockedUnit) unlockMsg += `<br />🎉 新ユニット「${unlockedUnit.name}」が仲間になった！`;
    if (unlockedEndless) unlockMsg += `<br />🌀 エンドレスモードが解放された！`;

    $("result-title").textContent = "ステージクリア！";
    $("result-stars").textContent = "★".repeat(stars) + "☆".repeat(3 - stars);
    $("result-detail").innerHTML =
      `とりでの残り体力 ${Math.ceil(ratio * 100)}%<br />${statsLine}<br />` +
      `かくとく：🪙 ${gold} G${firstClear ? "（初クリア×2！）" : ""}${unlockMsg}`;
    $("result-next-btn").style.display = n < STAGE_COUNT ? "block" : "none";
  } else {
    gold = 15;
    $("result-title").textContent = "ぼうえい失敗…";
    $("result-stars").textContent = "";
    $("result-detail").innerHTML = `ざんねん！部隊を強化して再挑戦しよう。<br />${statsLine}<br />なぐさめ：🪙 ${gold} G`;
    $("result-next-btn").style.display = "none";
  }
  save.gold += gold;
  persist();
  showScreen("result-screen");
}

/* ---- チュートリアル ---- */
const TUTORIAL_STEPS = [
  "ようこそ、ゆるレンジャーへ！ わたしたちのとりで（左）を守りながら、敵のとりで（右）を撃破するのが目標だよ。",
  "下の青いゲージは「マナ」。時間でどんどんたまるよ。カードをタップすると、マナを使ってユニットを召喚！",
  "「⚡マナ強化」でマナの回復が速くなる。じっくり強化するか、すぐ召喚するかはキミしだい！",
  "ピンチのときは「☄️メテオ」！ 敵全体に大ダメージだ。画面のドラッグで戦場を見渡せるよ。それじゃ、まかせた！",
];

function showTutorial(step) {
  game.tutorial = step;
  $("tutorial-text").textContent = TUTORIAL_STEPS[step];
  $("tutorial-overlay").classList.add("visible");
}

function advanceTutorial() {
  if (game.tutorial === null) return;
  SFX.tap();
  if (game.tutorial + 1 < TUTORIAL_STEPS.length) {
    showTutorial(game.tutorial + 1);
  } else {
    game.tutorial = null;
    $("tutorial-overlay").classList.remove("visible");
    save.tutorialDone = true;
    persist();
  }
}

/* ---- 実績 ---- */
const ACHIEVEMENTS = [
  { icon: "🐣", name: "はじめの一歩",       desc: "ステージ1をクリアする",        test: () => (save.stars[1] || 0) > 0 },
  { icon: "🛡️", name: "草原の守り手",       desc: "ステージ4をクリアする",        test: () => (save.stars[4] || 0) > 0 },
  { icon: "🗿", name: "石門とっぱ",         desc: "ステージ8をクリアする",        test: () => (save.stars[8] || 0) > 0 },
  { icon: "👑", name: "まおう討伐",         desc: "ステージ12をクリアする",       test: () => (save.stars[12] || 0) > 0 },
  { icon: "⭐", name: "パーフェクト",       desc: "どこかのステージを★3でクリア", test: () => Object.values(save.stars).some((s) => s >= 3) },
  { icon: "🌟", name: "スターコレクター",   desc: "全ステージで★3を取る",         test: () => STAGES.every((_, i) => (save.stars[i + 1] || 0) >= 3) },
  { icon: "⚒️", name: "きたえあげる",       desc: "ユニットをLv5にする",          test: () => Object.values(save.unitLv).some((l) => l >= 5) },
  { icon: "🏃", name: "サバイバー",         desc: "エンドレスで3分間生きのびる",  test: () => save.bestEndless.time >= 180 },
  { icon: "💀", name: "せんりゃくハンター", desc: "つうさん500たい撃破する",      test: () => save.totalKills >= 500 },
];

function buildAchvList() {
  const totalStars = Object.values(save.stars).reduce((a, b) => a + b, 0);
  $("achv-summary").innerHTML =
    `つうさん撃破：💀 ${save.totalKills}たい ／ あつめた星：⭐ ${totalStars} / ${STAGE_COUNT * 3}` +
    (save.bestEndless.time > 0 ? `<br />エンドレスきろく：⏱ ${fmtTime(save.bestEndless.time)}` : "");
  const list = $("achv-list");
  list.innerHTML = "";
  for (const a of ACHIEVEMENTS) {
    const done = a.test();
    const row = document.createElement("div");
    row.className = "achv-row" + (done ? " done" : "");
    row.innerHTML = `
      <span class="a-icon">${a.icon}</span>
      <div class="a-info"><div class="a-name">${a.name}</div><div class="a-desc">${a.desc}</div></div>
      <span class="a-state">${done ? "✅" : "・"}</span>`;
    list.appendChild(row);
  }
}

/* ---- ボタン類 ---- */
function wireUi() {
  const tap = (id, fn) => $(id).addEventListener("click", () => { SFX.unlock(); SFX.tap(); fn(); });

  tap("start-btn", () => { buildStageGrid(); showScreen("select-screen"); game.mode = "menu"; });
  tap("title-upgrade-btn", () => { game.upgradeFrom = "title"; buildUpgradeList(); showScreen("upgrade-screen"); });
  tap("select-upgrade-btn", () => { game.upgradeFrom = "select"; buildUpgradeList(); showScreen("upgrade-screen"); });
  tap("select-back-btn", () => showScreen("title-screen"));
  tap("upgrade-back-btn", () => {
    if (game.upgradeFrom === "select") { buildStageGrid(); showScreen("select-screen"); }
    else showScreen("title-screen");
  });

  tap("achv-btn", () => { buildAchvList(); showScreen("achv-screen"); });
  tap("achv-back-btn", () => showScreen("title-screen"));

  tap("sound-btn", () => {
    save.sound = !save.sound;
    persist();
    $("sound-btn").textContent = save.sound ? "🔊 効果音：オン" : "🔇 効果音：オフ";
  });
  $("sound-btn").textContent = save.sound ? "🔊 効果音：オン" : "🔇 効果音：オフ";

  tap("bgm-btn", () => {
    save.bgm = !save.bgm;
    persist();
    $("bgm-btn").textContent = save.bgm ? "🎵 BGM：オン" : "🎵 BGM：オフ";
  });
  $("bgm-btn").textContent = save.bgm ? "🎵 BGM：オン" : "🎵 BGM：オフ";

  $("tutorial-overlay").addEventListener("click", advanceTutorial);

  tap("pause-btn", () => {
    if (game.mode !== "battle") return;
    game.mode = "paused";
    SFX.bgmStop();
    showScreen("pause-screen");
  });
  tap("resume-btn", () => {
    game.mode = "battle";
    showScreen(null);
    SFX.bgmStart();
  });
  tap("giveup-btn", () => {
    game.battle = null;
    game.mode = "menu";
    SFX.bgmStop();
    buildStageGrid();
    showScreen("select-screen");
  });
  tap("speed-btn", () => {
    game.speed = game.speed === 1 ? 2 : 1;
    $("speed-btn").textContent = `x${game.speed}`;
  });

  tap("result-retry-btn", () => startBattle(game.resultStage));
  tap("result-next-btn", () => startBattle(Math.min(STAGE_COUNT, game.resultStage + 1)));
  tap("result-map-btn", () => {
    game.battle = null;
    game.mode = "menu";
    buildStageGrid();
    showScreen("select-screen");
  });

  $("mana-up").addEventListener("click", () => {
    if (game.mode === "battle") game.battle.upgradeMana();
  });

  // バックグラウンドに回ったら自動ポーズ（チュートリアル中はすでに時間停止している）
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && game.mode === "battle" && game.tutorial === null) {
      game.mode = "paused";
      SFX.bgmStop();
      showScreen("pause-screen");
    }
  });

  // 長押しメニューがゲーム操作を妨げないように
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  // キーボード操作（PC向け）：1〜6=召喚, Space=メテオ, M=マナ強化, P=ポーズ, S=倍速
  document.addEventListener("keydown", (e) => {
    if (game.tutorial !== null) { advanceTutorial(); return; }
    if (game.mode === "paused" && (e.key === "p" || e.key === "P")) { $("resume-btn").click(); return; }
    if (game.mode !== "battle" || !game.battle) return;
    if (e.key >= "1" && e.key <= "6") game.battle.summon(Number(e.key) - 1);
    else if (e.key === " ") { e.preventDefault(); game.battle.fireSkill(); }
    else if (e.key === "m" || e.key === "M") game.battle.upgradeMana();
    else if (e.key === "p" || e.key === "P") $("pause-btn").click();
    else if (e.key === "s" || e.key === "S") $("speed-btn").click();
  });
}

/* ---- タイトル画面のにぎやかし ---- */
function renderTitleScene(t) {
  const cv = $("title-canvas");
  const c = cv.getContext("2d");
  const W = cv.width;
  const H = cv.height;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, W, H);

  // 草原と空
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#8ed4ff");
  sky.addColorStop(1, "#cfeeff");
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H * 0.72);
  c.fillStyle = "#8fce6e";
  c.fillRect(0, H * 0.72, W, H * 0.28);
  c.fillStyle = "#fff3b0";
  c.beginPath();
  c.arc(W * 0.85, H * 0.2, 30, 0, TAU);
  c.fill();

  const gy = H * 0.8;
  const cast = [
    ["cat", W * 0.18, 20], ["rabbit", W * 0.32, 18], ["bear", W * 0.47, 24],
  ];
  cast.forEach(([look, x, r], i) => {
    c.save();
    c.translate(x, gy + Math.abs(Math.sin(t * 3 + i)) * -8);
    c.scale(2, 2);
    drawCharacter(c, look, r, { t: t + i, moving: false, attackT: -1, deadT: -1, flash: 0 });
    c.restore();
  });
  // 対峙するスライム
  c.save();
  c.translate(W * 0.8, gy + Math.abs(Math.sin(t * 4 + 2)) * -6);
  c.scale(-2, 2);
  drawCharacter(c, "slime", 16, { t, moving: false, attackT: -1, deadT: -1, flash: 0 });
  c.restore();
}

/* ============================================================
 * 8. メインループ
 * ============================================================ */
let lastTs = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  const realDt = Math.min(0.05, (ts - lastTs) / 1000 || 0);
  lastTs = ts;
  const t = ts / 1000;

  if (game.mode === "battle" && game.battle) {
    const b = game.battle;
    // 決着後はスローモーションで余韻を見せる。チュートリアル中は時間停止
    const slow = b.over ? 0.35 : 1;
    if (game.tutorial === null) b.update(realDt * game.speed * slow);
    renderBattle(b, t);
    updateHud();
    if (b.over && b.over.t > 1.6) finishBattle();
  } else if (game.mode === "paused" && game.battle) {
    renderBattle(game.battle, t);
  } else if ($("title-screen").classList.contains("visible")) {
    renderTitleScene(t);
  }
}

resizeCanvas();
wireUi();
buildCards();
showScreen("title-screen");
requestAnimationFrame(frame);

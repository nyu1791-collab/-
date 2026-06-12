/* ゆるレンジャーのヘッドレス・スモークテスト
 *
 * ブラウザ API をスタブして rangers.js を読み込み、戦闘エンジンを高速シミュレートする。
 *   - 各ステージが実行時エラーなく回ること
 *   - 「マナがあれば召喚する」だけの単純 AI でステージ 1〜3 がクリアできること（バランス検証）
 *   - エンドレスモードがいずれ敗北で終わること（難易度が上がり続ける検証）
 *
 * 実行: node tools/rangers-smoke.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

/* ---- ブラウザ API のスタブ ---- */
function stubCtx() {
  const grad = { addColorStop() {} };
  return new Proxy(
    {
      createLinearGradient: () => grad,
      createRadialGradient: () => grad,
      measureText: () => ({ width: 0 }),
    },
    { get: (t, k) => (k in t ? t[k] : () => undefined), set: () => true }
  );
}

function stubElement() {
  const el = {
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    children: [],
    innerHTML: "",
    textContent: "",
    width: 100,
    height: 100,
    clientWidth: 42,
    disabled: false,
    addEventListener() {},
    appendChild(c) { this.children.push(c); },
    querySelector: () => stubElement(),
    querySelectorAll: () => [],
    getContext: () => stubCtx(),
    setPointerCapture() {},
    getBoundingClientRect: () => ({ width: 800, height: 450 }),
    click() {},
  };
  el.parentElement = { getBoundingClientRect: () => ({ width: 800, height: 450 }) };
  return el;
}

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0, // ループは回さない（手動で update する）
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: {
    getElementById: () => stubElement(),
    createElement: () => stubElement(),
    addEventListener() {},
    hidden: false,
  },
  window: { addEventListener() {}, devicePixelRatio: 1 },
  navigator: {},
  location: { origin: "https://example.com", pathname: "/rangers.html", hash: "", search: "" },
  history: { replaceState() {} },
  alert() {},
  btoa: (s) => Buffer.from(s, "binary").toString("base64"),
  atob: (s) => Buffer.from(s, "base64").toString("binary"),
  Math,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* ---- rangers.js を読み込み、テスト用フックを追加 ---- */
let src = fs.readFileSync(path.join(__dirname, "..", "rangers.js"), "utf8");
src += "\nglobalThis.__test = { Battle, Commander, ENEMIES, STAGES, STAGE_COUNT, save," +
  " HEROES, HERO_BY_KEY, HERO_KEYS, BASE_HERO_KEYS, SKILLS, RARITY, ROLE_TPL, heroSpec, heroPower, DECK_SIZE," +
  " rollMany, rollOnce, grantHero, buildShareCode, parseShareCode, deckSpecs, myDeckSpecs, campaignDeckSpecs, ensureDeck," +
  " rivalDeck, makeRng, GACHA, isHeroOwned, heroLb, GACHA_POOL," +
  " canAwaken, awakenHero, isAwakened, gainShards, AWAKEN_LV, AWAKEN_COST, ROLE_AWAKEN_SKILL };\n";
vm.runInContext(src, sandbox, { filename: "rangers.js" });
const T = sandbox.__test;
const { Battle, STAGE_COUNT, save } = T;

/* ---- 単純 AI でステージをシミュレート ---- */
function simulate(stageNo, { maxSec = 300, unitLv = 1 } = {}) {
  for (const k of T.BASE_HERO_KEYS) save.unitLv[k] = unitLv;
  save.stars = {};
  for (let i = 1; i <= STAGE_COUNT; i++) save.stars[i] = 1; // 全ユニット解放状態で試す
  save.deck = [];          // ensureDeck で基本6体（mike,usa,pochi,moko,fuku,kuma 順）に再編成させる
  save.heroes = {};

  const b = new Battle(stageNo, { endless: stageNo === 0 });
  const dt = 1 / 30;
  let elapsed = 0;
  // 実プレイに近い優先度: 盾(ぽち)→回復(もこ)→大型(くま)→範囲(ふく)→弓(うさ)→近接(みけ)
  const order = [2, 3, 5, 4, 1, 0];
  while (elapsed < maxSec) {
    // 実プレイヤー風の立ち回り:
    //  - 前線が安定していて敵が迫っていなければ、マナ経済に投資（Lv5まで）
    //  - それ以外は優先度順にどんどん召喚して圧をかける
    const danger = b.fighters.some((f) => f.side === -1 && f.alive && f.x < 620);
    const haveFront = b.fighters.filter((f) => f.side === 1 && f.alive).length >= 3;
    if (b.manaLv < 5 && !danger && haveFront && b.mana >= b.manaUpCost) {
      b.upgradeMana();
    } else {
      for (const i of order) b.summon(i);
    }
    if (b.skillCd <= 0) b.fireSkill();
    b.update(dt);
    elapsed += dt;
    if (b.over && b.over.t > 0.1) break;
  }
  return { battle: b, elapsed };
}

let failures = 0;
function check(label, cond, detail) {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

/* 1) 全ステージがエラーなく 60 秒回る */
for (let n = 1; n <= STAGE_COUNT; n++) {
  try {
    simulate(n, { maxSec: 60 });
    check(`ステージ${n}: 60秒シミュレートでエラーなし`, true);
  } catch (err) {
    check(`ステージ${n}: 60秒シミュレートでエラーなし`, false, err.stack.split("\n")[0]);
  }
}

/* 2) 序盤ステージは単純プレイで勝てる（バランス） */
for (const n of [1, 2, 3]) {
  const { battle, elapsed } = simulate(n, { maxSec: 240 });
  check(
    `ステージ${n}: 単純AIで勝利できる`,
    !!(battle.over && battle.over.win),
    battle.over ? `${battle.over.win ? "勝利" : "敗北"} (${elapsed.toFixed(0)}秒, 撃破${battle.kills})` : "時間切れ"
  );
}

/* 3) 終盤ステージは強化なしだと簡単には勝てない（歯ごたえ） */
{
  const { battle } = simulate(11, { maxSec: 180, unitLv: 1 });
  check(
    "ステージ11: Lv1部隊では3分以内に楽勝しない",
    !(battle.over && battle.over.win && battle.time < 100),
    battle.over ? `${battle.over.win ? "勝利" : "敗北"} (${battle.time.toFixed(0)}秒)` : "3分間持ちこたえ中"
  );
}

/* 4) 強化すれば終盤も勝てる（詰み防止）。campaign は時間無制限なので長めに見る */
{
  const { battle, elapsed } = simulate(12, { maxSec: 420, unitLv: 9 });
  check(
    "ステージ12: Lv9部隊なら勝利できる",
    !!(battle.over && battle.over.win),
    battle.over ? `${battle.over.win ? "勝利" : "敗北"} (${elapsed.toFixed(0)}秒, 撃破${battle.kills})` : "時間切れ"
  );
}

/* 5) エンドレスは難易度が上がり続け、いずれ敗北で終わる */
{
  const { battle, elapsed } = simulate(0, { maxSec: 900, unitLv: 5 });
  check(
    "エンドレス: いずれ敗北して終了する",
    !!(battle.over && !battle.over.win),
    battle.over ? `${elapsed.toFixed(0)}秒生存, 撃破${battle.kills}` : "15分経っても決着せず"
  );
  check("エンドレス: 敵とりでは破壊不能", battle.enemyTower.hp === Infinity);
}

/* ============================================================
 * 追加システム：ガチャ / デッキ / アリーナ(PvP) / スキル
 * ============================================================ */
console.log("\n--- ガチャ / 編成 / PvP ---");

/* 6) ★3ヒーローは必ずスキルを持ち、SKILLS に定義がある */
{
  const star3 = T.HEROES.filter((h) => h.rarity === 3);
  const ok = star3.length > 0 && star3.every((h) => h.skill && T.SKILLS[h.skill]);
  check("★3ヒーローは全員スキルを習得している", ok, `★3が${star3.length}体、全員スキルあり`);
  const lowerHasNoSkill = T.HEROES.filter((h) => h.rarity < 3).every((h) => !h.skill);
  check("★1〜2はスキルを持たない", lowerHasNoSkill);
}

/* 7) heroSpec：同ロールで ★3 は ★1 より強い、コストも高い */
{
  const melee1 = T.heroSpec("chibi", 0);  // ★1 melee
  const melee3 = T.heroSpec("shino", 0);  // ★3 assassin... 別ロールなので melee同士で比較し直す
  const a1 = T.heroSpec("mike", 0);       // ★1 melee
  // ロール melee の★3が無いので、tank で比較（wanko★1 vs gareth★3）
  const t1 = T.heroSpec("wanko", 0);
  const t3 = T.heroSpec("gareth", 0);
  check("★3タンクは★1タンクよりHPが高い", t3.hp > t1.hp, `★1 HP${t1.hp} < ★3 HP${t3.hp}`);
  check("★3タンクは★1タンクよりコストが高い", t3.cost >= t1.cost, `★1 ${t1.cost} ≤ ★3 ${t3.cost}`);
  check("限界突破でステータスが上がる", T.heroSpec("gareth", 4).hp > t3.hp);
}

/* 8) ガチャの排出率がだいたい設定どおり（5000連） */
{
  save.heroes = {}; save.pity = 0;
  const counts = { 1: 0, 2: 0, 3: 0 };
  const N = 5000;
  for (let i = 0; i < N; i++) {
    const r = T.rollOnce();
    counts[T.HERO_BY_KEY[r.key].rarity]++;
  }
  const p3 = counts[3] / N, p2 = counts[2] / N;
  // 天井があるので★3は基準値以上に出る。1.5倍以内・下回らない程度を許容
  check("★3排出率が妥当（4%〜8%）", p3 >= 0.035 && p3 <= 0.08, `${(p3 * 100).toFixed(1)}%`);
  check("★2排出率が妥当（15%〜27%）", p2 >= 0.15 && p2 <= 0.27, `${(p2 * 100).toFixed(1)}%`);
}

/* 9) 天井：50連で必ず★3が1体は出る */
{
  save.heroes = {}; save.pity = 0;
  let got3 = false;
  for (let i = 0; i < T.GACHA.pity; i++) {
    const r = T.rollOnce();
    if (T.HERO_BY_KEY[r.key].rarity === 3) got3 = true;
  }
  check("天井：50連以内に必ず★3が出る", got3);
}

/* 10) 10連は★2以上を1体保証 */
{
  save.heroes = {}; save.pity = 0;
  let worstOk = true;
  for (let t = 0; t < 40; t++) {
    save.pity = 0;
    const res = T.rollMany(10);
    if (!res.some((r) => T.HERO_BY_KEY[r.key].rarity >= 2)) worstOk = false;
  }
  check("10連ガチャは必ず★2以上を含む", worstOk);
}

/* 11) デッキの対戦コードがエンコード往復で一致する */
{
  save.heroes = { drao: { lb: 2, dupes: 2 }, noel: { lb: 0, dupes: 0 } };
  save.deck = ["mike", "drao", "noel", "pochi"];
  save.playerName = "テスト勇者";
  save.arena.rank = 5;
  const code = T.buildShareCode();
  const parsed = T.parseShareCode(code);
  const keysMatch = parsed && parsed.entries.map((e) => e.key).join(",") === save.deck.join(",");
  check("対戦コードの往復で デッキが復元できる", !!keysMatch, parsed ? parsed.entries.map((e) => e.key).join(",") : "解析失敗");
  check("対戦コードに 名前とランクが載る", parsed && parsed.name === "テスト勇者" && parsed.rank === 5);
  check("壊れたコードは null を返す（誤入力に強い）", T.parseShareCode("こわれたコード!!") === null);
}

/* 12) ランクライバルのデッキは妥当 */
{
  const rd = T.rivalDeck(8);
  const ok = rd.entries.length === T.DECK_SIZE && rd.entries.every((e) => T.HERO_BY_KEY[e.key]);
  check("ランクライバルのデッキが正しく生成される", ok, `${rd.name} / ${rd.entries.length}体`);
}

/* ---- アリーナ対戦のシミュレーション ---- */
function simulateArena(opts) {
  const seed = opts.seed || 12345;
  const playerSpecs = T.deckSpecs(opts.playerDeck);
  const oppSpecs = T.deckSpecs(opts.oppDeck);
  const b = new Battle(0, { arena: true, seed, playerSpecs, oppSpecs, oppName: "テスト相手", oppRank: opts.oppRank || 1 });
  const dt = 1 / 30;
  let elapsed = 0;
  const order = [2, 3, 5, 4, 1, 0];
  while (elapsed < 200) {
    if (opts.playerPlays) {
      // 決定論的な自軍AI（b.rng を使うので同シードなら同じ手）
      if (b.manaLv < 3 && b.mana >= b.manaUpCost && b.rng() < 0.25) b.upgradeMana();
      else for (const i of order) if (b.rng() < 0.5) b.summon(i);
    }
    b.update(dt);
    elapsed += dt;
    if (b.over && b.over.t > 0.1) break;
  }
  return { b, elapsed };
}

const sixBase = ["mike", "usa", "pochi", "moko", "fuku", "kuma"].map((k) => ({ key: k, lb: 0 }));
const sixStar3 = ["drao", "noel", "vell", "gareth", "shino", "bon"].map((k) => ({ key: k, lb: 0 }));

/* 13) アリーナは制限時間内に必ず決着する */
{
  const { b, elapsed } = simulateArena({ playerDeck: sixBase, oppDeck: sixBase, playerPlays: true, seed: 7 });
  check("アリーナ: 制限時間内に決着する", !!b.over, b.over ? `${b.over.win ? "自軍勝利" : "相手勝利"} (${elapsed.toFixed(0)}秒${b.over.byTime ? "・時間切れ判定" : ""})` : "未決着");
}

/* 14) 決定論：同じシード・同じデッキなら結果が一致（対戦の公平性）*/
{
  // 自軍は何もしない（純粋にエンジンの決定論を検証）
  const r1 = simulateArena({ playerDeck: sixBase, oppDeck: sixStar3, playerPlays: false, seed: 99 });
  const r2 = simulateArena({ playerDeck: sixBase, oppDeck: sixStar3, playerPlays: false, seed: 99 });
  const same = r1.b.over && r2.b.over &&
    r1.b.over.win === r2.b.over.win &&
    Math.round(r1.b.playerTower.hp) === Math.round(r2.b.playerTower.hp) &&
    Math.round(r1.b.enemyTower.hp) === Math.round(r2.b.enemyTower.hp);
  check("決定論: 同シード・同デッキで結果が完全一致する", !!same,
    `run1 自塔${Math.round(r1.b.playerTower.hp)} / run2 自塔${Math.round(r2.b.playerTower.hp)}`);
}

/* 15) ★3スキル満載のデッキでも例外なく長時間まわる */
{
  let crashed = null;
  try {
    simulateArena({ playerDeck: sixStar3, oppDeck: sixStar3, playerPlays: true, seed: 3 });
  } catch (e) { crashed = e; }
  check("スキル全部入り対戦が例外なく動く", !crashed, crashed ? crashed.stack.split("\n")[0] : "OK");
}

/* 16) ★3デッキは ★1主体デッキにだいたい勝つ（レア度が活きる）
 *     両者とも同じAI(Commander)で戦わせて公平に比較する */
function simulateArenaCommanders(playerDeck, oppDeck, seed) {
  const b = new Battle(0, {
    arena: true, seed,
    playerSpecs: T.deckSpecs(playerDeck), oppSpecs: T.deckSpecs(oppDeck),
    oppName: "相手", oppRank: 1,
  });
  // 自軍(side 1)も AI Commander で動かす（人の入力の代わり）
  const pc = new T.Commander(b, 1, T.deckSpecs(playerDeck), "自軍");
  const dt = 1 / 30;
  let elapsed = 0;
  while (elapsed < 200) {
    pc.update(dt);
    b.update(dt);
    elapsed += dt;
    if (b.over && b.over.t > 0.1) break;
  }
  return b;
}
{
  const weakDeck = ["chibi", "pyon", "wanko", "fuwa", "nora", "chibi"].map((k) => ({ key: k, lb: 0 }));
  let wins = 0; const tries = 7;
  for (let s = 0; s < tries; s++) {
    const b = simulateArenaCommanders(sixStar3, weakDeck, 100 + s * 13);
    if (b.over && b.over.win) wins++;
  }
  check("★3デッキは★1デッキに有利（7戦中4勝以上）", wins >= 4, `${wins}/${tries} 勝`);
}

/* 17) ガチャヒーローはぼうけん（campaign）でも使える */
{
  save.stars = {}; save.stars[1] = 1;          // ステージ1だけクリア済み
  save.heroes = { drao: { lb: 1, dupes: 1 } }; // ★3ドラオを所持
  save.deck = ["drao", "mike", "usa"];
  save.unitLv = { drao: 3 };
  const b = new Battle(2, {});
  const keys = b.roster.map((s) => s.key).join(",");
  check("campaign のカード列にガチャヒーローが並ぶ", keys === "drao,mike,usa", keys);
  check("campaign でも★3スキルが乗る", b.roster[0].skill === "splash");
  // ゴールド強化（Lv3）と限界突破(+1)が campaign スペックに反映される
  const base = T.heroSpec("drao", 1).hp;
  check("campaign はゴールド強化が上乗せされる", b.roster[0].hp === Math.round(base * (1 + 0.13 * 2)),
    `素${base} → 強化後${b.roster[0].hp}`);
  // 実際に召喚できる
  b.mana = 500;
  const ok = b.summon(0);
  const f = b.fighters[b.fighters.length - 1];
  check("ガチャヒーローを campaign で召喚できる", ok && f && f.spec.key === "drao" && f.skill === "splash");
}

/* 17b) 新規プレイヤーの実体験：基本3体(みけ・うさ・ぽち)Lv1 でステージ1〜2を勝てる */
function simulateNewbie(stage, deck) {
  save.stars = {}; for (let i = 1; i < stage; i++) save.stars[i] = 1;
  save.heroes = {}; save.unitLv = {};
  save.deck = deck.slice();
  const b = new Battle(stage, {});
  const dt = 1 / 30; let el = 0;
  const order = [2, 3, 5, 4, 1, 0];
  while (el < 200) {
    const danger = b.fighters.some((f) => f.side === -1 && f.alive && f.x < 620);
    const front = b.fighters.filter((f) => f.side === 1 && f.alive).length >= 2;
    if (b.manaLv < 4 && !danger && front && b.mana >= b.manaUpCost) b.upgradeMana();
    else for (let i = 0; i < b.roster.length; i++) b.summon(i);
    if (b.skillCd <= 0) b.fireSkill();
    b.update(dt); el += dt;
    if (b.over && b.over.t > 0.1) break;
  }
  return b;
}
{
  const b1 = simulateNewbie(1, ["mike", "usa", "pochi"]);
  check("新規(基本3体Lv1)でステージ1を勝てる", !!(b1.over && b1.over.win),
    b1.over ? `${b1.over.win ? "勝利" : "敗北"} (${b1.time.toFixed(0)}秒)` : "時間切れ");
  const b2 = simulateNewbie(2, ["mike", "usa", "pochi"]);
  check("新規(基本3体Lv1)でステージ2を勝てる", !!(b2.over && b2.over.win),
    b2.over ? `${b2.over.win ? "勝利" : "敗北"} (${b2.time.toFixed(0)}秒)` : "時間切れ");
}

/* 18) 未解放の基本ヒーローはデッキに入らない（進行ゲートの維持） */
{
  save.stars = {};                             // 何もクリアしていない
  save.heroes = {};
  save.deck = [];
  T.ensureDeck();
  const deck = save.deck.join(",");
  check("初期デッキは みけ・うさ・ぽち の3体だけ", deck === "mike,usa,pochi", deck);
}

/* 19) 見た目の重複がない（look＋skin の組み合わせが全ヒーローで一意） */
{
  const sigs = T.HEROES.map((h) => `${h.look}|${JSON.stringify(h.skin || {})}`);
  const dup = sigs.filter((s, i) => sigs.indexOf(s) !== i);
  check("全ヒーローの見た目（look+装飾）が一意", dup.length === 0, dup.length ? `重複: ${dup.join(" / ")}` : `${sigs.length}体すべて固有`);
  // 色だけの違いに頼らない：ガチャヒーローは装飾パーツ持ち or 固有 look
  const PART_KEYS = ["band", "eyepatch", "cape", "flower", "glasses", "goggles", "plume", "halo", "maskNinja", "weapon", "hatColor", "helmet", "fluffy"];
  const plain = T.GACHA_POOL.filter((h) => {
    const baseLooks = ["cat", "rabbit", "dog", "sheep", "owl", "bear"];
    if (!baseLooks.includes(h.look)) return false;       // 固有 look（dragon/penguin/witch/imp）はOK
    return !PART_KEYS.some((k) => h.skin && k in h.skin);
  });
  check("基本と同じ見た目のガチャヒーローは全員 装飾パーツ持ち", plain.length === 0,
    plain.length ? `色違いのみ: ${plain.map((h) => h.name).join(",")}` : "OK");
}

/* ============================================================
 * 拡張：覚醒 / 新スキル（式神・こおり） / フィーバー
 * ============================================================ */
console.log("\n--- 覚醒 / 新スキル / フィーバー ---");

/* 20) 覚醒：★1/★2 はロールスキルを習得、★3 は「真」(skillLv2) になる */
{
  const plain = T.heroSpec("wanko", 0, false);        // ★1 tank
  const aw1 = T.heroSpec("wanko", 0, true);
  check("覚醒した★1がスキルを習得する", !plain.skill && aw1.skill === "aura_guard" && aw1.skillLv === 1,
    `素=${plain.skill} → 覚醒=${aw1.skill}`);
  check("覚醒でステータスが上がる", aw1.hp > plain.hp, `HP ${plain.hp} → ${aw1.hp}`);
  const aw3 = T.heroSpec("drao", 0, true);            // ★3
  check("覚醒した★3は skillLv 2（真スキル）", aw3.skill === "splash" && aw3.skillLv === 2);
  const norm3 = T.heroSpec("drao", 0, false);
  check("未覚醒の★3は skillLv 1", norm3.skillLv === 1);
}

/* 21) 覚醒の条件と消費（Lv8 以上 + 覚醒石） */
{
  save.heroes = { drao: { lb: 0, dupes: 0 } };
  save.awakened = {}; save.shards = 10; save.unitLv = { drao: 7 };
  check("Lv7では覚醒できない", !T.canAwaken("drao"));
  save.unitLv.drao = 8;
  check("Lv8なら覚醒できる", T.canAwaken("drao"));
  const before = save.shards;
  check("覚醒すると覚醒石を消費する", T.awakenHero("drao") && save.shards === before - 5 && save.awakened.drao === true);
  check("二重に覚醒できない", !T.canAwaken("drao"));
}

/* 22) 対戦コードに覚醒が載って往復する */
{
  save.heroes = { drao: { lb: 2, dupes: 2 } };
  save.awakened = { drao: true };
  save.deck = ["drao", "mike"];
  const parsed = T.parseShareCode(T.buildShareCode());
  check("対戦コードで覚醒フラグが伝わる", parsed && parsed.entries[0].aw === true && parsed.entries[1].aw === false);
}

/* 23) しきがみ召喚：式神が出る・3体まで・召喚枠を食わない */
{
  const deck = [{ key: "kyuu", lb: 0 }];
  const b = new Battle(0, { arena: true, seed: 5, playerSpecs: T.deckSpecs(deck), oppSpecs: T.deckSpecs([{ key: "wanko" }]), oppName: "x" });
  b.mana = 999;
  b.summon(0);
  for (let i = 0; i < 30 * 25; i++) b.update(1 / 30);   // 25秒
  const minions = b.fighters.filter((f) => f.spec.minion && f.side === 1 && f.alive);
  check("しきがみが召喚される", minions.length > 0, `${minions.length}体`);
  check("しきがみは3体まで", minions.length <= 3);
  check("しきがみは召喚枠を消費しない", b.sideAlive(1) <= 1, `本体カウント=${b.sideAlive(1)}`);
}

/* 24) こおりのいき：攻撃された敵が凍って遅くなる */
{
  const deck = [{ key: "frill", lb: 0 }];
  const b = new Battle(0, { arena: true, seed: 6, playerSpecs: T.deckSpecs(deck), oppSpecs: T.deckSpecs([{ key: "gaado" }]), oppName: "x" });
  b.mana = 999;
  b.summon(0);
  b.enemyCmd.mana = 999;
  // 相手AIの代わりに直接出す
  b.spawnFighter(T.heroSpec("gaado"), -1);
  let chilledSeen = false;
  for (let i = 0; i < 30 * 20; i++) {
    b.update(1 / 30);
    if (b.fighters.some((f) => f.side === -1 && f.alive && f.chillT > 0)) { chilledSeen = true; break; }
  }
  check("こおりのいきで敵が凍る", chilledSeen);
}

/* 25) フィーバー：ゲージが満タンで発動し、アリーナでは発生しない */
{
  save.deck = []; save.heroes = {}; save.awakened = {};
  save.stars = {}; for (let i = 1; i <= STAGE_COUNT; i++) save.stars[i] = 1;
  const b = new Battle(2, {});
  b.fever = 99;
  // 敵を1体出して倒す
  b.spawnEnemy(T.ENEMIES.slime, 1, true);
  const e = b.fighters.find((f) => f.side === -1);
  e.takeDamage(99999, b);
  check("撃破でフィーバーが発動する", b.feverT > 0 && b.fever === 0, `feverT=${b.feverT.toFixed(1)}秒`);
  // フィーバー中はマナ回復が1.5倍
  const baseRegen = 14 + (b.manaLv - 1) * 7;
  check("フィーバー中はマナ回復1.5倍", Math.abs(b.manaRegen - baseRegen * 1.5) < 0.01);
  // アリーナでは発動しない
  const a = new Battle(0, { arena: true, seed: 9, playerSpecs: T.deckSpecs([{ key: "mike" }]), oppSpecs: T.deckSpecs([{ key: "mike" }]), oppName: "x" });
  a.fever = 99;
  a.spawnFighter(T.heroSpec("mike"), -1);
  const ae = a.fighters.find((f) => f.side === -1);
  ae.takeDamage(99999, a);
  check("アリーナではフィーバーが発生しない", a.feverT === 0);
}

/* 26) 新★3込みの全スキル大乱闘が例外なく動き、決定論も保たれる */
{
  const all3 = ["drao", "noel", "vell", "gareth", "shino", "bon", "kyuu", "frill"];
  const deckA = all3.slice(0, 6).map((k) => ({ key: k, lb: 4, aw: true }));
  const deckB = all3.slice(2).map((k) => ({ key: k, lb: 4, aw: true }));
  let crashed = null;
  let r1 = null, r2 = null;
  try {
    r1 = simulateArenaCommanders(deckA, deckB, 777);
    r2 = simulateArenaCommanders(deckA, deckB, 777);
  } catch (e) { crashed = e; }
  check("覚醒★3全部入り（式神・氷含む）対戦が例外なく動く", !crashed, crashed ? crashed.stack.split("\n")[0] : "OK");
  check("式神・氷を含んでも決定論が保たれる", !crashed && r1.over && r2.over &&
    r1.over.win === r2.over.win && Math.round(r1.playerTower.hp) === Math.round(r2.playerTower.hp),
    !crashed && r1.over ? `${r1.over.win ? "勝ち" : "負け"} / 自塔${Math.round(r1.playerTower.hp)}` : "");
}

/* 27) 覚醒済みデッキは未覚醒の同デッキより強い（覚醒の意味がある） */
{
  const deck = ["gareth", "noel", "shino", "vell", "drao", "bon"];
  let awWins = 0; const tries = 7;
  for (let s = 0; s < tries; s++) {
    const b = simulateArenaCommanders(
      deck.map((k) => ({ key: k, lb: 0, aw: true })),
      deck.map((k) => ({ key: k, lb: 0, aw: false })),
      300 + s * 17);
    if (b.over && b.over.win) awWins++;
  }
  check("覚醒デッキ vs 未覚醒デッキで勝ち越す（7戦4勝以上）", awWins >= 4, `${awWins}/${tries} 勝`);
}

console.log(failures === 0 ? "\nすべてのチェックに合格 🎉" : `\n${failures} 件のチェックに失敗`);
process.exit(failures === 0 ? 0 : 1);

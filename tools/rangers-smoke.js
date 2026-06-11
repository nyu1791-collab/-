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
  Math,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* ---- rangers.js を読み込み、テスト用フックを追加 ---- */
let src = fs.readFileSync(path.join(__dirname, "..", "rangers.js"), "utf8");
src += "\nglobalThis.__test = { Battle, UNITS, ENEMIES, STAGES, STAGE_COUNT, save };\n";
vm.runInContext(src, sandbox, { filename: "rangers.js" });
const { Battle, UNITS, STAGE_COUNT, save } = sandbox.__test;

/* ---- 単純 AI でステージをシミュレート ---- */
function simulate(stageNo, { maxSec = 300, unitLv = 1 } = {}) {
  for (const u of UNITS) save.unitLv[u.key] = unitLv;
  save.stars = {};
  for (let i = 1; i <= STAGE_COUNT; i++) save.stars[i] = 1; // 全ユニット解放状態で試す

  const b = new Battle(stageNo, { endless: stageNo === 0 });
  const dt = 1 / 30;
  let elapsed = 0;
  // 実プレイに近い優先度: 盾(ぽち)→回復(もこ)→大型(くま)→範囲(ふく)→弓(うさ)→近接(みけ)
  const order = [2, 3, 5, 4, 1, 0];
  while (elapsed < maxSec) {
    // 実プレイヤー風の立ち回り:
    //  - 敵が自陣に迫っていなければ、まずマナ強化(Lv4まで)のために貯金
    //  - 危険なときは優先度順に召喚して防衛
    const danger = b.fighters.some((f) => f.side === -1 && f.alive && f.x < 560);
    if (b.manaLv < 4 && !danger) {
      if (b.mana >= b.manaUpCost) b.upgradeMana();
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

/* 4) 強化すれば終盤も勝てる（詰み防止） */
{
  const { battle, elapsed } = simulate(12, { maxSec: 300, unitLv: 9 });
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

console.log(failures === 0 ? "\nすべてのチェックに合格 🎉" : `\n${failures} 件のチェックに失敗`);
process.exit(failures === 0 ? 0 : 1);

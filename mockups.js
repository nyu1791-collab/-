/* つづける — モックアップ画面ビルダー (window.Mockups)
 * 紹介ページ・スクショ撮影スタジオで使う、デモデータ入りの画面マークアップ。
 * 実アプリと同じCSSクラスで描画する。
 */
(function () {
  "use strict";

  function mascot(stageIndex, mood) {
    if (typeof window.Mascot === "undefined") return "";
    const stage = window.Mascot.STAGES[stageIndex] || window.Mascot.STAGES[0];
    return `<div class="mk-mascot">${window.Mascot.art(stage, mood)}</div>`;
  }

  function home() {
    return `
      <div class="mk-row"><span class="mk-title">つづける</span><span class="mk-spacer"></span><span class="mk-chip">Lv.4 たいよう</span></div>
      ${mascot(3, "happy")}
      <div class="mk-level"><div class="mk-row"><span class="mk-s">⭐ 早起き名人</span><span class="mk-spacer"></span><span class="mk-s">70 / 100 XP</span></div><div class="mk-level__track"><div class="mk-level__fill" style="width:70%"></div></div></div>
      <div class="mk-card"><div class="mk-check">✓</div><div><div class="mk-h">朝に水を飲む</div><div class="mk-s">🔥 12日連続</div></div></div>
      <div class="mk-card"><div class="mk-check off"></div><div><div class="mk-h">5分ストレッチ</div><div class="mk-s">今日から始めよう</div></div></div>
      <div class="mk-card"><div class="mk-check">✓</div><div><div class="mk-h">読書を10分</div><div class="mk-s">🔥 5日連続</div></div></div>`;
  }

  function morning() {
    return `
      <div class="mk-row"><span class="mk-title">朝チャレンジ</span></div>
      ${mascot(2, "sad")}
      <div class="mk-status"><div class="big">💸 3分 遅刻中… ¥300</div><div class="mk-s">1分ごとに +¥100（上限 ¥1,000）</div></div>
      <div class="mk-wake">起きた！（加算を止める）</div>
      <div class="mk-bal"><div class="mk-s">未払いのペナルティ残高</div><div class="amt">¥1,300</div></div>`;
  }

  function stats() {
    return `
      <div class="mk-row"><span class="mk-title">統計</span></div>
      <div class="mk-stat">
        <div class="mk-statcard"><div class="n">128</div><div class="l">総チェック数</div></div>
        <div class="mk-statcard"><div class="n">21日</div><div class="l">これまでの最長</div></div>
        <div class="mk-statcard"><div class="n">¥8,400</div><div class="l">守ったお金</div></div>
        <div class="mk-statcard"><div class="n">86%</div><div class="l">時間内に起床</div></div>
      </div>
      <div class="mk-card"><div class="mk-check">✓</div><div><div class="mk-h">三日坊主、突破</div><div class="mk-s">🏅 実績を 7 / 10 個 獲得</div></div></div>
      ${mascot(4, "happy")}`;
  }

  window.Mockups = { home, morning, stats };
})();

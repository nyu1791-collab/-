/* つづける — 育成マスコット「ひだまり」 (window.Mascot)
 * SVGで描く太陽の精。連続記録で成長し、今日の状況で表情が変わる。
 * 依存ライブラリなし。
 */
(function () {
  "use strict";

  // 成長段階：必要な最長連続日数（昇順）
  const STAGES = [
    { need: 0, label: "たまご太陽", bodyR: 34, rays: 0, pale: true },
    { need: 1, label: "めばえ", bodyR: 38, rays: 6, pale: false },
    { need: 3, label: "ちび太陽", bodyR: 42, rays: 8, pale: false },
    { need: 7, label: "たいよう", bodyR: 46, rays: 10, pale: false },
    { need: 14, label: "かがやき", bodyR: 50, rays: 12, pale: false },
    { need: 30, label: "おおぞら太陽", bodyR: 54, rays: 14, pale: false, halo: true },
    { need: 100, label: "太陽神", bodyR: 58, rays: 16, pale: false, halo: true },
  ];

  const LINES = {
    happy: ["今日も最高！", "えらすぎる…！", "この調子で世界をとろう☀️", "きみが眩しいよ", "やったね、ぼくも嬉しい！"],
    content: ["いい感じ！あと少し", "つづけてえらい", "今日もよろしくね", "コツコツ、さいきょう"],
    sleepy: ["…ZZZ… あ、おはよう", "まだ今日は間に合うよ", "ちょっとねむい…", "ぽちっと、はじめよ？"],
    proud: ["時間内に起きたね！神！", "朝のきみは無敵だ", "今日の勝ちが確定した🌞"],
    sad: ["また一緒にがんばろ", "だいじょうぶ、ここからだよ", "きみならできる", "明日は早起きしよ？"],
  };

  function stageFor(bestStreak) {
    let s = STAGES[0];
    for (const st of STAGES) if (bestStreak >= st.need) s = st;
    return s;
  }

  function pick(arr) {
    return arr[(Math.random() * arr.length) | 0];
  }

  /**
   * 表示状態を計算する。
   * @param {{ bestStreak:number, doneToday:number, totalHabits:number, mood?:string }} data
   */
  function computeState(data) {
    const bestStreak = data.bestStreak || 0;
    const stage = stageFor(bestStreak);
    let mood = data.mood; // 明示指定（朝チャレンジ用）があれば優先
    if (!mood) {
      if (data.totalHabits > 0 && data.doneToday >= data.totalHabits) mood = "happy";
      else if (data.doneToday > 0) mood = "content";
      else mood = "sleepy";
    }
    const line = pick(LINES[mood] || LINES.content);
    return { stage, mood, line, bestStreak };
  }

  // ---- SVG パーツ -----------------------------------------------------------

  function rays(stage) {
    if (!stage.rays) return "";
    const cx = 100, cy = 100;
    const inner = stage.bodyR + 6;
    const outer = stage.bodyR + 26;
    let out = "";
    for (let i = 0; i < stage.rays; i++) {
      const a = (Math.PI * 2 * i) / stage.rays;
      const x1 = cx + Math.cos(a) * inner;
      const y1 = cy + Math.sin(a) * inner;
      const x2 = cx + Math.cos(a) * outer;
      const y2 = cy + Math.sin(a) * outer;
      out += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
        stroke="#fbbf24" stroke-width="7" stroke-linecap="round"/>`;
    }
    return `<g class="mascot__rays">${out}</g>`;
  }

  function face(mood) {
    const lx = 84, rx = 116, ey = 94;
    let eyes, mouth, extra = "";
    const cheeks = `<ellipse cx="76" cy="110" rx="7" ry="4.5" fill="#fb7185" opacity="0.55"/>
      <ellipse cx="124" cy="110" rx="7" ry="4.5" fill="#fb7185" opacity="0.55"/>`;

    switch (mood) {
      case "happy":
      case "proud":
        eyes = `<path d="M${lx - 7} ${ey + 2} q7 -10 14 0" stroke="#5b3b00" stroke-width="4.5" fill="none" stroke-linecap="round"/>
                <path d="M${rx - 7} ${ey + 2} q7 -10 14 0" stroke="#5b3b00" stroke-width="4.5" fill="none" stroke-linecap="round"/>`;
        mouth = `<path d="M82 112 q18 22 36 0" stroke="#5b3b00" stroke-width="5" fill="none" stroke-linecap="round"/>`;
        extra = cheeks;
        if (mood === "proud") extra += `<text x="148" y="60" font-size="22">✨</text>`;
        break;
      case "content":
        eyes = `<circle cx="${lx}" cy="${ey}" r="4.5" fill="#5b3b00"/><circle cx="${rx}" cy="${ey}" r="4.5" fill="#5b3b00"/>`;
        mouth = `<path d="M88 114 q12 12 24 0" stroke="#5b3b00" stroke-width="4.5" fill="none" stroke-linecap="round"/>`;
        extra = cheeks;
        break;
      case "sad":
        eyes = `<path d="M${lx - 7} ${ey - 2} q7 8 14 0" stroke="#5b3b00" stroke-width="4.5" fill="none" stroke-linecap="round"/>
                <path d="M${rx - 7} ${ey - 2} q7 8 14 0" stroke="#5b3b00" stroke-width="4.5" fill="none" stroke-linecap="round"/>`;
        mouth = `<path d="M86 122 q14 -12 28 0" stroke="#5b3b00" stroke-width="4.5" fill="none" stroke-linecap="round"/>`;
        extra = `<path d="M${rx + 6} ${ey + 4} q3 10 0 14 q-3 -4 0 -14Z" fill="#38bdf8"/>`;
        break;
      default: // sleepy
        eyes = `<path d="M${lx - 7} ${ey} h14" stroke="#5b3b00" stroke-width="4.5" stroke-linecap="round"/>
                <path d="M${rx - 7} ${ey} h14" stroke="#5b3b00" stroke-width="4.5" stroke-linecap="round"/>`;
        mouth = `<circle cx="100" cy="118" r="4.5" fill="#5b3b00"/>`;
        extra = `<text x="150" y="58" font-size="16" fill="#fff" opacity="0.9">z</text>
                 <text x="160" y="46" font-size="22" fill="#fff" opacity="0.9">Z</text>`;
        break;
    }
    return eyes + mouth + extra;
  }

  function svg(stage, mood) {
    const fill = stage.pale ? "url(#sunPale)" : "url(#sun)";
    const halo = stage.halo
      ? `<circle cx="100" cy="100" r="${stage.bodyR + 34}" fill="#fde047" opacity="0.18"/>`
      : "";
    return `
      <svg class="mascot__svg" viewBox="0 0 200 200" role="img" aria-label="マスコット ひだまり（${stage.label}）">
        <defs>
          <radialGradient id="sun" cx="40%" cy="35%" r="75%">
            <stop offset="0%" stop-color="#fff3bf"/>
            <stop offset="55%" stop-color="#fcd34d"/>
            <stop offset="100%" stop-color="#f59e0b"/>
          </radialGradient>
          <radialGradient id="sunPale" cx="40%" cy="35%" r="75%">
            <stop offset="0%" stop-color="#fffbeb"/>
            <stop offset="100%" stop-color="#fcd9a0"/>
          </radialGradient>
        </defs>
        ${halo}
        ${rays(stage)}
        <circle cx="100" cy="100" r="${stage.bodyR}" fill="${fill}"/>
        ${face(mood)}
      </svg>`;
  }

  /**
   * 描画する。
   * @param {HTMLElement} el
   * @param {object} state  computeState の戻り値（または同形）
   * @param {{ withBubble?: boolean }} [opts]
   */
  function render(el, state, opts) {
    if (!el) return;
    opts = opts || {};
    const bubble =
      opts.withBubble === false
        ? ""
        : `<div class="mascot__bubble">${state.line || ""}</div>`;
    el.innerHTML = `
      <div class="mascot__stage">Lv. ${state.stage.label}</div>
      <div class="mascot__art">${svg(state.stage, state.mood)}</div>
      ${bubble}`;
  }

  window.Mascot = { STAGES, stageFor, computeState, render };
})();

/* 朝チャレンジ — 起きるのが遅れるほどペナルティが積み上がるコミットメント装置
 * 遅刻1分ごとに加算 / 1日の上限で頭打ち。
 * データは localStorage に保存。外部通信なし。実際の引き落としは行わない。
 */
(function () {
  "use strict";

  const STORE_KEY = "tsuzukeru.morning.v2";
  const THEME_KEY = "tsuzukeru.theme"; // 習慣アプリとテーマを共有
  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

  /**
   * @typedef {{
   *   config: { target: string, ratePerMin: number, cap: number, payUrl: string },
   *   since: string,                        // チャレンジ開始の ISO 日時
   *   days: Record<string, {
   *     status: "done"|"failed",
   *     at?: string,                        // 起床確認した時刻
   *     lateMin?: number,                   // 遅刻分
   *     amount: number                      // その日のペナルティ
   *   }>,
   *   payments: Array<{ amount: number, at: string }>
   * }} State
   */

  // ---- データ層 -------------------------------------------------------------

  function defaults() {
    return {
      config: { target: "06:30", ratePerMin: 100, cap: 1000, payUrl: "" },
      since: new Date().toISOString(),
      days: {},
      payments: [],
    };
  }

  /** @returns {State} */
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaults();
      const d = JSON.parse(raw);
      const def = defaults();
      return {
        config: {
          target: d?.config?.target || def.config.target,
          ratePerMin: numOr(d?.config?.ratePerMin, def.config.ratePerMin),
          cap: numOr(d?.config?.cap, def.config.cap),
          payUrl: d?.config?.payUrl || "",
        },
        since: d?.since || def.since,
        days: d?.days && typeof d.days === "object" ? d.days : {},
        payments: Array.isArray(d?.payments) ? d.payments : [],
      };
    } catch (e) {
      console.warn("データの読み込みに失敗しました", e);
      return defaults();
    }
  }

  function numOr(v, fallback) {
    return Number.isFinite(v) ? v : fallback;
  }

  /** @param {State} s */
  function save(s) {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  }

  // ---- 日付・金額ユーティリティ ---------------------------------------------

  function dateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function addDays(d, n) {
    const c = new Date(d);
    c.setDate(c.getDate() + n);
    return c;
  }

  /** その日付 + "HH:MM" を Date にする */
  function deadlineOf(dateStr, target) {
    const [h, m] = target.split(":").map(Number);
    const d = new Date(dateStr + "T00:00:00");
    d.setHours(h, m, 0, 0);
    return d;
  }

  function yen(n) {
    return "¥" + Math.round(Number(n)).toLocaleString("ja-JP");
  }

  /** 遅刻分（締切を過ぎた分数、切り上げ。締切前なら0） */
  function lateMinutesAt(when, deadline) {
    const ms = when.getTime() - deadline.getTime();
    if (ms <= 0) return 0;
    return Math.ceil(ms / 60000);
  }

  /** 遅刻分からペナルティ額（上限で頭打ち） */
  function penaltyFor(lateMin) {
    const { ratePerMin, cap } = state.config;
    return Math.min(lateMin * ratePerMin, cap);
  }

  /** 上限に到達する遅刻分（rate=0なら∞扱い） */
  function capMinutes() {
    const { ratePerMin, cap } = state.config;
    return ratePerMin > 0 ? Math.ceil(cap / ratePerMin) : Infinity;
  }

  // ---- 状態 -----------------------------------------------------------------

  let state = load();

  // ---- 精算：過去の日（未確認）を上限額の失敗として確定 ---------------------

  function settle() {
    const now = new Date();
    const todayK = dateKey(now);
    const since = new Date(state.since);

    let cursor = new Date(since);
    cursor.setHours(0, 0, 0, 0);

    let changed = false;
    while (dateKey(cursor) < todayK) {
      // 今日より前の日だけを確定（今日はライブ計算）
      const k = dateKey(cursor);
      const dl = deadlineOf(k, state.config.target);
      const eligible = dl.getTime() > since.getTime(); // 開始時点で締切前だった日のみ対象
      if (eligible && !state.days[k]) {
        // 一度も起床確認しなかった日 → 上限額で失敗確定
        state.days[k] = { status: "failed", amount: state.config.cap };
        changed = true;
      }
      cursor = addDays(cursor, 1);
    }
    if (changed) save(state);
  }

  /**
   * 今日の状態
   * @returns {{ kind: "done"|"active"|"before-start", late?: number, amount?: number, deadline: Date }}
   */
  function todayInfo() {
    const now = new Date();
    const k = dateKey(now);
    const deadline = deadlineOf(k, state.config.target);
    const rec = state.days[k];

    if (rec) {
      return { kind: "done", late: rec.lateMin || 0, amount: rec.amount, deadline };
    }
    if (deadline.getTime() <= new Date(state.since).getTime()) {
      return { kind: "before-start", deadline };
    }
    const late = lateMinutesAt(now, deadline);
    return { kind: "active", late, amount: penaltyFor(late), deadline };
  }

  function lockedBalance() {
    const owed = Object.values(state.days).reduce((s, d) => s + (d.amount || 0), 0);
    const paid = state.payments.reduce((s, p) => s + p.amount, 0);
    return Math.max(0, owed - paid);
  }

  function doneCount() {
    return Object.values(state.days).filter((d) => d.status === "done").length;
  }
  function failedCount() {
    return Object.values(state.days).filter((d) => d.status === "failed").length;
  }

  // ---- DOM 参照 -------------------------------------------------------------

  const statusCardEl = document.getElementById("statusCard");
  const wakeAreaEl = document.getElementById("wakeArea");
  const balanceCardEl = document.getElementById("balanceCard");
  const logListEl = document.getElementById("logList");
  const todayLabelEl = document.getElementById("todayLabel");
  const themeToggleEl = document.getElementById("themeToggle");
  const settingsFormEl = document.getElementById("settingsForm");
  const targetTimeEl = document.getElementById("targetTime");
  const ratePerMinEl = document.getElementById("ratePerMin");
  const capEl = document.getElementById("cap");
  const payUrlEl = document.getElementById("payUrl");
  const soundToggleEl = document.getElementById("soundToggle");
  const installBtnEl = document.getElementById("installBtn");
  const shareBtnEl = document.getElementById("shareBtn");
  const mascotEl = document.getElementById("mascot");
  const remMorningEl = document.getElementById("remMorning");
  const remHabitEl = document.getElementById("remHabit");
  const remHabitTimeEl = document.getElementById("remHabitTime");
  const remHintEl = document.getElementById("remHint");
  const hasFun = typeof window.Fun !== "undefined";
  const hasMascot = typeof window.Mascot !== "undefined";
  const hasReminders = typeof window.Reminders !== "undefined";

  // ---- 寝ぼけ防止チャレンジ -------------------------------------------------

  let challenge = null; // { problems: [{a,b,op,answer}], index }

  function makeProblem() {
    const a = 10 + Math.floor(Math.random() * 80);
    const b = 10 + Math.floor(Math.random() * 80);
    const op = Math.random() < 0.5 ? "+" : "-";
    const big = Math.max(a, b);
    const small = Math.min(a, b);
    return op === "+"
      ? { a, b, op, answer: a + b }
      : { a: big, b: small, op, answer: big - small };
  }

  function startChallenge() {
    challenge = { problems: [makeProblem(), makeProblem(), makeProblem()], index: 0 };
    renderWake();
  }

  function submitAnswer(value) {
    if (!challenge) return;
    const p = challenge.problems[challenge.index];
    if (Number(value) !== p.answer) {
      challenge.problems[challenge.index] = makeProblem();
      renderWake(true);
      return;
    }
    challenge.index++;
    if (challenge.index >= challenge.problems.length) confirmWake();
    else renderWake();
  }

  /** 起床確定：押した瞬間の遅刻分でペナルティを固定 */
  function confirmWake() {
    const now = new Date();
    const k = dateKey(now);
    const deadline = deadlineOf(k, state.config.target);
    const late = lateMinutesAt(now, deadline);
    const beforeLevel = hasFun ? Fun.level().level : 0;
    const amount = penaltyFor(late);
    state.days[k] = {
      status: "done",
      at: now.toISOString(),
      lateMin: late,
      amount,
    };
    challenge = null;
    save(state);
    render();
    celebrateWake(amount, late, beforeLevel);
  }

  function celebrateWake(amount, late, beforeLevel) {
    if (!hasFun) return;
    Fun.vibrate(amount === 0 ? [10, 40, 10] : 20);
    if (amount === 0) {
      Fun.Sound.success();
      Fun.confetti({ count: 160, colors: ["#f59e0b", "#fde047", "#22c55e", "#6366f1"] });
      Fun.toast("時間内に起床！ ペナルティ ¥0 🌞", { icon: "🌞" });
    } else {
      Fun.Sound.coin();
      Fun.confetti({ count: 40 });
      Fun.toast(`起床確認！ ${late}分遅刻で確定`, { icon: "🛏️" });
    }
    const after = Fun.level();
    if (after.level > beforeLevel) {
      Fun.Sound.levelUp();
      Fun.confetti({ count: 160 });
      Fun.toast(`レベルアップ！ Lv.${after.level}「${after.title}」`, { icon: "⭐" });
    }
  }

  // ---- 描画 -----------------------------------------------------------------

  function renderTodayLabel() {
    const now = new Date();
    todayLabelEl.textContent = `${now.getMonth() + 1}月${now.getDate()}日（${WEEKDAYS[now.getDay()]}）`;
  }

  function fmtTime(d) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function renderStatus() {
    const info = todayInfo();
    const { target, cap } = state.config;
    let icon, title, sub, cls;

    if (info.kind === "done") {
      if (info.amount > 0) {
        icon = "🛏️";
        title = `${info.late}分の遅刻で確定`;
        sub = `本日のペナルティ ${yen(info.amount)}`;
        cls = "is-failed";
      } else {
        icon = "🌞";
        title = "時間内に起床！";
        sub = "今日のペナルティは ¥0";
        cls = "is-done";
      }
    } else if (info.kind === "before-start") {
      icon = "🌱";
      title = "チャレンジ開始";
      sub = `明日 ${target} からカウント開始`;
      cls = "is-before";
    } else if (info.late === 0) {
      // active・締切前
      icon = "⏰";
      title = `${target} までに起きよう`;
      sub = `今押せば ¥0（遅刻すると ${yen(state.config.ratePerMin)}/分・上限 ${yen(cap)}）`;
      cls = "is-pending";
    } else {
      // active・遅刻中（ライブ加算）
      const atCap = info.amount >= cap;
      icon = "💸";
      title = `${info.late}分 遅刻中… ${yen(info.amount)}`;
      sub = atCap
        ? `上限 ${yen(cap)} に到達。これ以上は増えません`
        : `1分ごとに +${yen(state.config.ratePerMin)}（上限 ${yen(cap)} ／ ${capMinutes()}分で頭打ち）`;
      cls = "is-failed";
    }

    statusCardEl.className = `morning-status ${cls}`;
    statusCardEl.innerHTML = `
      <div class="morning-status__icon">${icon}</div>
      <div class="morning-status__title">${title}</div>
      <div class="morning-status__sub">${sub}</div>`;
  }

  function renderWake() {
    const info = todayInfo();
    if (info.kind !== "active") {
      wakeAreaEl.innerHTML = "";
      return;
    }

    if (!challenge) {
      const label = info.late > 0 ? `起きた！（加算を止める）` : "起きた！";
      wakeAreaEl.innerHTML = `
        <button class="wake__btn" id="wakeBtn">${label}</button>
        <p class="wake__note">押すと寝ぼけ防止の計算（3問）が出ます</p>`;
      document.getElementById("wakeBtn").addEventListener("click", startChallenge);
      return;
    }

    const p = challenge.problems[challenge.index];
    const wrong = arguments[0] === true;
    wakeAreaEl.innerHTML = `
      <div class="wake__challenge">
        <div class="wake__progress">${challenge.index + 1} / ${challenge.problems.length} 問目</div>
        <div class="wake__problem">${p.a} ${p.op} ${p.b} = ?</div>
        <form id="answerForm" autocomplete="off">
          <input class="wake__answer" id="answerInput" type="number" inputmode="numeric"
            placeholder="答え" aria-label="答え" required />
          <button class="btn btn--primary" type="submit">決定</button>
        </form>
        ${wrong ? '<p class="wake__wrong">不正解。もう一度！</p>' : ""}
      </div>`;
    const input = document.getElementById("answerInput");
    input.focus();
    document.getElementById("answerForm").addEventListener("submit", (e) => {
      e.preventDefault();
      submitAnswer(input.value);
    });
  }

  function renderBalance() {
    const locked = lockedBalance();
    const info = todayInfo();
    const live = info.kind === "active" ? info.amount : 0;
    const total = locked + live;
    const hasPayUrl = !!state.config.payUrl;

    balanceCardEl.innerHTML = `
      <div class="balance__main">
        <div class="balance__label">未払いのペナルティ残高</div>
        <div class="balance__amount ${total > 0 ? "is-owed" : ""}">${yen(total)}</div>
        ${live > 0 ? `<div class="balance__live">うち今日分 ${yen(live)}（加算中）</div>` : ""}
      </div>
      <div class="balance__stats">
        <span>✅ 達成 ${doneCount()}</span>
        <span>💸 遅刻 ${failedCount()}</span>
      </div>
      <div class="balance__actions">
        <button class="btn btn--primary" id="payBtn" ${locked <= 0 ? "disabled" : ""}>
          支払う${hasPayUrl ? "" : "（リンク未設定）"}
        </button>
      </div>
      <p class="settings__hint">確定分のみ支払えます（今日分は起床確認後に確定）。</p>`;

    const payBtn = document.getElementById("payBtn");
    if (payBtn) payBtn.addEventListener("click", payNow);
  }

  function renderLog() {
    const rows = [];
    let cursor = new Date();
    for (let i = 0; i < 14; i++) {
      const k = dateKey(cursor);
      const rec = state.days[k];
      let badge, text;
      if (rec?.status === "done") {
        if (rec.amount > 0) {
          badge = "🛏️";
          text = `${rec.lateMin}分遅刻 −${yen(rec.amount)}`;
        } else {
          badge = "✅";
          text = "時間内に達成";
        }
      } else if (rec?.status === "failed") {
        badge = "💸";
        text = `未起床 −${yen(rec.amount || 0)}（上限）`;
      } else {
        const dl = deadlineOf(k, state.config.target);
        if (dl.getTime() <= new Date(state.since).getTime()) {
          badge = "·";
          text = "対象外";
        } else if (k === dateKey(new Date())) {
          badge = "⏳";
          text = "進行中";
        } else {
          badge = "·";
          text = "—";
        }
      }
      rows.push(`
        <li class="log__row">
          <span class="log__date">${cursor.getMonth() + 1}/${cursor.getDate()}（${WEEKDAYS[cursor.getDay()]}）</span>
          <span class="log__badge">${badge}</span>
          <span class="log__text">${text}</span>
        </li>`);
      cursor = addDays(cursor, -1);
    }
    logListEl.innerHTML = rows.join("");
  }

  function renderSettings() {
    targetTimeEl.value = state.config.target;
    ratePerMinEl.value = state.config.ratePerMin;
    capEl.value = state.config.cap;
    payUrlEl.value = state.config.payUrl;
  }

  function renderMascot() {
    if (!hasMascot || !mascotEl) return;
    const info = todayInfo();
    let mood;
    if (info.kind === "done") mood = info.amount === 0 ? "proud" : "sad";
    else if (info.kind === "active" && info.late > 0) mood = "sad";
    else mood = "sleepy";
    // 最長ストリーク的な指標として「達成日数」で成長させる
    const bestStreak = doneCount();
    const state = Mascot.computeState({ bestStreak, mood, totalHabits: 1, doneToday: 0 });
    Mascot.render(mascotEl, state);
  }

  function render() {
    renderTodayLabel();
    renderMascot();
    renderStatus();
    renderWake();
    renderBalance();
    renderLog();
  }

  // ---- 操作 -----------------------------------------------------------------

  function payNow() {
    const bal = lockedBalance();
    if (bal <= 0) return;
    if (state.config.payUrl) window.open(state.config.payUrl, "_blank", "noopener");
    if (confirm(`${yen(bal)} を支払いましたか？\n「OK」で確定残高をリセットします。`)) {
      state.payments.push({ amount: bal, at: new Date().toISOString() });
      save(state);
      render();
    }
  }

  settingsFormEl.addEventListener("submit", (e) => {
    e.preventDefault();
    state.config.target = targetTimeEl.value || "06:30";
    state.config.ratePerMin = Math.max(0, Number(ratePerMinEl.value) || 0);
    state.config.cap = Math.max(0, Number(capEl.value) || 0);
    state.config.payUrl = payUrlEl.value.trim();
    save(state);
    settle();
    render();
    document.getElementById("settings").open = false;
  });

  // ---- テーマ（習慣アプリと共有） -------------------------------------------

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeToggleEl.textContent = theme === "dark" ? "☀️" : "🌙";
    localStorage.setItem(THEME_KEY, theme);
  }
  themeToggleEl.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    applyTheme(current === "dark" ? "light" : "dark");
  });
  (function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) applyTheme(saved);
    else if (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches)
      applyTheme("dark");
    else applyTheme("light");
  })();

  // ---- 楽しさ・PWA連携 ------------------------------------------------------

  if (hasFun) {
    Fun.registerSW();
    Fun.registerInstallButton(installBtnEl);

    if (soundToggleEl) {
      soundToggleEl.textContent = Fun.Sound.on ? "🔊" : "🔇";
      soundToggleEl.addEventListener("click", () => {
        soundToggleEl.textContent = Fun.Sound.toggle() ? "🔊" : "🔇";
      });
    }

    if (shareBtnEl) {
      shareBtnEl.addEventListener("click", () => {
        const info = todayInfo();
        const lv = Fun.level();
        let emoji, title, lines;
        if (info.kind === "done" && info.amount === 0) {
          emoji = "🌞";
          title = "時間内に起床！";
          lines = [`目標 ${state.config.target} を達成`, `Lv.${lv.level}「${lv.title}」`];
        } else if (info.kind === "done") {
          emoji = "🛏️";
          title = `${info.late}分遅刻で確定`;
          lines = [`ペナルティ ${yen(info.amount)}`, `Lv.${lv.level}「${lv.title}」`];
        } else {
          emoji = "⏰";
          title = "朝チャレンジ挑戦中";
          lines = [`目標 ${state.config.target}`, `Lv.${lv.level}「${lv.title}」`];
        }
        Fun.share({
          emoji,
          title,
          lines,
          accent: "#f59e0b",
          text: `「つづける」の朝チャレンジに挑戦中！ 目標${state.config.target}起床`,
        });
      });
    }
  }

  // ---- リマインダー ---------------------------------------------------------

  function refreshReminderUI() {
    if (!hasReminders || !remMorningEl) return;
    const s = Reminders.get();
    remMorningEl.checked = s.morning;
    remHabitEl.checked = s.habit;
    remHabitTimeEl.value = s.habitTime;
    const p = Reminders.permission();
    if (!Reminders.supported()) {
      remHintEl.textContent = "この環境は通知に対応していません。";
      remMorningEl.disabled = remHabitEl.disabled = true;
    } else if (p === "denied") {
      remHintEl.textContent = "通知がブロックされています。ブラウザ設定で許可してください。";
    } else {
      remHintEl.textContent = "※アプリを開いている間に通知します（完全な常時通知にはPush対応が必要）。";
    }
  }

  if (hasReminders) {
    Reminders.init();
    refreshReminderUI();
    if (remMorningEl) {
      remMorningEl.addEventListener("change", async () => {
        const on = await Reminders.toggle("morning", remMorningEl.checked);
        remMorningEl.checked = on;
        if (on && hasFun) Fun.toast("起床リマインダーをオンにしました", { icon: "🔔" });
        refreshReminderUI();
      });
      remHabitEl.addEventListener("change", async () => {
        const on = await Reminders.toggle("habit", remHabitEl.checked);
        remHabitEl.checked = on;
        refreshReminderUI();
      });
      remHabitTimeEl.addEventListener("change", () => Reminders.setHabitTime(remHabitTimeEl.value));
    }
  }

  // ---- 起動 -----------------------------------------------------------------

  renderSettings();
  settle();
  render();

  // 別タブでの更新に追従
  window.addEventListener("storage", (e) => {
    if (e.key === STORE_KEY) {
      state = load();
      renderSettings();
      settle();
      render();
    }
  });

  // 遅刻中はライブ加算を見せるため毎秒更新。確定や日付またぎも拾う。
  setInterval(() => {
    if (challenge) return; // 入力中は触らない
    settle();
    renderStatus();
    renderBalance();
  }, 1000);
})();

/* 朝チャレンジ — 起きられなかったらペナルティが積み上がるコミットメント装置
 * データは localStorage に保存。外部通信なし。実際の引き落としは行わない。
 */
(function () {
  "use strict";

  const STORE_KEY = "tsuzukeru.morning.v1";
  const THEME_KEY = "tsuzukeru.theme"; // 習慣アプリとテーマを共有
  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

  /**
   * @typedef {{
   *   config: { target: string, penalty: number, payUrl: string },
   *   since: string,                       // チャレンジ開始の ISO 日時
   *   days: Record<string, { status: "done"|"failed", at?: string, amount?: number }>,
   *   payments: Array<{ amount: number, at: string }>
   * }} State
   */

  // ---- データ層 -------------------------------------------------------------

  /** @returns {State} */
  function load() {
    const fallback = () => ({
      config: { target: "06:30", penalty: 500, payUrl: "" },
      since: new Date().toISOString(),
      days: {},
      payments: [],
    });
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return fallback();
      const data = JSON.parse(raw);
      // 最低限の形を保証
      return {
        config: {
          target: data?.config?.target || "06:30",
          penalty: Number.isFinite(data?.config?.penalty) ? data.config.penalty : 500,
          payUrl: data?.config?.payUrl || "",
        },
        since: data?.since || new Date().toISOString(),
        days: data?.days && typeof data.days === "object" ? data.days : {},
        payments: Array.isArray(data?.payments) ? data.payments : [],
      };
    } catch (e) {
      console.warn("データの読み込みに失敗しました", e);
      return fallback();
    }
  }

  /** @param {State} s */
  function save(s) {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  }

  // ---- 日付ユーティリティ ---------------------------------------------------

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
    return "¥" + Number(n).toLocaleString("ja-JP");
  }

  // ---- 状態 -----------------------------------------------------------------

  let state = load();

  // ---- 精算：過ぎた日で未確認のものを失敗として確定する --------------------

  function settle() {
    const now = new Date();
    const since = new Date(state.since);
    // 開始日から今日まで走査
    let cursor = new Date(since);
    cursor.setHours(0, 0, 0, 0);
    const todayK = dateKey(now);

    let changed = false;
    while (dateKey(cursor) <= todayK) {
      const k = dateKey(cursor);
      const dl = deadlineOf(k, state.config.target);
      const eligible = dl.getTime() > since.getTime(); // 開始時点で締切前だった日のみ対象
      const past = now.getTime() >= dl.getTime();

      if (eligible && past && !state.days[k]) {
        // 締切を過ぎても確認がない → 失敗確定
        state.days[k] = {
          status: "failed",
          amount: state.config.penalty,
        };
        changed = true;
      }
      cursor = addDays(cursor, 1);
    }
    if (changed) save(state);
  }

  /** 今日の状態を返す: "done" | "failed" | "pending" | "before-start" */
  function todayStatus() {
    const now = new Date();
    const k = dateKey(now);
    if (state.days[k]) return state.days[k].status;
    const dl = deadlineOf(k, state.config.target);
    if (dl.getTime() <= new Date(state.since).getTime()) return "before-start";
    return now.getTime() < dl.getTime() ? "pending" : "failed";
  }

  function balance() {
    const owed = Object.values(state.days)
      .filter((d) => d.status === "failed")
      .reduce((sum, d) => sum + (d.amount || 0), 0);
    const paid = state.payments.reduce((sum, p) => sum + p.amount, 0);
    return Math.max(0, owed - paid);
  }

  function failedCount() {
    return Object.values(state.days).filter((d) => d.status === "failed").length;
  }
  function doneCount() {
    return Object.values(state.days).filter((d) => d.status === "done").length;
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
  const penaltyEl = document.getElementById("penalty");
  const payUrlEl = document.getElementById("payUrl");

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
    challenge = {
      problems: [makeProblem(), makeProblem(), makeProblem()],
      index: 0,
    };
    renderWake();
  }

  function submitAnswer(value) {
    if (!challenge) return;
    const p = challenge.problems[challenge.index];
    if (Number(value) !== p.answer) {
      // 間違い → 新しい問題に差し替えて続行
      challenge.problems[challenge.index] = makeProblem();
      renderWake(true);
      return;
    }
    challenge.index++;
    if (challenge.index >= challenge.problems.length) {
      confirmWake();
    } else {
      renderWake();
    }
  }

  function confirmWake() {
    const k = dateKey(new Date());
    state.days[k] = { status: "done", at: new Date().toISOString() };
    challenge = null;
    save(state);
    render();
  }

  // ---- 描画 -----------------------------------------------------------------

  function renderTodayLabel() {
    const now = new Date();
    todayLabelEl.textContent = `${now.getMonth() + 1}月${now.getDate()}日（${WEEKDAYS[now.getDay()]}）`;
  }

  function renderStatus() {
    const st = todayStatus();
    const target = state.config.target;
    let icon, title, sub, cls;

    if (st === "done") {
      const at = state.days[dateKey(new Date())].at;
      const t = at ? new Date(at) : null;
      icon = "🌞";
      title = "今日は達成！";
      sub = t
        ? `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")} に起床を確認`
        : "起床を確認しました";
      cls = "is-done";
    } else if (st === "pending") {
      icon = "⏰";
      title = `${target} までに起きよう`;
      sub = `間に合わなければ ${yen(state.config.penalty)} のペナルティ`;
      cls = "is-pending";
    } else if (st === "failed") {
      icon = "💸";
      title = "今日は時間切れ…";
      sub = `${yen(state.config.penalty)} が残高に加算されました`;
      cls = "is-failed";
    } else {
      icon = "🌱";
      title = "チャレンジ開始";
      sub = `明日 ${target} からカウント開始`;
      cls = "is-before";
    }

    statusCardEl.className = `morning-status ${cls}`;
    statusCardEl.innerHTML = `
      <div class="morning-status__icon">${icon}</div>
      <div class="morning-status__title">${title}</div>
      <div class="morning-status__sub">${sub}</div>`;
  }

  function renderWake() {
    const st = todayStatus();

    if (st !== "pending") {
      // 起きるべき時間帯ではない
      wakeAreaEl.innerHTML = "";
      return;
    }

    if (!challenge) {
      wakeAreaEl.innerHTML = `
        <button class="wake__btn" id="wakeBtn">起きた！</button>
        <p class="wake__note">押すと寝ぼけ防止の計算（3問）が出ます</p>`;
      document.getElementById("wakeBtn").addEventListener("click", startChallenge);
      return;
    }

    // チャレンジ中
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
    const bal = balance();
    const hasPayUrl = !!state.config.payUrl;
    balanceCardEl.innerHTML = `
      <div class="balance__main">
        <div class="balance__label">未払いのペナルティ残高</div>
        <div class="balance__amount ${bal > 0 ? "is-owed" : ""}">${yen(bal)}</div>
      </div>
      <div class="balance__stats">
        <span>✅ 達成 ${doneCount()}</span>
        <span>💸 失敗 ${failedCount()}</span>
      </div>
      <div class="balance__actions">
        <button class="btn btn--primary" id="payBtn" ${bal <= 0 ? "disabled" : ""}>
          支払う${hasPayUrl ? "" : "（リンク未設定）"}
        </button>
      </div>`;

    const payBtn = document.getElementById("payBtn");
    if (payBtn) payBtn.addEventListener("click", payNow);
  }

  function renderLog() {
    // 直近14日を新しい順で
    const rows = [];
    let cursor = new Date();
    for (let i = 0; i < 14; i++) {
      const k = dateKey(cursor);
      const rec = state.days[k];
      let badge, text;
      if (rec?.status === "done") {
        badge = "✅";
        text = "達成";
      } else if (rec?.status === "failed") {
        badge = "💸";
        text = `失敗 −${yen(rec.amount || 0)}`;
      } else {
        const dl = deadlineOf(k, state.config.target);
        if (dl.getTime() <= new Date(state.since).getTime()) {
          badge = "·";
          text = "対象外";
        } else if (new Date().getTime() < dl.getTime()) {
          badge = "⏳";
          text = "これから";
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
    penaltyEl.value = state.config.penalty;
    payUrlEl.value = state.config.payUrl;
  }

  function render() {
    renderTodayLabel();
    renderStatus();
    renderWake();
    renderBalance();
    renderLog();
  }

  // ---- 操作 -----------------------------------------------------------------

  function payNow() {
    const bal = balance();
    if (bal <= 0) return;
    if (state.config.payUrl) {
      window.open(state.config.payUrl, "_blank", "noopener");
    }
    if (confirm(`${yen(bal)} を支払いましたか？\n「OK」で残高をリセットします。`)) {
      state.payments.push({ amount: bal, at: new Date().toISOString() });
      save(state);
      render();
    }
  }

  settingsFormEl.addEventListener("submit", (e) => {
    e.preventDefault();
    state.config.target = targetTimeEl.value || "06:30";
    state.config.penalty = Math.max(0, Number(penaltyEl.value) || 0);
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

  // 締切またぎに備え、1分ごとに再評価（チャレンジ入力中は触らない）
  setInterval(() => {
    if (challenge) return;
    settle();
    render();
  }, 60 * 1000);
})();

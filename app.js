/* つづける — シンプルな習慣化アプリ
 * データは localStorage に保存。外部通信なし。
 */
(function () {
  "use strict";

  const STORAGE_KEY = "tsuzukeru.habits.v1";
  const THEME_KEY = "tsuzukeru.theme";
  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

  /** @typedef {{ id: string, name: string, createdAt: string, log: Record<string, boolean> }} Habit */

  // ---- データ層 -------------------------------------------------------------

  /** @returns {Habit[]} */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn("データの読み込みに失敗しました", e);
      return [];
    }
  }

  /** @param {Habit[]} habits */
  function save(habits) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(habits));
  }

  // ---- 日付ユーティリティ ---------------------------------------------------

  /** ローカルタイムの YYYY-MM-DD を返す */
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

  /** 直近7日間（今日を含む）の Date 配列を古い順で返す */
  function lastSevenDays() {
    const today = new Date();
    const days = [];
    for (let i = 6; i >= 0; i--) days.push(addDays(today, -i));
    return days;
  }

  /** 今日まで連続して達成した日数を計算 */
  function currentStreak(habit) {
    let streak = 0;
    let cursor = new Date();
    // 今日が未達成でも、昨日までの連続記録は維持する
    if (!habit.log[dateKey(cursor)]) cursor = addDays(cursor, -1);
    while (habit.log[dateKey(cursor)]) {
      streak++;
      cursor = addDays(cursor, -1);
    }
    return streak;
  }

  // ---- 状態 -----------------------------------------------------------------

  let habits = load();

  // ---- DOM 参照 -------------------------------------------------------------

  const listEl = document.getElementById("habitList");
  const emptyEl = document.getElementById("emptyState");
  const summaryEl = document.getElementById("summary");
  const formEl = document.getElementById("addForm");
  const inputEl = document.getElementById("habitInput");
  const todayLabelEl = document.getElementById("todayLabel");
  const themeToggleEl = document.getElementById("themeToggle");

  // ---- 描画 -----------------------------------------------------------------

  function renderTodayLabel() {
    const now = new Date();
    todayLabelEl.textContent = `${now.getMonth() + 1}月${now.getDate()}日（${WEEKDAYS[now.getDay()]}）`;
  }

  function renderSummary() {
    const todayK = dateKey(new Date());
    const total = habits.length;
    const doneToday = habits.filter((h) => h.log[todayK]).length;
    const bestStreak = habits.reduce((max, h) => Math.max(max, currentStreak(h)), 0);
    const rate = total ? Math.round((doneToday / total) * 100) : 0;

    summaryEl.innerHTML = `
      <div class="summary__card">
        <div class="summary__num">${doneToday}/${total}</div>
        <div class="summary__label">今日の達成</div>
      </div>
      <div class="summary__card">
        <div class="summary__num">${rate}%</div>
        <div class="summary__label">達成率</div>
      </div>
      <div class="summary__card">
        <div class="summary__num">${bestStreak}</div>
        <div class="summary__label">最長ストリーク</div>
      </div>`;
  }

  function renderWeek(habit) {
    const todayK = dateKey(new Date());
    return lastSevenDays()
      .map((d) => {
        const k = dateKey(d);
        const done = !!habit.log[k];
        const isToday = k === todayK;
        return `
          <div class="week__day">
            <div class="week__dot ${done ? "done" : ""} ${isToday ? "today" : ""}">${done ? "✓" : ""}</div>
            <div class="week__label">${WEEKDAYS[d.getDay()]}</div>
          </div>`;
      })
      .join("");
  }

  function render() {
    renderTodayLabel();
    renderSummary();

    listEl.innerHTML = "";
    emptyEl.hidden = habits.length > 0;

    const todayK = dateKey(new Date());

    for (const habit of habits) {
      const done = !!habit.log[todayK];
      const streak = currentStreak(habit);

      const li = document.createElement("li");
      li.className = "habit";
      li.innerHTML = `
        <div class="habit__top">
          <button class="habit__check ${done ? "done" : ""}" data-action="toggle" data-id="${habit.id}"
            aria-pressed="${done}" aria-label="${done ? "完了を取り消す" : "完了にする"}">✓</button>
          <div class="habit__body">
            <div class="habit__name ${done ? "done" : ""}"></div>
            <div class="habit__streak">${
              streak > 0
                ? `🔥 <strong>${streak}</strong>日連続`
                : "今日から始めよう"
            }</div>
          </div>
          <button class="habit__delete" data-action="delete" data-id="${habit.id}" aria-label="削除">✕</button>
        </div>
        <div class="week">${renderWeek(habit)}</div>`;

      // 名前はテキストとして安全に挿入（XSS防止）
      li.querySelector(".habit__name").textContent = habit.name;
      listEl.appendChild(li);
    }
  }

  // ---- 操作 -----------------------------------------------------------------

  function addHabit(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    habits.push({
      id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()),
      name: trimmed,
      createdAt: new Date().toISOString(),
      log: {},
    });
    save(habits);
    render();
  }

  function toggleToday(id) {
    const habit = habits.find((h) => h.id === id);
    if (!habit) return;
    const k = dateKey(new Date());
    if (habit.log[k]) delete habit.log[k];
    else habit.log[k] = true;
    save(habits);
    render();
  }

  function deleteHabit(id) {
    const habit = habits.find((h) => h.id === id);
    if (!habit) return;
    if (!confirm(`「${habit.name}」を削除しますか？記録もすべて消えます。`)) return;
    habits = habits.filter((h) => h.id !== id);
    save(habits);
    render();
  }

  // ---- イベント -------------------------------------------------------------

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    addHabit(inputEl.value);
    inputEl.value = "";
    inputEl.focus();
  });

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === "toggle") toggleToday(id);
    else if (action === "delete") deleteHabit(id);
  });

  // ---- テーマ ---------------------------------------------------------------

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

  // 別タブでの更新に追従
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      habits = load();
      render();
    }
  });

  render();
})();

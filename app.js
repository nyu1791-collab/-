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
  const levelbarEl = document.getElementById("levelbar");
  const mascotEl = document.getElementById("mascot");
  const heatmapEl = document.getElementById("heatmap");
  const soundToggleEl = document.getElementById("soundToggle");
  const installBtnEl = document.getElementById("installBtn");
  const shareBtnEl = document.getElementById("shareBtn");

  const MILESTONES = [3, 7, 14, 30, 50, 100, 200, 365];
  const ONBOARD_KEY = "tsuzukeru.onboarded";
  const MORNING_KEY = "tsuzukeru.morning.v2";
  const hasFun = typeof window.Fun !== "undefined";
  const hasMascot = typeof window.Mascot !== "undefined";

  // ヒートマップで表示中の月（0=今月、-1=先月…）
  let monthOffset = 0;

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

  function renderMascot() {
    if (!hasMascot || !mascotEl) return;
    const todayK = dateKey(new Date());
    const doneToday = habits.filter((h) => h.log[todayK]).length;
    const bestStreak = habits.reduce((m, h) => Math.max(m, currentStreak(h)), 0);
    const state = Mascot.computeState({
      bestStreak,
      doneToday,
      totalHabits: habits.length,
    });
    Mascot.render(mascotEl, state);
  }

  /** 全習慣を通した、その日の達成割合(0..1)。習慣ゼロなら0 */
  function dayRatio(k) {
    if (!habits.length) return 0;
    const done = habits.filter((h) => h.log[k]).length;
    return done / habits.length;
  }

  function renderHeatmap() {
    if (!heatmapEl) return;
    if (!habits.length) {
      heatmapEl.innerHTML = "";
      return;
    }
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() + monthOffset);
    const year = base.getFullYear();
    const month = base.getMonth();
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startWeekday = first.getDay(); // 0=日
    const todayK = dateKey(new Date());

    let cells = "";
    for (let i = 0; i < startWeekday; i++) cells += `<div class="heatmap__cell is-empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const k = dateKey(new Date(year, month, d));
      const ratio = dayRatio(k);
      let lvl = 0;
      if (ratio > 0) lvl = ratio >= 1 ? 4 : ratio >= 0.66 ? 3 : ratio >= 0.34 ? 2 : 1;
      const today = k === todayK ? " is-today" : "";
      cells += `<div class="heatmap__cell lvl-${lvl}${today}" title="${k}：${Math.round(ratio * 100)}%"><span>${d}</span></div>`;
    }

    const monthLabel = `${year}年${month + 1}月`;
    const nextDisabled = monthOffset >= 0 ? "disabled" : "";
    heatmapEl.innerHTML = `
      <div class="heatmap__head">
        <button class="heatmap__nav" data-month="-1" aria-label="前の月">‹</button>
        <span class="heatmap__title">${monthLabel} の達成カレンダー</span>
        <button class="heatmap__nav" data-month="1" ${nextDisabled} aria-label="次の月">›</button>
      </div>
      <div class="heatmap__weekdays">${["日", "月", "火", "水", "木", "金", "土"]
        .map((w) => `<span>${w}</span>`)
        .join("")}</div>
      <div class="heatmap__grid">${cells}</div>`;
  }

  function renderLevel() {
    if (!hasFun || !levelbarEl) return;
    const lv = Fun.level();
    levelbarEl.innerHTML = `
      <div class="levelbar__row">
        <span class="levelbar__badge">Lv.${lv.level}</span>
        <span class="levelbar__title">${lv.title}</span>
        <span class="levelbar__xp">${lv.into} / ${lv.per} XP</span>
      </div>
      <div class="levelbar__track"><div class="levelbar__fill" style="width:${Math.round(lv.ratio * 100)}%"></div></div>`;
  }

  function render() {
    renderTodayLabel();
    renderMascot();
    renderLevel();
    renderSummary();
    renderHeatmap();

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

  function toggleToday(id, originEl) {
    const habit = habits.find((h) => h.id === id);
    if (!habit) return;
    const k = dateKey(new Date());
    const wasDone = !!habit.log[k];
    const beforeLevel = hasFun ? Fun.level().level : 0;

    if (wasDone) delete habit.log[k];
    else habit.log[k] = true;
    save(habits);
    render();

    if (!wasDone) celebrateCheck(habit, originEl, beforeLevel);
  }

  function celebrateCheck(habit, originEl, beforeLevel) {
    if (!hasFun) return;
    const streak = currentStreak(habit);

    // チェック地点から小さく紙吹雪＋コイン音
    let origin;
    if (originEl) {
      const r = originEl.getBoundingClientRect();
      origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    Fun.Sound.coin();
    Fun.vibrate(15);
    Fun.confetti({ count: 40, origin });

    // 連続記録の節目で大きく祝う
    if (MILESTONES.includes(streak)) {
      Fun.Sound.success();
      Fun.confetti({ count: 160 });
      Fun.toast(`${streak}日連続！その調子！`, { icon: "🔥" });
    }

    // レベルアップ
    const afterLevel = Fun.level();
    if (afterLevel.level > beforeLevel) {
      Fun.Sound.levelUp();
      Fun.confetti({ count: 160 });
      Fun.toast(`レベルアップ！ Lv.${afterLevel.level}「${afterLevel.title}」`, { icon: "⭐" });
    }
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
    if (action === "toggle") toggleToday(id, btn);
    else if (action === "delete") deleteHabit(id);
  });

  if (heatmapEl) {
    heatmapEl.addEventListener("click", (e) => {
      const nav = e.target.closest("[data-month]");
      if (!nav || nav.disabled) return;
      const next = monthOffset + Number(nav.dataset.month);
      if (next > 0) return; // 未来は見ない
      monthOffset = next;
      renderHeatmap();
    });
  }

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

  // ---- 楽しさ・PWA連携 ------------------------------------------------------

  if (typeof window.Reminders !== "undefined") Reminders.init();

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
        const lv = Fun.level();
        const todayK = dateKey(new Date());
        const doneToday = habits.filter((h) => h.log[todayK]).length;
        const best = habits.reduce((m, h) => Math.max(m, currentStreak(h)), 0);
        Fun.share({
          emoji: "🔥",
          title: `${best}日連続つづけ中`,
          lines: [
            `Lv.${lv.level}「${lv.title}」`,
            `習慣 ${habits.length}件 ／ 今日 ${doneToday}件達成`,
          ],
          text: `「つづける」で習慣化チャレンジ中！ 最長${best}日連続・Lv.${lv.level}`,
        });
      });
    }
  }

  // ---- はじめての案内（オンボーディング） -----------------------------------

  const SUGGESTIONS = [
    "朝に水を飲む",
    "5分ストレッチ",
    "読書を10分",
    "散歩する",
    "日記を書く",
    "早寝する",
  ];

  function setMorningTarget(target) {
    try {
      const raw = localStorage.getItem(MORNING_KEY);
      const data = raw ? JSON.parse(raw) : null;
      if (data && data.config) {
        data.config.target = target;
        localStorage.setItem(MORNING_KEY, JSON.stringify(data));
      } else {
        localStorage.setItem(
          MORNING_KEY,
          JSON.stringify({
            config: { target, ratePerMin: 100, cap: 1000, payUrl: "" },
            since: new Date().toISOString(),
            days: {},
            payments: [],
          })
        );
      }
    } catch (_) {}
  }

  function startOnboarding() {
    const picked = new Set();
    const overlay = document.createElement("div");
    overlay.className = "onboard";
    overlay.innerHTML = `
      <div class="onboard__box">
        <div class="onboard__mascot" id="onboardMascot"></div>
        <h2 class="onboard__title">ようこそ、つづけるへ！</h2>
        <p class="onboard__lead">小さな一歩から始めよう。相棒の「ひだまり」が一緒に育ちます。</p>

        <p class="onboard__q">① はじめる習慣を選ぼう（複数OK・あとで変更できます）</p>
        <div class="onboard__chips" id="onboardChips">
          ${SUGGESTIONS.map((s) => `<button type="button" class="chip" data-text="${s}">${s}</button>`).join("")}
        </div>
        <input class="onboard__input" id="onboardCustom" type="text" maxlength="40" placeholder="自由に入力して追加" />

        <p class="onboard__q">② 朝は何時に起きる？</p>
        <input class="onboard__time" id="onboardTime" type="time" value="06:30" />

        <div class="onboard__actions">
          <button class="btn btn--primary" id="onboardStart">はじめる 🚀</button>
          <button class="btn onboard__skip" id="onboardSkip">スキップ</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));

    if (hasMascot) {
      Mascot.render(
        document.getElementById("onboardMascot"),
        { stage: Mascot.STAGES[1], mood: "happy", line: "" },
        { withBubble: false }
      );
    }

    const chips = overlay.querySelector("#onboardChips");
    chips.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      const text = chip.dataset.text;
      if (picked.has(text)) picked.delete(text);
      else picked.add(text);
      chip.classList.toggle("is-on");
    });

    const finish = (withData) => {
      if (withData) {
        const custom = overlay.querySelector("#onboardCustom").value.trim();
        if (custom) picked.add(custom);
        for (const name of picked) addHabit(name);
        const target = overlay.querySelector("#onboardTime").value || "06:30";
        setMorningTarget(target);
      }
      localStorage.setItem(ONBOARD_KEY, "1");
      overlay.classList.remove("show");
      setTimeout(() => overlay.remove(), 250);
      if (withData && hasFun) {
        Fun.confetti({ count: 160 });
        Fun.toast("ようこそ！一緒にがんばろう☀️", { icon: "🎉" });
      }
      render();
    };

    overlay.querySelector("#onboardStart").addEventListener("click", () => finish(true));
    overlay.querySelector("#onboardSkip").addEventListener("click", () => finish(false));
  }

  // 別タブでの更新に追従
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      habits = load();
      render();
    }
  });

  render();

  if (!localStorage.getItem(ONBOARD_KEY) && habits.length === 0) {
    startOnboarding();
  }
})();

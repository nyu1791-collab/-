/* つづける — 統計ページ
 * 習慣・朝チャレンジのデータを集計して可視化する。読み取り専用。
 */
(function () {
  "use strict";

  const HABIT_KEY = "tsuzukeru.habits.v1";
  const MORNING_KEY = "tsuzukeru.morning.v2";
  const THEME_KEY = "tsuzukeru.theme";
  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
  const hasFun = typeof window.Fun !== "undefined";
  const hasMascot = typeof window.Mascot !== "undefined";

  // ---- データ読み込み -------------------------------------------------------

  function loadHabits() {
    try {
      const d = JSON.parse(localStorage.getItem(HABIT_KEY) || "[]");
      return Array.isArray(d) ? d : [];
    } catch (_) {
      return [];
    }
  }
  function loadMorning() {
    try {
      return JSON.parse(localStorage.getItem(MORNING_KEY) || "null");
    } catch (_) {
      return null;
    }
  }

  const habits = loadHabits();
  const morning = loadMorning();

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

  // ---- 集計：習慣 -----------------------------------------------------------

  function doneDates(habit) {
    return Object.keys(habit.log || {}).filter((k) => habit.log[k]).sort();
  }

  function longestStreak(habit) {
    const dates = doneDates(habit);
    if (!dates.length) return 0;
    let best = 1, run = 1;
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1] + "T00:00:00");
      const cur = new Date(dates[i] + "T00:00:00");
      const diff = Math.round((cur - prev) / 86400000);
      run = diff === 1 ? run + 1 : 1;
      if (run > best) best = run;
    }
    return best;
  }

  function currentStreak(habit) {
    let streak = 0;
    let cursor = new Date();
    if (!habit.log[dateKey(cursor)]) cursor = addDays(cursor, -1);
    while (habit.log[dateKey(cursor)]) {
      streak++;
      cursor = addDays(cursor, -1);
    }
    return streak;
  }

  function dayRatio(k) {
    if (!habits.length) return 0;
    return habits.filter((h) => h.log[k]).length / habits.length;
  }

  const totalCheckins = habits.reduce((s, h) => s + doneDates(h).length, 0);
  const activeDays = new Set(habits.flatMap((h) => doneDates(h))).size;
  const bestCurrent = habits.reduce((m, h) => Math.max(m, currentStreak(h)), 0);
  const bestEver = habits.reduce((m, h) => Math.max(m, longestStreak(h)), 0);

  // 直近30日達成率
  const last30 = [];
  for (let i = 29; i >= 0; i--) last30.push(dateKey(addDays(new Date(), -i)));
  const trend = last30.map(dayRatio);
  const avg30 = trend.length ? Math.round((trend.reduce((a, b) => a + b, 0) / trend.length) * 100) : 0;

  // ---- 集計：朝チャレンジ ---------------------------------------------------

  const cap = morning?.config?.cap ?? 1000;
  const mDays = morning?.days ? Object.values(morning.days) : [];
  const recorded = mDays.length;
  const doneDays = mDays.filter((d) => d.status === "done");
  const onTime = doneDays.filter((d) => d.amount === 0).length;
  const totalLost = mDays.reduce((s, d) => s + (d.amount || 0), 0);
  const totalPaid = (morning?.payments || []).reduce((s, p) => s + p.amount, 0);
  const balance = Math.max(0, totalLost - totalPaid);
  // 守ったお金 = 達成日に上限との差額で「失わずに済んだ額」
  const saved = doneDays.reduce((s, d) => s + Math.max(0, cap - (d.amount || 0)), 0);
  const onTimeRate = recorded ? Math.round((onTime / recorded) * 100) : 0;

  function yen(n) {
    return "¥" + Math.round(n).toLocaleString("ja-JP");
  }

  // ---- 描画ヘルパ -----------------------------------------------------------

  function card(num, label, sub) {
    return `<div class="statcard">
      <div class="statcard__num">${num}</div>
      <div class="statcard__label">${label}</div>
      ${sub ? `<div class="statcard__sub">${sub}</div>` : ""}
    </div>`;
  }

  function renderRecord() {
    document.getElementById("recordStats").innerHTML =
      card(totalCheckins, "総チェック数") +
      card(`${bestCurrent}日`, "継続中の最長") +
      card(`${bestEver}日`, "これまでの最長") +
      card(`${activeDays}日`, "活動した日数");
  }

  function renderMoney() {
    const el = document.getElementById("moneyStats");
    if (!morning || recorded === 0) {
      el.innerHTML = `<p class="empty" style="grid-column:1/-1">朝チャレンジの記録がまだありません。</p>`;
      return;
    }
    el.innerHTML =
      card(yen(saved), "守ったお金", "早起きで失わずに済んだ額") +
      card(yen(totalLost), "失ったお金", "遅刻・寝坊ペナルティ累計") +
      card(yen(balance), "未払い残高") +
      card(`${onTimeRate}%`, "時間内に起床");
  }

  // 折れ線＋バーのトレンドチャート（依存なし）
  function renderTrend() {
    const canvas = document.getElementById("trendChart");
    const avgEl = document.getElementById("trendAvg");
    if (!canvas) return;
    if (!habits.length) {
      avgEl.textContent = "習慣を追加すると達成率が表示されます。";
      return;
    }
    const css = getComputedStyle(document.documentElement);
    const primary = css.getPropertyValue("--primary").trim() || "#6366f1";
    const muted = css.getPropertyValue("--text-muted").trim() || "#888";
    const border = css.getPropertyValue("--border").trim() || "#ddd";

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 640;
    const H = 220;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const padL = 34, padR = 12, padT = 14, padB = 26;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    // 目盛り
    ctx.strokeStyle = border;
    ctx.fillStyle = muted;
    ctx.font = "11px sans-serif";
    ctx.lineWidth = 1;
    [0, 50, 100].forEach((pct) => {
      const y = padT + plotH * (1 - pct / 100);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
      ctx.fillText(pct + "%", 4, y + 4);
    });

    const n = trend.length;
    const bw = plotW / n;

    // バー
    trend.forEach((r, i) => {
      const h = plotH * r;
      const x = padL + i * bw + bw * 0.18;
      const y = padT + plotH - h;
      ctx.fillStyle = r >= 1 ? primary : primary + "99";
      ctx.globalAlpha = 0.35;
      ctx.fillRect(x, y, bw * 0.64, h);
      ctx.globalAlpha = 1;
    });

    // 折れ線
    ctx.strokeStyle = primary;
    ctx.lineWidth = 2;
    ctx.beginPath();
    trend.forEach((r, i) => {
      const x = padL + i * bw + bw / 2;
      const y = padT + plotH * (1 - r);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 端の日付ラベル
    ctx.fillStyle = muted;
    const firstD = addDays(new Date(), -29);
    ctx.fillText(`${firstD.getMonth() + 1}/${firstD.getDate()}`, padL, H - 8);
    const today = new Date();
    ctx.fillText("今日", W - padR - 22, H - 8);

    avgEl.textContent = `平均達成率 ${avg30}%（直近30日）`;
  }

  // 実績バッジ
  function renderBadges() {
    const defs = [
      { icon: "🌱", title: "はじめの一歩", desc: "最初のチェック", ok: totalCheckins >= 1 },
      { icon: "🔥", title: "三日坊主、突破", desc: "3日連続", ok: bestEver >= 3 },
      { icon: "📅", title: "一週間の継続", desc: "7日連続", ok: bestEver >= 7 },
      { icon: "🏅", title: "皆勤の達人", desc: "30日連続", ok: bestEver >= 30 },
      { icon: "👑", title: "百日の戦士", desc: "100日連続", ok: bestEver >= 100 },
      { icon: "🌞", title: "早起きの証", desc: "時間内に起床", ok: onTime >= 1 },
      { icon: "⏰", title: "朝の常連", desc: "時間内7回", ok: onTime >= 7 },
      { icon: "💰", title: "貯金上手", desc: "守ったお金¥1,000", ok: saved >= 1000 },
      { icon: "🎯", title: "多趣味", desc: "習慣5つ", ok: habits.length >= 5 },
      { icon: "✅", title: "チェック魔", desc: "累計50回", ok: totalCheckins >= 50 },
    ];
    const earned = defs.filter((d) => d.ok).length;
    document.getElementById("badges").innerHTML =
      `<p class="badges__count">${earned} / ${defs.length} 個を獲得</p>` +
      `<div class="badges__grid">` +
      defs
        .map(
          (d) => `<div class="badge ${d.ok ? "is-earned" : "is-locked"}">
            <div class="badge__icon">${d.ok ? d.icon : "🔒"}</div>
            <div class="badge__title">${d.ok ? d.title : "？？？"}</div>
            <div class="badge__desc">${d.desc}</div>
          </div>`
        )
        .join("") +
      `</div>`;
  }

  function renderPerHabit() {
    const el = document.getElementById("perHabit");
    if (!habits.length) {
      el.innerHTML = `<p class="empty">習慣がまだありません。</p>`;
      return;
    }
    el.innerHTML = habits
      .map((h) => {
        const cur = currentStreak(h);
        const best = longestStreak(h);
        const total = doneDates(h).length;
        const name = document.createElement("div");
        name.textContent = h.name;
        return `<div class="perhabit__row">
          <div class="perhabit__name">${name.innerHTML}</div>
          <div class="perhabit__stats">
            <span>🔥 ${cur}日</span><span>最長 ${best}日</span><span>計 ${total}回</span>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderMascot() {
    if (!hasMascot) return;
    const state = Mascot.computeState({
      bestStreak: bestEver,
      doneToday: habits.filter((h) => h.log[dateKey(new Date())]).length,
      totalHabits: habits.length,
    });
    Mascot.render(document.getElementById("mascot"), state);
  }

  function renderTodayLabel() {
    const now = new Date();
    document.getElementById("todayLabel").textContent =
      `${now.getMonth() + 1}月${now.getDate()}日（${WEEKDAYS[now.getDay()]}）`;
  }

  // ---- テーマ ---------------------------------------------------------------

  const themeToggleEl = document.getElementById("themeToggle");
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeToggleEl.textContent = theme === "dark" ? "☀️" : "🌙";
    localStorage.setItem(THEME_KEY, theme);
    renderTrend(); // 配色が変わるので再描画
  }
  themeToggleEl.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    applyTheme(cur === "dark" ? "light" : "dark");
  });
  (function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) applyTheme(saved);
    else if (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) applyTheme("dark");
    else applyTheme("light");
  })();

  // ---- シェア・PWA ----------------------------------------------------------

  if (hasFun) {
    Fun.registerSW();
    const shareBtn = document.getElementById("shareBtn");
    if (shareBtn)
      shareBtn.addEventListener("click", () => {
        Fun.share({
          emoji: "📊",
          title: `最長${bestEver}日 つづけた`,
          lines: [`総チェック ${totalCheckins}回`, `守ったお金 ${yen(saved)}`],
          text: `「つづける」での記録：最長${bestEver}日連続・総チェック${totalCheckins}回！`,
        });
      });
  }

  // ---- 起動 -----------------------------------------------------------------

  renderTodayLabel();
  renderMascot();
  renderRecord();
  renderMoney();
  renderTrend();
  renderBadges();
  renderPerHabit();

  window.addEventListener("resize", renderTrend);
})();

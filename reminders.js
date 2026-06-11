/* つづける — リマインダー通知 (window.Reminders)
 * Notification API を使った起床・習慣リマインド。
 * 注意: ブラウザ/PWA を開いている間に発火する best-effort 実装。
 *       完全なバックグラウンド配信には Push サーバーが必要。
 */
(function () {
  "use strict";

  const KEY = "tsuzukeru.reminders";
  const MORNING_KEY = "tsuzukeru.morning.v2";
  const HABIT_KEY = "tsuzukeru.habits.v1";

  const timers = {};

  function supported() {
    return typeof window !== "undefined" && "Notification" in window;
  }

  function get() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || "{}");
      return {
        morning: !!d.morning,
        habit: !!d.habit,
        habitTime: d.habitTime || "21:00",
      };
    } catch (_) {
      return { morning: false, habit: false, habitTime: "21:00" };
    }
  }

  function save(s) {
    localStorage.setItem(KEY, JSON.stringify(s));
  }

  function permission() {
    return supported() ? Notification.permission : "unsupported";
  }

  async function ensurePermission() {
    if (!supported()) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    try {
      const res = await Notification.requestPermission();
      return res === "granted";
    } catch (_) {
      return false;
    }
  }

  // ---- 各種データの読み出し -------------------------------------------------

  function morningTarget() {
    try {
      const m = JSON.parse(localStorage.getItem(MORNING_KEY) || "null");
      return (m && m.config && m.config.target) || "06:30";
    } catch (_) {
      return "06:30";
    }
  }

  function dateKey(d) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
  }

  /** 今日まだ起床確認していなければ true */
  function morningPending() {
    try {
      const m = JSON.parse(localStorage.getItem(MORNING_KEY) || "null");
      if (!m || !m.days) return true;
      return !m.days[dateKey(new Date())];
    } catch (_) {
      return true;
    }
  }

  /** 今日まだ全部はチェックできていなければ true */
  function habitPending() {
    try {
      const habits = JSON.parse(localStorage.getItem(HABIT_KEY) || "[]");
      if (!Array.isArray(habits) || !habits.length) return false;
      const k = dateKey(new Date());
      return habits.some((h) => !(h.log && h.log[k]));
    } catch (_) {
      return false;
    }
  }

  // ---- 通知 -----------------------------------------------------------------

  function notify(title, body) {
    if (permission() !== "granted") return;
    const opts = { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "tsuzukeru" };
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready
          .then((reg) => reg.showNotification(title, opts))
          .catch(() => new Notification(title, opts));
      } else {
        new Notification(title, opts);
      }
    } catch (_) {}
  }

  // ---- スケジューリング -----------------------------------------------------

  function msUntil(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    const now = new Date();
    const t = new Date();
    t.setHours(h, m, 0, 0);
    if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
    return t.getTime() - now.getTime();
  }

  function clear(kind) {
    if (timers[kind]) {
      clearTimeout(timers[kind]);
      delete timers[kind];
    }
  }

  function scheduleMorning() {
    clear("morning");
    const s = get();
    if (!s.morning || permission() !== "granted") return;
    timers.morning = setTimeout(() => {
      if (morningPending()) {
        notify("起きる時間です！ ☀️", `目標 ${morningTarget()}。アプリを開いて「起きた！」を押そう。`);
      }
      scheduleMorning(); // 翌日へ
    }, msUntil(morningTarget()));
  }

  function scheduleHabit() {
    clear("habit");
    const s = get();
    if (!s.habit || permission() !== "granted") return;
    timers.habit = setTimeout(() => {
      if (habitPending()) {
        notify("今日の習慣、できた？ ✅", "チェックして連続記録をのばそう。");
      }
      scheduleHabit();
    }, msUntil(s.habitTime));
  }

  function scheduleAll() {
    scheduleMorning();
    scheduleHabit();
  }

  // ---- 公開 -----------------------------------------------------------------

  async function toggle(kind, on) {
    const s = get();
    if (on) {
      const ok = await ensurePermission();
      if (!ok) return false;
      s[kind] = true;
    } else {
      s[kind] = false;
    }
    save(s);
    scheduleAll();
    return s[kind];
  }

  function setHabitTime(t) {
    const s = get();
    s.habitTime = t || "21:00";
    save(s);
    scheduleAll();
  }

  function init() {
    if (!supported()) return;
    scheduleAll();
  }

  window.Reminders = {
    supported,
    get,
    permission,
    toggle,
    setHabitTime,
    init,
  };
})();

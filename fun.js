/* つづける — 共有の「楽しさ」モジュール (window.Fun)
 * 紙吹雪 / 効果音 / トースト / レベル計算 / シェアカード / PWAインストール。
 * 依存ライブラリなし。複数ページから読み込む。
 */
(function () {
  "use strict";

  const HABIT_KEY = "tsuzukeru.habits.v1";
  const MORNING_KEY = "tsuzukeru.morning.v2";

  // ===== レベル / XP =========================================================
  // XPの源泉: 習慣チェック=10 / 朝チャレンジ時間内=30・遅刻でも達成=10
  const XP_PER_LEVEL = 100;
  const TITLES = [
    [1, "ねぼすけ見習い"],
    [3, "朝活ビギナー"],
    [6, "早起き名人"],
    [10, "朝の支配者"],
    [15, "太陽神"],
  ];

  function totalXp() {
    let xp = 0;
    try {
      const habits = JSON.parse(localStorage.getItem(HABIT_KEY) || "[]");
      if (Array.isArray(habits))
        for (const h of habits)
          xp += Object.values(h.log || {}).filter(Boolean).length * 10;
    } catch (_) {}
    try {
      const m = JSON.parse(localStorage.getItem(MORNING_KEY) || "null");
      if (m && m.days)
        for (const d of Object.values(m.days))
          if (d.status === "done") xp += d.amount === 0 ? 30 : 10;
    } catch (_) {}
    return xp;
  }

  function level(xp = totalXp()) {
    const lv = Math.floor(xp / XP_PER_LEVEL) + 1;
    const into = xp % XP_PER_LEVEL;
    let title = TITLES[0][1];
    for (const [need, t] of TITLES) if (lv >= need) title = t;
    return { xp, level: lv, into, per: XP_PER_LEVEL, title, ratio: into / XP_PER_LEVEL };
  }

  // ===== 効果音 (WebAudio・ファイル不要) =====================================
  let ac = null;
  let soundOn = localStorage.getItem("tsuzukeru.sound") !== "off";
  function ctx() {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === "suspended") ac.resume();
      return ac;
    } catch (_) {
      return null;
    }
  }
  function tone(freq, t0, dur, type, gain) {
    const c = ctx();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || "sine";
    o.frequency.value = freq;
    const start = c.currentTime + t0;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain || 0.18, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(c.destination);
    o.start(start);
    o.stop(start + dur + 0.02);
  }
  const Sound = {
    get on() {
      return soundOn;
    },
    toggle() {
      soundOn = !soundOn;
      localStorage.setItem("tsuzukeru.sound", soundOn ? "on" : "off");
      if (soundOn) Sound.coin();
      return soundOn;
    },
    success() {
      if (!soundOn) return;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.09, 0.25, "triangle", 0.2));
    },
    coin() {
      if (!soundOn) return;
      tone(987.77, 0, 0.08, "square", 0.15);
      tone(1318.51, 0.08, 0.18, "square", 0.15);
    },
    levelUp() {
      if (!soundOn) return;
      [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) =>
        tone(f, i * 0.08, 0.3, "sawtooth", 0.16)
      );
    },
    fail() {
      if (!soundOn) return;
      [392, 329.63, 261.63].forEach((f, i) => tone(f, i * 0.12, 0.3, "sine", 0.18));
    },
  };

  // ===== 紙吹雪 ==============================================================
  function confetti(opts) {
    opts = opts || {};
    const count = opts.count || 110;
    const colors = opts.colors || ["#6366f1", "#a855f7", "#f59e0b", "#22c55e", "#ef4444", "#fde047"];
    const canvas = document.createElement("canvas");
    canvas.style.cssText =
      "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999";
    document.body.appendChild(canvas);
    const ctx2 = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    function resize() {
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const origin = opts.origin || { x: innerWidth / 2, y: innerHeight * 0.3 };
    const parts = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 6 + Math.random() * 9;
      parts.push({
        x: origin.x,
        y: origin.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 6,
        size: 5 + Math.random() * 7,
        color: colors[(Math.random() * colors.length) | 0],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.4,
        life: 1,
      });
    }
    let raf;
    function frame() {
      ctx2.clearRect(0, 0, innerWidth, innerHeight);
      let alive = false;
      for (const p of parts) {
        p.vy += 0.28; // 重力
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= 0.009;
        if (p.life > 0 && p.y < innerHeight + 40) {
          alive = true;
          ctx2.save();
          ctx2.globalAlpha = Math.max(0, p.life);
          ctx2.translate(p.x, p.y);
          ctx2.rotate(p.rot);
          ctx2.fillStyle = p.color;
          ctx2.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
          ctx2.restore();
        }
      }
      if (alive) raf = requestAnimationFrame(frame);
      else {
        cancelAnimationFrame(raf);
        canvas.remove();
      }
    }
    frame();
  }

  // ===== トースト ============================================================
  function toast(msg, opts) {
    opts = opts || {};
    let host = document.getElementById("fun-toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "fun-toast-host";
      document.body.appendChild(host);
    }
    const el = document.createElement("div");
    el.className = "fun-toast";
    el.innerHTML = `<span class="fun-toast__icon">${opts.icon || "✨"}</span><span>${msg}</span>`;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 350);
    }, opts.duration || 2600);
  }

  // ===== シェアカード (Canvas → 画像 → 共有/保存) ============================
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCard({ emoji, title, lines, accent }) {
    const S = 1080;
    const canvas = document.createElement("canvas");
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext("2d");

    // 背景グラデーション
    const grad = ctx.createLinearGradient(0, 0, S, S);
    grad.addColorStop(0, "#6366f1");
    grad.addColorStop(1, accent || "#a855f7");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);

    // 半透明パネル
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    roundRect(ctx, 90, 150, S - 180, S - 360, 48);
    ctx.fill();

    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";

    ctx.font = "200px sans-serif";
    ctx.fillText(emoji || "🔥", S / 2, 430);

    ctx.font = "bold 86px sans-serif";
    ctx.fillText(title || "", S / 2, 560);

    ctx.font = "44px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    (lines || []).forEach((line, i) => ctx.fillText(line, S / 2, 660 + i * 70));

    // フッター
    ctx.font = "bold 40px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText("☀️ つづける", S / 2, S - 120);
    ctx.font = "30px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText("習慣化＆朝チャレンジ", S / 2, S - 70);

    return canvas;
  }

  function share({ emoji, title, lines, text, accent }) {
    const canvas = drawCard({ emoji, title, lines, accent });
    openShareModal(canvas, { title: title || "つづける", text: text || title || "" });
  }

  function openShareModal(canvas, meta) {
    const overlay = document.createElement("div");
    overlay.className = "fun-modal";
    overlay.innerHTML = `
      <div class="fun-modal__box">
        <div class="fun-modal__preview"></div>
        <div class="fun-modal__actions">
          <button class="btn btn--primary" data-act="share">シェアする</button>
          <button class="btn fun-modal__ghost" data-act="save">画像を保存</button>
          <button class="btn fun-modal__ghost" data-act="close">閉じる</button>
        </div>
      </div>`;
    const preview = overlay.querySelector(".fun-modal__preview");
    const img = new Image();
    img.src = canvas.toDataURL("image/png");
    img.alt = "シェア画像";
    preview.appendChild(img);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));

    const close = () => {
      overlay.classList.remove("show");
      setTimeout(() => overlay.remove(), 250);
    };

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      if (act === "close") close();
      if (act === "save") {
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = "tsuzukeru.png";
        a.click();
      }
      if (act === "share") {
        canvas.toBlob(async (blob) => {
          const file = new File([blob], "tsuzukeru.png", { type: "image/png" });
          try {
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({ files: [file], title: meta.title, text: meta.text });
            } else if (navigator.share) {
              await navigator.share({ title: meta.title, text: meta.text });
            } else {
              const a = document.createElement("a");
              a.href = canvas.toDataURL("image/png");
              a.download = "tsuzukeru.png";
              a.click();
              toast("共有に未対応の環境のため画像を保存しました", { icon: "💾" });
            }
          } catch (_) {
            /* ユーザーがキャンセル */
          }
        }, "image/png");
      }
    });
  }

  // ===== PWA インストール ====================================================
  let deferredPrompt = null;
  const installBtns = new Set();

  function refreshInstallButtons() {
    const installed =
      window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    for (const btn of installBtns) {
      btn.hidden = installed || !deferredPrompt;
    }
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    refreshInstallButtons();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    refreshInstallButtons();
    toast("ホーム画面に追加しました！", { icon: "📲" });
  });

  function registerInstallButton(btn) {
    if (!btn) return;
    installBtns.add(btn);
    btn.addEventListener("click", async () => {
      if (!deferredPrompt) {
        toast("ブラウザのメニューから「ホーム画面に追加」できます", { icon: "📲" });
        return;
      }
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      refreshInstallButtons();
    });
    refreshInstallButtons();
  }

  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    // file:// では動かないので http(s) のときだけ
    if (location.protocol === "file:") return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  // ===== 触覚フィードバック ==================================================
  function vibrate(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (_) {}
  }

  // ===== 公開 ================================================================
  window.Fun = {
    totalXp,
    level,
    Sound,
    confetti,
    toast,
    share,
    vibrate,
    registerInstallButton,
    registerSW,
  };
})();

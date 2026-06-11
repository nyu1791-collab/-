/* つづける — データのエクスポート / インポート (window.Backup)
 * localStorage の "tsuzukeru.*" を JSON で書き出し・復元する。
 * 端末間の移行やバックアップに使う。外部通信なし。
 */
(function () {
  "use strict";

  const PREFIX = "tsuzukeru.";
  const FORMAT = "tsuzukeru-backup";
  const VERSION = 1;

  /** 対象キーを集める */
  function collectKeys() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    return keys.sort();
  }

  /** バックアップJSON文字列を作る */
  function serialize() {
    const data = {};
    for (const k of collectKeys()) {
      const raw = localStorage.getItem(k);
      // 値は基本JSONなのでパースして格納（不可なら生文字列）
      try {
        data[k] = JSON.parse(raw);
      } catch (_) {
        data[k] = raw;
      }
    }
    return JSON.stringify(
      { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), data },
      null,
      2
    );
  }

  /** 中身の要約（UI表示用） */
  function summary(parsed) {
    const d = (parsed && parsed.data) || {};
    let habits = 0;
    let mornings = 0;
    try {
      const h = d[PREFIX + "habits.v1"];
      if (Array.isArray(h)) habits = h.length;
    } catch (_) {}
    try {
      const m = d[PREFIX + "morning.v2"];
      if (m && m.days) mornings = Object.keys(m.days).length;
    } catch (_) {}
    return { keys: Object.keys(d).length, habits, mornings, exportedAt: parsed?.exportedAt };
  }

  /** 文字列をパースして検証する。問題があれば例外を投げる */
  function parseAndValidate(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      throw new Error("JSONとして読み取れませんでした。");
    }
    if (!parsed || parsed.format !== FORMAT || typeof parsed.data !== "object" || parsed.data === null) {
      throw new Error("つづけるのバックアップファイルではないようです。");
    }
    // 安全のため対象プレフィックスのキーだけ受け入れる
    const clean = {};
    for (const [k, v] of Object.entries(parsed.data)) {
      if (typeof k === "string" && k.startsWith(PREFIX)) clean[k] = v;
    }
    parsed.data = clean;
    return parsed;
  }

  /**
   * 復元する。
   * @param {string} text  バックアップJSON
   * @param {{ mode?: "replace"|"merge" }} [opts]  replace=既存の tsuzukeru.* を消してから復元
   * @returns {ReturnType<typeof summary>}
   */
  function restore(text, opts) {
    const parsed = parseAndValidate(text);
    const mode = (opts && opts.mode) || "replace";
    if (mode === "replace") {
      for (const k of collectKeys()) localStorage.removeItem(k);
    }
    for (const [k, v] of Object.entries(parsed.data)) {
      localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
    }
    return summary(parsed);
  }

  // ---- DOM 連携（ブラウザ専用） ---------------------------------------------

  function fileName() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `tsuzukeru-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
  }

  /** ファイルとしてダウンロードさせる */
  function download() {
    const blob = new Blob([serialize()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** <input type=file> の File を読み込んで復元する（Promise） */
  function importFile(file, opts) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(restore(String(reader.result), opts));
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(new Error("ファイルの読み込みに失敗しました。"));
      reader.readAsText(file);
    });
  }

  window.Backup = {
    PREFIX,
    serialize,
    summary,
    parseAndValidate,
    restore,
    download,
    importFile,
    collectKeys,
  };
})();

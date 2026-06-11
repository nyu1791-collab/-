/* つづける — Service Worker
 * オフライン動作のための簡易キャッシュ。バージョンを上げると更新が反映される。
 */
const CACHE = "tsuzukeru-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./morning.html",
  "./styles.css",
  "./app.js",
  "./morning.js",
  "./fun.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  // HTMLはネットワーク優先（更新を拾う）、それ以外はキャッシュ優先
  const isHTML = request.mode === "navigate" || request.headers.get("accept")?.includes("text/html");
  if (isHTML) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match("./index.html")))
    );
  } else {
    e.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
            return res;
          })
      )
    );
  }
});

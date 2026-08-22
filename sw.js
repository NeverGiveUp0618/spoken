const CACHE = "spoken-v5";
// 音频文件不进预缓存：近千个 mp3 十几兆，首屏全拉会卡；改成播放过的自动进缓存
const CORE = ["./", "./index.html", "./data.js?v=5", "./app.js?v=5", "./manifest.json", "./audio/manifest.js?v=2"];
self.addEventListener("install", e => e.waitUntil(
  caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting())
));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const cached = e.request.mode === "navigate"
      ? await c.match("./index.html")
      : (await c.match(e.request)) || (await c.match(e.request, { ignoreSearch: true }));
    const fresh = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => cached);
    return cached || fresh;
  }));
});

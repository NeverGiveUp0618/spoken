const CACHE = "spoken-v12-netfirst";
// 音频文件不进预缓存：近千个 mp3 十几兆，首屏全拉会卡；改成播放过的自动进缓存
const CORE = ["./", "./index.html", "./data.js?v=11", "./app.js?v=11", "./manifest.json", "./audio/manifest.js?v=6"];

self.addEventListener("install", e => e.waitUntil(
  caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting())
));

self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

/* ⚠️ 2026-09-08：原来是 stale-while-revalidate（`return cached || fresh`）——
   先把缓存端上去、后台再更新，于是**打开的当次永远是上一版**，刷第二次才新。
   自己开发时天天刷所以没感觉，把链接发给别人，对方看到的就是旧内容。
   改成「网络优先，但不干等」：先走网络保证新鲜，超时才拿缓存顶上（秒开），网络回来照样写缓存。

   ⭐ 唯独 mp3 仍走缓存优先：1212 条预合成音频内容基本不变，网络优先会拖慢跟读、白耗流量。
      改了发音要重跑 gen_audio.py，届时 bump 一次 CACHE 名即可换掉。 */
const TIMEOUT = 1500;
const isAudio = url => /\.mp3$/i.test(new URL(url).pathname);

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;

  if (isAudio(e.request.url)) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      return hit || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; });
    }));
    return;
  }

  e.respondWith(netFirstButDontHang(e.request));
});

function netFirstButDontHang(req) {
  return new Promise(resolve => {
    let settled = false;
    const give = res => { if (!settled && res) { settled = true; resolve(res); } };

    const timer = setTimeout(() => {
      if (settled) return;
      caches.match(req, { ignoreSearch: true }).then(give);   // 没缓存就继续等网络
    }, TIMEOUT);

    fetch(req).then(res => {
      clearTimeout(timer);
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      give(res);
    }).catch(async () => {
      clearTimeout(timer);
      // 离线：回退缓存；忽略 ?v= 差异，否则换了版本号就全部落空
      const hit = await caches.match(req, { ignoreSearch: true })
        || (req.mode === "navigate" ? await caches.match("./index.html") : null);
      give(hit || new Response("", { status: 504, statusText: "offline" }));
    });
  });
}

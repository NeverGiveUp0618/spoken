/* Service Worker 行为测试 —— 在 Node 里真跑本站 sw.js，验证「网络优先」确实生效。
 *
 * ⚠️ 为什么要有这个文件（2026-09-08）：
 *   用户把站点链接发给别人，对方打开看到的是**好几个版本以前**的内容，自己电脑上却是最新的。
 *   查下来根因是 sw 的取数策略：缓存优先 / stale-while-revalidate 会让别人长期停在旧版。
 *   这类问题**光看代码或 grep 关键词看不出来**，必须真跑一遍看它到底端出哪一份内容。
 *
 * 跑法：node tests_sw.js   （无依赖）
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const SW_FILE = path.join(__dirname, '../sw.js');
const ORIGIN = 'https://nevergiveup0618.github.io';
const HOME = ORIGIN + '/app/index.html';

const swSrc = fs.readFileSync(SW_FILE, 'utf8');
const CACHENAME = (swSrc.match(/const\s+CACHE(?:_NAME)?\s*=\s*["']([^"']+)["']/) || [])[1];
const HAS_AUDIO = /isAudio/.test(swSrc);

class Res {
  constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.ok = this.status < 400; }
  clone() { return new Res(this.body, { status: this.status }); }
}

function makeEnv({ seed = {}, net }) {
  const stores = {};
  const open = n => (stores[n] = stores[n] || new Map());
  const matchIn = (s, req, o) => {
    const url = typeof req === 'string' ? req : req.url;
    if (s.has(url)) return s.get(url);
    if (o && o.ignoreSearch) for (const [k, v] of s) if (k.split('?')[0] === url.split('?')[0]) return v;
    return undefined;
  };
  if (CACHENAME) { const s = open(CACHENAME); for (const [k, v] of Object.entries(seed)) s.set(k, new Res(v)); }

  const caches = {
    open: async n => { const s = open(n); return {
      add: async u => { const r = await net({ url: String(u), method: 'GET' }); if (!r.ok) throw new Error('404'); s.set(String(u), r); },
      addAll: async us => { for (const u of us) { const r = await net({ url: String(u), method: 'GET' }); if (!r.ok) throw new Error('404'); s.set(String(u), r); } },
      put: async (q, r) => s.set(typeof q === 'string' ? q : q.url, r),
      match: async (q, o) => matchIn(s, q, o) }; },
    match: async (q, o) => { for (const n of Object.keys(stores)) { const h = matchIn(stores[n], q, o); if (h) return h; } },
    keys: async () => Object.keys(stores),
    delete: async n => { delete stores[n]; return true; },
  };

  const handlers = {};
  const addEventListener = (t, fn) => { (handlers[t] = handlers[t] || []).push(fn); };
  const self = { addEventListener, skipWaiting() {}, clients: { claim() {} }, registration: {} };
  const sandbox = { self, addEventListener, caches, fetch: net, Response: Res, URL, console,
                    location: { origin: ORIGIN }, setTimeout, clearTimeout, Promise };
  vm.runInContext(swSrc, vm.createContext(sandbox));
  return { handlers, stores };
}

const fire = (h, req) => new Promise((resolve, reject) => {
  let got = false;
  const ev = { request: req, respondWith: p => { got = true; Promise.resolve(p).then(resolve, reject); } };
  for (const fn of (h.fetch || [])) fn(ev);
  if (!got) resolve({ body: '__PASSTHROUGH__' });
});

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };
const nav = url => ({ url, method: 'GET', mode: 'navigate' });

(async () => {
  console.log('sw: ' + path.basename(SW_FILE) + ' · 缓存名 ' + CACHENAME + '\n');
  ok(!!CACHENAME, 'sw.js 里读得到缓存版本名（改内容记得 bump 它）');

  // ① 最要命的一条：缓存里躺着旧版、网络能通 → 必须端出网络的新版
  {
    const { handlers } = makeEnv({ seed: { [HOME]: '旧版v1' }, net: async () => new Res('新版v2') });
    const r = await fire(handlers, nav(HOME));
    ok(r.body === '新版v2', '网络通 → 端出新版（⚠️ 缓存优先会让别人长期看到旧内容，别改回去）');
  }

  // ② 网络慢 → 先拿缓存秒开；但网络回来必须把新版写进缓存，否则还是会钉死
  {
    let release;
    const env = makeEnv({ seed: { [HOME]: '旧版v1' },
                          net: () => new Promise(res => { release = () => res(new Res('新版v2')); }) });
    const p = fire(env.handlers, nav(HOME));
    const r = await new Promise(done => setTimeout(async () => done(await p), 1700));
    ok(r.body === '旧版v1', '网络慢 → 先用缓存顶上，不让用户白等（微信里尤其明显）');
    if (release) release();
    await new Promise(res => setTimeout(res, 40));
    const stored = env.stores[CACHENAME] && env.stores[CACHENAME].get(HOME);
    ok(stored && stored.body === '新版v2', '网络回来 → 新版写进缓存，下次打开就是新的');
  }

  // ③ 断网 → 回退缓存（离线可用是 PWA 的意义，不能为了新鲜度丢掉）
  {
    const { handlers } = makeEnv({ seed: { [HOME]: '旧版v1' }, net: async () => { throw new Error('offline'); } });
    const r = await fire(handlers, nav(HOME));
    ok(r.body === '旧版v1', '断网 → 回退缓存，离线仍可用');
  }

  // ④ 缓存键带 ?v= 而请求不带（或反之）→ ignoreSearch 必须兜住，否则换版本号后离线全落空
  {
    const { handlers } = makeEnv({ seed: { [HOME + '?v=9']: '旧版v1' }, net: async () => { throw new Error('offline'); } });
    const r = await fire(handlers, nav(HOME));
    ok(r.body === '旧版v1', '断网 + 版本参数对不上 → ignoreSearch 仍命中');
  }

  // ⑤ 预缓存清单里有 404 → install 仍要成功，否则浏览器反复重试安装（无限刷新的一条路径）
  {
    const { handlers } = makeEnv({ net: async req => (/(preview|icon|png)/.test(req.url) ? new Res('', { status: 404 }) : new Res('ok')) });
    let done = false;
    const ev = { waitUntil: p => Promise.resolve(p).then(() => { done = true; }, () => { done = false; }) };
    for (const fn of (handlers.install || [])) fn(ev);
    await new Promise(res => setTimeout(res, 80));
    ok(done, '预缓存有 404 资源 → install 仍成功（addAll 必须逐个兜底）');
  }

  // ⑥ 有音频分支的站：mp3 走缓存优先，不该每次重新下载
  if (HAS_AUDIO) {
    const MP3 = ORIGIN + '/app/audio/hello.mp3';
    let hits = 0;
    const { handlers } = makeEnv({ seed: { [MP3]: '缓存音频' }, net: async () => { hits++; return new Res('网络音频'); } });
    const r = await fire(handlers, { url: MP3, method: 'GET', mode: 'no-cors' });
    ok(r.body === '缓存音频' && hits === 0, 'mp3 走缓存优先，不重复下载（跟读不卡、不耗流量）');
  }

  console.log('\n' + '-'.repeat(46));
  console.log(fail === 0 ? `✅ sw 行为全部通过（${pass} 项）` : `❌ 通过 ${pass}，失败 ${fail}`);
  process.exit(fail ? 1 : 0);
})();

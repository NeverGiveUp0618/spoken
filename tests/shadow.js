/* 跟读三档专项测试：node tests/shadow.js
 *
 * 为什么单独立一个文件：跟读是全站唯一依赖设备能力的功能，翻过两次车——
 *   ① 微信没有 SpeechRecognition，降级只给「自评」等于没练；
 *   ② 国产安卓浏览器有 webkitSpeechRecognition 但连不上识别服务，
 *      于是自动选了判分档，点完麦克风永远停在「在听……」，彻底卡死。
 * 所以这里逐档验证，并且**锁死「有识别也不许自动选判分档」**。
 */
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
let JSDOM;
try { JSDOM = require(path.join(ROOT, "..", "english-game", "node_modules", "jsdom")).JSDOM; }
catch (e) { console.log("跳过：本机没有 jsdom"); process.exit(0); }

let pass = 0, fail = 0;
const ok = (c, m) => c ? pass++ : (fail++, console.log("  ✗ " + m));
const sec = n => console.log("\n[" + n + "]");

/* opt: {sr, srSilent, srError, rec, recEmpty, noMic} */
function boot(opt) {
  opt = opt || {};
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"),
    { runScripts: "outside-only", url: "https://localhost/", pretendToBeVisual: true });
  const w = dom.window, errs = [], played = [];
  w.onerror = m => errs.push(String(m));
  w.speechSynthesis = { getVoices: () => [], cancel() {}, speak() {} };
  w.SpeechSynthesisUtterance = function () {};
  w.HTMLMediaElement.prototype.play = function () { played.push(this.src); return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.load = function () {};
  w.URL.createObjectURL = () => "blob:fake";
  w.URL.revokeObjectURL = () => {};
  // 可控定时器，测超时自救不用真等
  const timers = [];
  const realTO = w.setTimeout;
  w.setTimeout = function (fn, ms) { if (ms >= 300) { timers.push(fn); return timers.length; } return realTO(fn, ms); };
  w.clearTimeout = function () {};
  w.__flush = () => { for (let i = 0; i < 30 && timers.length; i++) { const f = timers.shift(); try { f(); } catch (e) {} } };

  if (opt.sr) {
    w.SpeechRecognition = function () { w.__rec = this; };
    w.SpeechRecognition.prototype.start = function () { this.__on = true; };
    w.SpeechRecognition.prototype.stop = function () { this.__on = false; };
  }
  if (opt.rec) {
    w.navigator.mediaDevices = {
      getUserMedia: opt.noMic ? async () => { throw new Error("denied"); }
                              : async () => ({ getTracks: () => [{ stop() {} }] })
    };
    w.MediaRecorder = function () { w.__mr = this; this.state = "inactive"; };
    w.MediaRecorder.prototype.start = function () { this.state = "recording"; };
    w.MediaRecorder.prototype.stop = function () {
      this.state = "inactive";
      if (this.ondataavailable) this.ondataavailable({ data: { size: opt.recEmpty ? 0 : 2048 } });
      if (this.onstop) this.onstop();
    };
    w.MediaRecorder.isTypeSupported = m => m === "audio/mp4";
  }
  w.eval(["audio/manifest.js", "data.js", "app.js"].map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n")
    + "\n;window.__t={tier:shadowTier,cfg:()=>CFG,step:step};");
  const d = w.document;
  const cl = el => { if (!el) throw new Error("元素不存在"); el.dispatchEvent(new w.Event("click", { bubbles: true })); };
  cl(d.querySelector('.tab[data-tab="drill"]'));
  cl(d.querySelector('#v-drill .mode[data-arg="shadow"]'));
  return { w, d, errs, played, cl, box: d.querySelector("#v-drill .wrap"),
           mst: () => (d.querySelector("#mst") || {}).textContent || "" };
}

const tick = () => new Promise(r => setImmediate(r));

(async function main() {

sec("选档：有识别也绝不自动选判分档（这次翻车的根因）");
{
  const e = boot({ sr: true });
  ok(e.w.__t.tier() !== "score", "有 SpeechRecognition 就自动选了判分档 —— 国内会卡死在「在听」");
  ok(e.w.__t.tier() === "rhythm", "没有录音能力时应落到节奏跟读，实为 " + e.w.__t.tier());
}
{
  const e = boot({ sr: true, rec: true });
  ok(e.w.__t.tier() === "record", "同时有识别和录音时应默认录音对比，实为 " + e.w.__t.tier());
  ok(e.mst().indexOf("点一下开始录") >= 0, "录音档提示不对：" + e.mst());
}
{
  const e = boot({ rec: true });
  ok(e.w.__t.tier() === "record", "只有录音能力时应选录音对比");
}
{
  const e = boot({});
  ok(e.w.__t.tier() === "rhythm", "什么都没有时应选节奏跟读");
  ok(e.mst().indexOf("先放原声") >= 0, "节奏档提示不对：" + e.mst());
}

sec("每一档都给得出切换入口（不能让用户卡死）");
// 注意：什么能力都没有时只剩节奏档，没有可切的目标，不给按钮才是对的
[["record", { rec: true }], ["record", { sr: true, rec: true }], ["rhythm", { rec: true }]].forEach(([want, opt]) => {
  const e = boot(opt);
  if (want === "rhythm") { e.cl(e.d.querySelector('#v-drill [data-shadow="rhythm"]')); }
  const sw = e.d.querySelectorAll("#v-drill [data-shadow]");
  ok(sw.length >= 1, want + " 档没有任何切换按钮");
  ok(![...sw].some(x => x.dataset.shadow === want), want + " 档不该出现切到自己的按钮");
});
{
  const e = boot({});
  ok(e.d.querySelectorAll("#v-drill [data-shadow]").length === 0,
     "无任何替代能力时不该给切换按钮（切过去也一样用不了）");
}
{
  const e = boot({ sr: true, rec: true });
  ok([...e.d.querySelectorAll("#v-drill [data-shadow]")].some(x => x.dataset.shadow === "score"),
     "有识别时应提供手动开自动判分的入口");
}
{
  const e = boot({ rec: true });
  ok(![...e.d.querySelectorAll("#v-drill [data-shadow]")].some(x => x.dataset.shadow === "score"),
     "没有识别却给了自动判分入口");
}

sec("手动切到判分档后，卡住能自己回来");
{
  const e = boot({ sr: true, rec: true });
  e.cl(e.d.querySelector('#v-drill [data-shadow="score"]'));
  ok(e.w.__t.cfg().shadow === "score", "切换没写进设置");
  ok(e.w.__t.tier() === "score", "切换后没走判分档");
  ok(e.mst().indexOf("自动判分") >= 0, "判分档提示不对：" + e.mst());
  e.cl(e.d.querySelector("#v-drill #mic"));
  ok(e.mst().indexOf("在听") >= 0, "点麦克风后没进入监听态");
  e.w.__flush();          // 识别服务没反应，超时兜底应触发
  ok(e.mst().indexOf("没反应") >= 0 || e.w.__t.cfg().shadow !== "score",
     "识别一直不回结果时没有自救，会永远卡在「在听」：" + e.mst());
  ok(e.w.__t.cfg().shadow === "record", "自救后应换回录音对比，实为 " + e.w.__t.cfg().shadow);
}
{
  const e = boot({ sr: true, rec: true });
  e.cl(e.d.querySelector('#v-drill [data-shadow="score"]'));
  e.cl(e.d.querySelector("#v-drill #mic"));
  e.w.__rec.onerror({ error: "network" });
  ok(e.w.__t.cfg().shadow === "record", "识别报 network 错时没换回录音对比");
  ok(e.mst().indexOf("连不上") >= 0, "没告诉用户为什么失败：" + e.mst());
}
{
  const e = boot({ sr: true, rec: true });
  e.cl(e.d.querySelector('#v-drill [data-shadow="score"]'));
  e.cl(e.d.querySelector("#v-drill #mic"));
  e.w.__rec.onerror({ error: "not-allowed" });
  ok(e.mst().indexOf("麦克风") >= 0, "拒绝麦克风时提示不对：" + e.mst());
  ok(e.w.__t.cfg().shadow === "score", "拒绝麦克风是权限问题，不该改档");
}

sec("判分档正常时要真的判分");
{
  const e = boot({ sr: true, rec: true });
  e.cl(e.d.querySelector('#v-drill [data-shadow="score"]'));
  const target = e.box.querySelector(".qz").textContent;
  e.cl(e.d.querySelector("#v-drill #mic"));
  e.w.__rec.onresult({ results: [Object.assign([{ transcript: target }], { length: 1 })] });
  ok((e.box.querySelector(".score") || {}).textContent === "100分 · 很地道", "全对没给满分");
  const half = target.split(/\s+/).slice(0, Math.ceil(target.split(/\s+/).length / 2)).join(" ");
  const e2 = boot({ sr: true, rec: true });
  e2.cl(e2.d.querySelector('#v-drill [data-shadow="score"]'));
  e2.cl(e2.d.querySelector("#v-drill #mic"));
  e2.w.__rec.onresult({ results: [Object.assign([{ transcript: half }], { length: 1 })] });
  ok(e2.box.querySelectorAll(".heard .m").length > 0, "念漏了却没标出漏词");
}

sec("录音档：录完能对比、能自评");
{
  const e = boot({ rec: true });
  e.cl(e.d.querySelector("#v-drill #mic"));
  await tick();
  ok(e.w.__mr && e.w.__mr.state === "recording", "没开始录音");
  ok(e.mst().indexOf("在录") >= 0, "录音中提示不对：" + e.mst());
  e.w.__mr.stop();
  ok(!!e.box.querySelector("#mine"), "缺「我的」回放按钮");
  ok(!!e.box.querySelector("#ab"), "缺「连着对比」按钮");
  ok(!!e.box.querySelector("#good") && !!e.box.querySelector("#bad"), "缺自评按钮");
  e.played.length = 0;
  e.cl(e.box.querySelector("#mine"));
  ok(e.played.length > 0, "点「我的」没播放录音");
  e.cl(e.box.querySelector("#good"));
  ok(e.box.querySelector(".qbar .nm").textContent.trim() === "2 / 10", "自评后没进下一题");
  ok(e.errs.length === 0, "运行期报错：" + e.errs.join(" | "));
}
{
  const e = boot({ rec: true, recEmpty: true });
  e.cl(e.d.querySelector("#v-drill #mic"));
  await tick();
  e.w.__mr.stop();
  ok(e.mst().indexOf("录不出") >= 0, "录出空数据时没提示：" + e.mst());
  ok(e.w.__t.cfg().shadow === "rhythm", "录不出声音时没换成节奏跟读");
}
{
  const e = boot({ rec: true, noMic: true });
  e.cl(e.d.querySelector("#v-drill #mic"));
  await tick(); await tick();
  ok(e.mst().indexOf("权限") >= 0, "拒绝麦克风时没提示：" + e.mst());
  ok(e.w.__t.cfg().shadow === "rhythm", "拒绝麦克风后没换成节奏跟读");
}

sec("节奏档：零权限也能走完");
{
  const e = boot({});
  e.played.length = 0;
  e.cl(e.d.querySelector("#v-drill #mic"));
  ok(e.played.some(u => /\/audio\/.+\.mp3$/.test(u)), "节奏跟读没播原声");
  e.w.__flush();
  ok(!!e.d.querySelector("#good"), "走完节奏后没给自评");
  e.cl(e.d.querySelector("#good"));
  ok(e.box.querySelector(".qbar .nm").textContent.trim() === "2 / 10", "自评后没进下一题");
  ok(e.errs.length === 0, "运行期报错：" + e.errs.join(" | "));
}

console.log("\n" + "-".repeat(46));
console.log(fail ? "✗ 通过 " + pass + "，失败 " + fail : "✓ 全部通过（" + pass + " 项）");
process.exit(fail ? 1 : 0);
})();

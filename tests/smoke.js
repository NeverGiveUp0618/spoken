/* 交互冒烟测试：node tests/smoke.js
 * 用 jsdom 真跑一遍 index.html + app.js，走完主要路径，捕捉运行时报错。
 */
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
let JSDOM;
try { JSDOM = require(path.join(ROOT, "..", "english-game", "node_modules", "jsdom")).JSDOM; }
catch (e) { try { JSDOM = require("jsdom").JSDOM; } catch (e2) {
  console.log("跳过：本机没有 jsdom（npm i jsdom 后可跑）"); process.exit(0); } }

const errs = [];
const dom = new JSDOM(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), {
  runScripts: "outside-only", url: "http://localhost/", pretendToBeVisual: true,
  virtualConsole: new (require(path.join(ROOT, "..", "english-game", "node_modules", "jsdom")).VirtualConsole)()
});
const w = dom.window;
w.speechSynthesis = { getVoices: () => [], cancel() {}, speak() {} };
// jsdom 没实现媒体播放，打个桩，顺便记录实际播了哪个文件
const played = [];
w.HTMLMediaElement.prototype.play = function () { if (this.src) played.push(this.src); return Promise.resolve(); };
w.HTMLMediaElement.prototype.pause = function () {};
w.HTMLMediaElement.prototype.load = function () {};
w.SpeechSynthesisUtterance = function () {};
w.onerror = (m) => errs.push(String(m));
w.confirm = () => true;
// 必须一次性 eval：分次 eval 时 const 不跨作用域（浏览器的 <script> 则共享全局词法环境）
try {
  // 末尾挂个钩子：这些都是 const 声明，不会自动出现在 window 上，
  // 而下一次 w.eval 又是新作用域，看不见它们，只能在同一次 eval 里导出。
  w.eval(["audio/manifest.js", "data.js", "app.js"].map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n") +
    "\n;window.__t = { audioMap: (typeof AUDIO_MAP === 'undefined' ? null : AUDIO_MAP), get aud(){ return AUD; }, say: say };");
} catch (e) { errs.push("执行报错：" + e.message); }
const d = w.document;
const q = s => d.querySelector(s);
const click = el => { if (!el) throw new Error("找不到要点的元素"); el.dispatchEvent(new w.Event("click", { bubbles: true })); };
let pass = 0, fail = 0;
const ok = (c, m) => c ? pass++ : (fail++, console.log("  ✗ " + m));
const step = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("  ✗ " + name + "：" + e.message); } };

function switchToScene() {
  click(d.querySelector('.tab[data-tab="home"]'));
  click(d.querySelector('.gcard[data-arg="travel"]'));
  click(d.querySelector('.srow[data-arg="taxi"]'));
}

console.log("[启动]");
ok(errs.length === 0, "加载报错：" + errs.join(" | "));
ok(q("#v-home .wrap").innerHTML.indexOf("今日五句") >= 0, "首页没渲染出今日五句");
ok(d.querySelectorAll(".gcard").length === 9, "首页分组卡数量不对：" + d.querySelectorAll(".gcard").length);
ok(d.querySelectorAll("#v-home .gcard .ib svg use").length === 9, "分组卡没用 SVG 图标");
ok(d.querySelectorAll(".tab").length === 5, "底栏不是 5 个 tab");

console.log("[场景路径]");
step("点开分组", () => { click(d.querySelector('.gcard[data-arg="travel"]')); });
ok(d.querySelectorAll(".srow").length === 8, "出行组场景数不对：" + d.querySelectorAll(".srow").length);
step("点开场景", () => { click(d.querySelector('.srow[data-arg="taxi"]')); });
ok(d.querySelectorAll("#v-home .pcard").length === 2, "场景页模板卡不是 2 张：" + d.querySelectorAll("#v-home .pcard").length);
ok(d.querySelectorAll("#v-home .pcard.fold").length === 0, "场景页只有 2 个模板，不该折叠");
ok(d.querySelectorAll(".lcard").length === 3, "场景里不是三张句子卡");

console.log("[模板点词填空]");
const pc = q("#v-home .pcard");
ok(pc.querySelector(".slot").className.indexOf("empty") >= 0, "槽位初始不是空的");
ok(pc.querySelector(".slot").textContent.length > 0, "槽位没有提示文字");
const fills = pc.querySelectorAll(".pfill");
ok(fills.length >= 4, "替换词太少");
step("点第二个替换词", () => click(fills[1]));
ok(pc.querySelector(".slot").classList.contains("filled"), "点词后槽位没变成已填");
ok(pc.querySelector(".slot").textContent === fills[1].firstChild.textContent,
   "填进空里的词不对：槽位=" + pc.querySelector(".slot").textContent);
ok(fills[1].classList.contains("on"), "选中的词没高亮");
step("换一个词", () => click(fills[2]));
ok(!fills[1].classList.contains("on") && fills[2].classList.contains("on"), "换词后旧的没取消高亮");
ok(pc.querySelector(".slot").textContent === fills[2].firstChild.textContent, "换词后槽位没更新");
ok(q(".len").textContent.indexOf("Could you take me") === 0, "第一句不是最高频那句");
step("展开用法", () => click(q(".togmore")));
ok(q(".lmore").className.indexOf("on") >= 0, "用法展开无效");
step("收藏模板", () => click(q("#v-home .pcard [data-fav]")));
step("收藏句子", () => click(q("#v-home .lcard [data-fav]")));
ok(Object.keys(JSON.parse(w.localStorage.getItem("spoken_fav_v1"))).length === 2, "收藏没落盘");
step("返回", () => click(q("#back")));
ok(d.querySelectorAll(".srow").length === 8, "返回后没回到场景列表");

console.log("[微对话]");
step("回到场景页", switchToScene);
ok(d.querySelectorAll("#v-home .dlg .bub").length >= 6, "场景页没渲染出对话气泡");
ok(d.querySelectorAll("#v-home .bub.y").length >= 3 && d.querySelectorAll("#v-home .bub.t").length >= 3,
   "对话双方气泡不齐");
played.length = 0;
step("点气泡朗读", () => click(q("#v-home .bub")));
ok(played.some(u => /\/audio\/.+\.mp3$/.test(u)), "对话气泡没走 mp3：" + (played[0] || "什么都没播"));
step("连播整段", () => click(q("#v-home [data-dlgplay]")));
ok(d.querySelectorAll("#v-home .bub.playing").length === 1, "连播没高亮当前句");

console.log("[对话演练]");
step("进演练", () => click(d.querySelector('#v-home [data-go="dlgrun"]')));
ok(q("#v-home .qbox").textContent.indexOf("对方在说") >= 0 || q("#v-home .qbox").textContent.indexOf("轮到你说") >= 0,
   "演练没进入第一轮");
let guard = 0, sawFlip = false;
while (guard++ < 12) {
  const box = q("#v-home .wrap");
  if (box.textContent.indexOf("整段走完了") >= 0) break;
  if (box.querySelector("#flip")) {
    sawFlip = true;
    ok(!/[a-zA-Z]{5,}/.test(box.querySelector(".qbox").textContent), "轮到你说时不该露出英文答案");
    click(box.querySelector("#flip"));
    ok(!!box.querySelector("#nx2"), "翻开后没有下一句按钮");
    click(box.querySelector("#nx2"));
  } else if (box.querySelector("#go")) {
    click(box.querySelector("#go"));
  } else break;
}
ok(sawFlip, "整段演练里没轮到你说过");
ok(q("#v-home .wrap").textContent.indexOf("整段走完了") >= 0, "演练走不到结尾");
ok(d.querySelectorAll("#v-home #rp .bub").length >= 6, "走完后没留下完整对话记录");
step("再来一遍", () => click(d.querySelector("#v-home #again")));
ok(d.querySelectorAll("#v-home #rp .bub").length === 0, "重来没清空");
step("返回场景", () => click(q("#back")));

console.log("[句型页 · 折叠]");
step("切到句型", () => click(d.querySelector('.tab[data-tab="pat"]')));
ok(d.querySelectorAll("#v-pat .pcard").length === 20, "核心句型卡数量不对：" + d.querySelectorAll("#v-pat .pcard").length);
ok(q("#v-pat .wrap").innerHTML.indexOf("先记模板") >= 0, "句型页没渲染说明");
ok(d.querySelectorAll("#v-pat .pcard.fold").length === 20, "核心句型没有全部设成可折叠");
ok(d.querySelectorAll("#v-pat .pcard.open").length === 0, "核心句型默认不该是展开的");
const c0 = q("#v-pat .pcard");
ok(c0.querySelector(".ppat") && c0.querySelector(".pzh"), "折叠态看不到模板句和中文");
ok(c0.querySelector(".pbody .pfills"), "替换词没放进可折叠区");
ok(/\d+ 个换法/.test(c0.querySelector(".phead").textContent), "折叠态没提示有几个换法");
step("展开第一张", () => click(c0.querySelector(".foldhead")));
ok(c0.classList.contains("open"), "点了没展开");
step("再点一次收起", () => click(c0.querySelector(".foldhead")));
ok(!c0.classList.contains("open"), "再点没收起");
step("点收藏不该触发折叠", () => click(c0.querySelector("[data-fav]")));
ok(!c0.classList.contains("open"), "点收藏按钮误触发了展开");
step("取消收藏", () => click(c0.querySelector("[data-fav]")));
const fa = q("#v-pat .secbtn");
ok(!!fa && fa.textContent === "全部展开", "缺全部展开按钮");
step("全部展开", () => click(fa));
ok(d.querySelectorAll("#v-pat .pcard.open").length === 20, "全部展开没生效：" + d.querySelectorAll("#v-pat .pcard.open").length);
ok(fa.textContent === "全部收起", "按钮文字没变成全部收起");
step("全部收起", () => click(fa));
ok(d.querySelectorAll("#v-pat .pcard.open").length === 0, "全部收起没生效");
step("展开后仍能点词填空", () => { click(c0.querySelector(".foldhead")); click(c0.querySelector(".pfill")); });
ok(c0.querySelector(".slot").classList.contains("filled"), "折叠卡展开后填空失效");
step("进分组模板", () => click(d.querySelector('#v-pat .mrow[data-arg="travel"]')));
ok(d.querySelectorAll("#v-pat .pcard").length === 16, "出行组模板数不对：" + d.querySelectorAll("#v-pat .pcard").length);
ok(d.querySelectorAll("#v-pat .pcard.fold").length === 16, "分组模板页没折叠");
step("返回", () => click(q("#back")));

console.log("[单词本]");
step("切到单词本", () => click(d.querySelector('.tab[data-tab="terms"]')));
ok(q("#v-terms .wrap").innerHTML.indexOf("用英语讲你这一行") >= 0, "单词本首页没渲染");
step("进分类", () => click(d.querySelector('#v-terms .gcard[data-arg="fengshui"]')));
ok(d.querySelectorAll("#v-terms .tcard").length === 11, "风水词条数不对：" + d.querySelectorAll("#v-terms .tcard").length);
ok(q("#v-terms .ten").textContent.indexOf("feng shui") === 0, "词条渲染异常");
ok(d.querySelectorAll("#v-terms .tcard.fold").length === 11, "单词本词条没折叠");
ok(d.querySelectorAll("#v-terms .tcard.open").length === 0, "单词本默认不该展开");
const t0 = q("#v-terms .tcard");
step("展开词条", () => click(t0.querySelector(".foldhead")));
ok(t0.classList.contains("open"), "词条点了没展开");
step("单词本全部展开", () => click(q("#v-terms .secbtn")));
ok(d.querySelectorAll("#v-terms .tcard.open").length === 11, "单词本全部展开没生效");

console.log("[练习：秒答]");
step("切到练习", () => click(d.querySelector('.tab[data-tab="drill"]')));
ok(!!d.querySelector('#v-drill [data-go="dlgpick"]'), "练习页缺对话演练入口");
ok(d.querySelectorAll("#v-drill .mode").length === 9, "练习模式数不对：" + d.querySelectorAll("#v-drill .mode").length);
step("开始秒答", () => click(d.querySelector('#v-drill .mode[data-arg="sayit"]')));
ok(!!q("#v-drill #flip"), "秒答没有翻答案按钮");
ok(q("#v-drill .qz").textContent.length > 0, "秒答没显示中文");
ok(!/[a-zA-Z]{4,}/.test(q("#v-drill .qbox").textContent.replace(/[A-Z]{2,}/g, "")), "秒答不该先露出英文答案");
step("翻答案", () => click(q("#v-drill #flip")));
ok(q("#v-drill .fb").className.indexOf("on") >= 0, "翻答案后没显示");
ok(/[a-zA-Z]{4,}/.test(q("#v-drill .fb .en").textContent), "翻开后没给英文");
ok(!!d.querySelector("#got") && !!d.querySelector("#miss"), "缺自评按钮");
step("自评说出来了", () => click(d.querySelector("#got")));
ok(q("#v-drill .qbar .nm").textContent.trim() === "2 / 10", "秒答没进下一题");

console.log("[练习：听懂对方]");
step("回练习首页", () => click(d.querySelector('.tab[data-tab="drill"]')));
played.length = 0;
step("开始听力", () => click(d.querySelector('#v-drill .mode[data-arg="listen"]')));
ok(d.querySelectorAll("#v-drill .opt").length === 4, "听力题选项不是 4 个");
ok(!/[a-zA-Z]{4,}/.test(q("#v-drill .opts").textContent), "听力题选项不该是英文（要选中文意思）");
ok(!!q("#v-drill #rep"), "听力题没有重听按钮");
ok(!/[a-zA-Z]{4,}/.test(q("#v-drill .qbox").textContent), "听力题不该把原文露出来");
step("重听", () => click(q("#v-drill #rep")));
ok(played.some(u => /\/audio\/.+\.mp3$/.test(u)), "听力题没播 mp3：" + (played[0] || "什么都没播"));
step("答听力题", () => click(d.querySelector("#v-drill .opt")));
ok(q("#v-drill .fb").className.indexOf("on") >= 0, "听力题没反馈");
ok(q("#v-drill .fb").textContent.indexOf("这是在你说完这句之后") >= 0, "反馈没给出上下文");
step("下一题", () => click(d.querySelector("#nx")));
ok(q("#v-drill .qbar .nm").textContent.trim() === "2 / 10", "听力题没进下一题");

console.log("[练习：模板填空]");
step("回练习首页", () => click(d.querySelector('.tab[data-tab="drill"]')));
step("切到练习", () => click(d.querySelector('.tab[data-tab="drill"]')));
step("开始模板填空", () => click(d.querySelector('#v-drill .mode[data-arg="fill"]')));
ok(!!q("#v-drill #fslot"), "填空题没有空槽");
ok(d.querySelectorAll("#v-drill .opt").length === 4, "填空题选项不是 4 个");
ok(q("#v-drill .qbox .ppat").textContent.indexOf("____") >= 0, "题干没显示空格");
ok(q("#v-drill .qbox").innerHTML.indexOf("要表达") >= 0, "没给出要表达的中文");
step("答填空题", () => click(d.querySelector("#v-drill .opt")));
ok(q("#v-drill #fslot").classList.contains("filled"), "答完空槽没填上");
ok(q("#v-drill .fb").className.indexOf("on") >= 0, "填空题没反馈");
ok(q("#v-drill .fb .en").textContent.indexOf("{}") < 0, "反馈里还留着 {} 占位符");
step("下一题", () => click(d.querySelector("#nx")));
ok(q("#v-drill .qbar .nm").textContent.trim() === "2 / 10", "填空题没进下一题");

console.log("[练习：中译英]");
step("回练习首页", () => click(d.querySelector('.tab[data-tab="drill"]')));
step("开始中译英", () => click(d.querySelector('#v-drill .mode[data-arg="quiz"]')));
ok(d.querySelectorAll("#v-drill .opt").length === 4, "选项不是 4 个");
ok(q("#v-drill .qbar .nm").textContent.trim() === "1 / 10", "题号不对：" + q("#v-drill .qbar .nm").textContent);
step("答题", () => click(d.querySelector("#v-drill .opt")));
ok(q("#v-drill .fb").className.indexOf("on") >= 0, "答题后没有反馈");
ok(!!d.querySelector("#nx"), "没有下一题按钮");
step("下一题", () => click(d.querySelector("#nx")));
ok(q("#v-drill .qbar .nm").textContent.trim() === "2 / 10", "没进到第二题");
ok(Object.keys(JSON.parse(w.localStorage.getItem("spoken_srs_v1"))).length >= 1, "SRS 没记录");

console.log("[练习：连词成句]");
step("回练习首页", () => click(d.querySelector('.tab[data-tab="drill"]')));
step("开始连词成句", () => click(d.querySelector('#v-drill .mode[data-arg="build"]')));
const chips = d.querySelectorAll("#v-drill .chip[data-p]");
ok(chips.length > 1, "没有打乱的词块");
step("点完所有词块", () => chips.forEach(c => click(c)));
ok(d.querySelectorAll("#ans .chip").length === chips.length, "词块没进答题区");
step("检查答案", () => click(d.querySelector("#chk")));
ok(q("#v-drill .fb").className.indexOf("on") >= 0, "连词成句没判分");
ok(q("#v-drill .fb .en").textContent.length > 3, "没给出正确语序");

console.log("[跟读降级]");
step("回练习首页", () => click(d.querySelector('.tab[data-tab="drill"]')));
step("开始跟读", () => click(d.querySelector('#v-drill .mode[data-arg="shadow"]')));
ok(!!d.querySelector("#mic"), "没有麦克风按钮");
ok(q("#mst").innerHTML.indexOf("不支持语音识别") >= 0, "无识别时没降级成自评");
step("自评念顺了", () => click(d.querySelector("#good")));
ok(q("#v-drill .qbar .nm").textContent.trim() === "2 / 10", "自评后没进下一题");

console.log("[我的]");
step("切到我的", () => click(d.querySelector('.tab[data-tab="me"]')));
ok(q("#v-me .wrap").innerHTML.indexOf("最近七天") >= 0, "我的页没渲染");
ok(d.querySelectorAll("#v-me .mrow").length >= 5, "我的页条目太少");
ok(d.querySelectorAll("#v-me .mrow .ib svg use").length >= 5, "我的页没用 SVG 图标");
step("看收藏", () => click(d.querySelector('#v-me [data-go="favs"]')));
ok(d.querySelectorAll("#v-me .pcard").length === 1, "收藏页没显示收藏的模板");
ok(d.querySelectorAll("#v-me .lcard").length === 1, "收藏页没显示收藏的句子");
step("回我的", () => click(q("#back")));
step("切题量", () => click(d.querySelector("#v-me #qn")));
ok(JSON.parse(w.localStorage.getItem("spoken_cfg_v1")).qnum === 20, "题量没切换");
step("清空记录", () => click(d.querySelector("#v-me #clr")));
ok(Object.keys(JSON.parse(w.localStorage.getItem("spoken_srs_v1"))).length === 0, "清空无效");

console.log("[搜索]");
step("回场景页", () => click(d.querySelector('.tab[data-tab="home"]')));
step("打开搜索", () => click(q("#act")));
const inp = q("#q");
step("搜中文", () => { inp.value = "打车"; inp.dispatchEvent(new w.Event("input", { bubbles: true })); });
ok(d.querySelectorAll("#res .lcard").length > 0, "中文搜不到结果");
step("搜专业词", () => { inp.value = "hexagram"; inp.dispatchEvent(new w.Event("input", { bubbles: true })); });
ok(d.querySelectorAll("#res .tcard").length > 0, "专业词搜不到结果");
step("搜模板", () => { inp.value = "Could I have"; inp.dispatchEvent(new w.Event("input", { bubbles: true })); });
ok(d.querySelectorAll("#res .pcard").length > 0, "搜不到句型模板");

console.log("[发音通道]");
// data.js/app.js/manifest.js 是一次 eval 拼进去的，const 不挂在 window 上，只能用 eval 读
const nAudio = w.__t.audioMap ? Object.keys(w.__t.audioMap).length : 0;
ok(nAudio > 500, "manifest 没加载或条数不足：" + nAudio);
played.length = 0;
step("点例句喇叭", () => { switchToScene(); click(d.querySelector("#v-home .lcard [data-say]")); });
ok(played.some(u => /\/audio\/.+\.mp3$/.test(u)), "点喇叭没走 mp3 通道，播的是：" + (played[0] || "什么都没播"));
played.length = 0;
step("点模板替换词", () => click(d.querySelector("#v-home .pcard .pfill")));
ok(played.some(u => /\/audio\/.+\.mp3$/.test(u)), "模板组合句没走 mp3：" + (played[0] || "什么都没播"));
played.length = 0;
step("慢速播放", () => click(d.querySelector("#v-home .lcard [data-slow]")));
ok(played.length > 0, "慢速没播出来");
const pr = w.__t.aud ? w.__t.aud.playbackRate : null;
ok(pr !== null && pr < 1, "慢速没把 playbackRate 降下来：" + pr);
w.__t.say("Could you take me to this address, please?");
const normal = w.__t.aud.playbackRate;
ok(normal === 1, "正常速度不该改 playbackRate：" + normal);

console.log("[全站无 emoji]");
const EM = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u2605\u2606]/u;
["v-home", "v-pat", "v-terms", "v-drill", "v-me"].forEach(v => {
  const txt = d.querySelector("#" + v).textContent;
  const hit = txt.match(EM);
  ok(!hit || txt.indexOf("\u26a0") >= 0, v + " 渲染出的界面里有 emoji：" + (hit && hit[0]));
});

console.log("\n" + "-".repeat(46));
ok(errs.length === 0, "运行期报错：" + errs.join(" | "));
console.log(fail ? "✗ 通过 " + pass + "，失败 " + fail : "✓ 全部通过（" + pass + " 项）");
process.exit(fail ? 1 : 0);

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
  runScripts: "outside-only", url: "http://localhost/", pretendToBeVisual: true
});
const w = dom.window;
w.speechSynthesis = { getVoices: () => [], cancel() {}, speak() {} };
w.SpeechSynthesisUtterance = function () {};
w.onerror = (m) => errs.push(String(m));
w.confirm = () => true;
// 必须一次性 eval：分次 eval 时 const 不跨作用域（浏览器的 <script> 则共享全局词法环境）
try {
  w.eval(["data.js", "app.js"].map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n"));
} catch (e) { errs.push("执行报错：" + e.message); }
const d = w.document;
const q = s => d.querySelector(s);
const click = el => { if (!el) throw new Error("找不到要点的元素"); el.dispatchEvent(new w.Event("click", { bubbles: true })); };
let pass = 0, fail = 0;
const ok = (c, m) => c ? pass++ : (fail++, console.log("  ✗ " + m));
const step = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("  ✗ " + name + "：" + e.message); } };

console.log("[启动]");
ok(errs.length === 0, "加载报错：" + errs.join(" | "));
ok(q("#v-home .wrap").innerHTML.indexOf("今日五句") > 0, "首页没渲染出今日五句");
ok(d.querySelectorAll(".gcard").length === 10, "首页分组卡数量不对：" + d.querySelectorAll(".gcard").length);

console.log("[场景路径]");
step("点开分组", () => { click(d.querySelector('.gcard[data-arg="travel"]')); });
ok(d.querySelectorAll(".srow").length === 8, "出行组场景数不对：" + d.querySelectorAll(".srow").length);
step("点开场景", () => { click(d.querySelector('.srow[data-arg="taxi"]')); });
ok(d.querySelectorAll(".lcard").length === 3, "场景里不是三张句子卡");
ok(q(".len").textContent.indexOf("Could you take me") === 0, "第一句不是最高频那句");
step("展开用法", () => click(q(".togmore")));
ok(q(".lmore").className.indexOf("on") > 0, "用法展开无效");
step("收藏", () => click(q("[data-fav]")));
ok(Object.keys(JSON.parse(w.localStorage.getItem("spoken_fav_v1"))).length === 1, "收藏没落盘");
step("返回", () => click(q("#back")));
ok(d.querySelectorAll(".srow").length === 8, "返回后没回到场景列表");

console.log("[单词本]");
step("切到单词本", () => click(d.querySelector('.tab[data-tab="terms"]')));
ok(q("#v-terms .wrap").innerHTML.indexOf("用英语讲你这一行") > 0, "单词本首页没渲染");
step("进分类", () => click(d.querySelector('#v-terms .gcard[data-arg="fengshui"]')));
ok(d.querySelectorAll("#v-terms .tcard").length === 11, "风水词条数不对：" + d.querySelectorAll("#v-terms .tcard").length);
ok(q("#v-terms .ten").textContent.indexOf("feng shui") === 0, "词条渲染异常");

console.log("[练习：中译英]");
step("切到练习", () => click(d.querySelector('.tab[data-tab="drill"]')));
ok(d.querySelectorAll("#v-drill .mode").length === 5, "练习模式数不对");
step("开始中译英", () => click(d.querySelector('#v-drill .mode[data-arg="quiz"]')));
ok(d.querySelectorAll("#v-drill .opt").length === 4, "选项不是 4 个");
ok(q("#v-drill .qbar .nm").textContent.trim() === "1 / 10", "题号不对：" + q("#v-drill .qbar .nm").textContent);
step("答题", () => click(d.querySelector("#v-drill .opt")));
ok(q("#v-drill .fb").className.indexOf("on") > 0, "答题后没有反馈");
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
ok(q("#v-drill .fb").className.indexOf("on") > 0, "连词成句没判分");
ok(q("#v-drill .fb .en").textContent.length > 3, "没给出正确语序");

console.log("[跟读降级]");
step("回练习首页", () => click(d.querySelector('.tab[data-tab="drill"]')));
step("开始跟读", () => click(d.querySelector('#v-drill .mode[data-arg="shadow"]')));
ok(!!d.querySelector("#mic"), "没有麦克风按钮");
ok(q("#mst").innerHTML.indexOf("不支持语音识别") > 0, "无识别时没降级成自评");
step("自评念顺了", () => click(d.querySelector("#good")));
ok(q("#v-drill .qbar .nm").textContent.trim() === "2 / 10", "自评后没进下一题");

console.log("[我的]");
step("切到我的", () => click(d.querySelector('.tab[data-tab="me"]')));
ok(q("#v-me .wrap").innerHTML.indexOf("最近七天") > 0, "我的页没渲染");
ok(d.querySelectorAll("#v-me .mrow").length >= 5, "我的页条目太少");
step("看收藏", () => click(d.querySelector('#v-me [data-go="favs"]')));
ok(d.querySelectorAll("#v-me .lcard").length === 1, "收藏页没显示刚收藏的句子");
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

console.log("\n" + "-".repeat(46));
ok(errs.length === 0, "运行期报错：" + errs.join(" | "));
console.log(fail ? "✗ 通过 " + pass + "，失败 " + fail : "✓ 全部通过（" + pass + " 项）");
process.exit(fail ? 1 : 0);

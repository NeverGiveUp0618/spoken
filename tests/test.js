/* 内容源自检：node tests/test.js */
const path = require("path");
const fs = require("fs");
const { GROUPS, SCENES, TERMSETS, PATTERNS } = require(path.join(__dirname, "..", "data.js"));

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++) : (fail++, console.log("  ✗ " + m));
const sec = n => console.log("\n[" + n + "]");

sec("结构");
ok(GROUPS.length >= 8, "分组数不足");
ok(new Set(GROUPS.map(g => g.id)).size === GROUPS.length, "分组 id 重复");
ok(new Set(SCENES.map(s => s.id)).size === SCENES.length, "场景 id 重复：" +
  SCENES.map(s => s.id).filter((v, i, a) => a.indexOf(v) !== i));
GROUPS.forEach(g => ok(SCENES.some(s => s.group === g.id), "分组 " + g.id + " 下没有场景"));
SCENES.forEach(s => {
  ok(!!GROUPS.find(g => g.id === s.group), s.id + " 的 group 不存在：" + s.group);
  ok(s.lines.length === 3, s.id + " 不是三句，实为 " + s.lines.length);
  ok(!!(s.name && s.en), s.id + " 缺 name/en");
  ok(!s.icon, s.id + " 还残留 emoji 图标字段（场景不该有图标）");
});

sec("频率排序（必须 3→2→1 从高到低）");
SCENES.forEach(s => {
  const f = s.lines.map(l => l.freq);
  ok(f.join() === "3,2,1", s.id + " 频率不是 3,2,1，实为 " + f.join());
});

sec("句子字段");
const seen = new Map();
SCENES.forEach(s => s.lines.forEach((l, i) => {
  const at = s.id + "#" + i;
  ok(!!l.en && !!l.zh && !!l.tip, at + " 缺 en/zh/tip");
  ok(/[a-zA-Z]/.test(l.en), at + " 英文栏没有英文");
  ok(!/[一-龥]/.test(l.en), at + " 英文句里混入中文：" + l.en);
  ok(/[一-龥]/.test(l.zh), at + " 中文栏没有中文");
  ok(l.en.length <= 90, at + " 句子过长（" + l.en.length + " 字符）不适合口语背诵");
  ok(l.tip.length >= 8, at + " 用法提示太短");
  const k = l.en.toLowerCase().replace(/[^a-z ]/g, "");
  if (seen.has(k)) ok(false, "英文句重复：" + at + " 与 " + seen.get(k) + " → " + l.en);
  seen.set(k, at);
}));

sec("专业单词本");
ok(TERMSETS.length >= 6, "单词本分类过少");
ok(new Set(TERMSETS.map(t => t.id)).size === TERMSETS.length, "单词本 id 重复");
const tseen = new Map();
TERMSETS.forEach(set => {
  ok(set.terms.length >= 5, set.id + " 词条太少");
  set.terms.forEach((t, i) => {
    const at = set.id + "#" + i;
    ok(!!(t.en && t.zh && t.def && t.note), at + " 缺字段");
    ok(!/[一-龥]/.test(t.en), at + " 英文术语混入中文：" + t.en);
    ok(!/[一-龥]/.test(t.def), at + " 英文释义混入中文：" + t.def);
    ok(/[一-龥]/.test(t.zh), at + " 中文栏没有中文");
    const k = t.en.toLowerCase();
    if (tseen.has(k)) ok(false, "术语重复：" + at + " 与 " + tseen.get(k));
    tseen.set(k, at);
  });
});

sec("美式英语口径");
const BRIT = [
  [/\bqueue\b/i, "queue（英式）→ 美式 line"],
  [/\bcolour\b/i, "colour → color"],
  [/\bfavourite\b/i, "favourite → favorite"],
  [/\bpetrol\b/i, "petrol → gas"],
  [/\blift\b(?!\s*off)/i, "lift（电梯）→ elevator"],
  [/\bflat\b(?=\s|,|\.)/i, "flat（公寓）→ apartment"]
];
SCENES.forEach(s => s.lines.forEach((l, i) => {
  BRIT.forEach(([re, msg]) => {
    // 只查主句，tip 里作为对照说明可以出现英式词
    ok(!re.test(l.en), s.id + "#" + i + " 主句用了英式说法：" + msg + " → " + l.en);
  });
}));


sec("句型模板");
const ICONS = new Set(fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
  .match(/id="i-[a-z]+"/g).map(x => x.slice(6, -1)));
ok(PATTERNS.length >= 15, "核心句型过少");
ok(new Set(PATTERNS.map(p => p.id)).size === PATTERNS.length, "核心句型 id 重复");
const allPats = PATTERNS.map(p => ({ p, at: "core:" + p.id }))
  .concat(...SCENES.map(s => (s.pat || []).map((p, i) => ({ p, at: s.id + "#" + i }))));
SCENES.forEach(s => ok(s.pat && s.pat.length >= 2, s.id + " 场景模板不足 2 个"));
const pseen = new Map();
allPats.forEach(({ p, at }) => {
  ok(!!(p.pat && p.zh && p.fills), at + " 模板缺字段");
  ok(p.pat.indexOf("{}") >= 0, at + " 模板句没有 {} 占位：" + p.pat);
  ok(p.pat.split("{}").length === 2, at + " 模板句有多个 {}（渲染只支持一个）：" + p.pat);
  ok(p.zh.indexOf("{}") >= 0, at + " 中文模板没有 {} 占位：" + p.zh);
  ok(!/[\u4e00-\u9fa5]/.test(p.pat), at + " 英文模板混入中文：" + p.pat);
  ok(p.fills.length >= 4, at + " 替换词不足 4 个（" + p.fills.length + "）");
  p.fills.forEach((f, i) => {
    ok(Array.isArray(f) && f.length === 2, at + " 替换项 " + i + " 不是 [英文,中文] 二元组");
    ok(!/[\u4e00-\u9fa5]/.test(f[0]), at + " 替换词英文栏混入中文：" + f[0]);
    ok(/[\u4e00-\u9fa5]/.test(f[1]), at + " 替换词中文栏没有中文：" + f[1]);
    // 填进模板后不应出现明显语法拼接错误：重复的 to / 双空格
    const made = p.pat.replace("{}", f[0]);
    ok(made.indexOf("  ") < 0, at + " 填充后出现双空格：" + made);
    ok(!/\bto to\b|\ba a\b|\bthe the\b/.test(made), at + " 填充后出现重复词：" + made);
  });
  const k = p.pat.toLowerCase() + "|" + (p.core ? "core" : at.split("#")[0]);
  if (pseen.has(k)) ok(false, "同一处模板重复：" + at + " 与 " + pseen.get(k));
  pseen.set(k, at);
});

sec("图标（不许再用 emoji）");
GROUPS.forEach(g => ok(ICONS.has(g.icon), "分组 " + g.id + " 的图标 " + g.icon + " 在 sprite 里不存在"));
TERMSETS.forEach(t => ok(ICONS.has(t.icon), "单词本 " + t.id + " 的图标 " + t.icon + " 在 sprite 里不存在"));
// 箭头 →← 是正文排版符号，允许；这里只禁真正当图标用的 emoji 和 ★☆✓✗
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2B00}-\u{2BFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u2605\u2606\u2713\u2717]/u;
["app.js", "index.html"].forEach(f => {
  const txt = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  txt.split("\n").forEach((line, i) => {
    const tr = line.trim();
    if (tr.startsWith("//") || tr.startsWith("*") || tr.startsWith("/*") || line.indexOf("\u26a0") >= 0) return;
    ok(!EMOJI.test(line), f + ":" + (i + 1) + " 界面里还有 emoji/符号图标：" + line.trim().slice(0, 70));
  });
});
const appTxt = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
[...appTxt.matchAll(/ic\("([a-z]+)"/g)].forEach(m =>
  ok(ICONS.has(m[1]), "app.js 用了不存在的图标：" + m[1]));

sec("引用完整性（app.js / index.html）");
const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
ok(app.indexOf("SCENES") > 0 && app.indexOf("TERMSETS") > 0, "app.js 没引用内容源");
["data.js", "app.js", "manifest.json"].forEach(f =>
  ok(html.indexOf(f) > 0, "index.html 未引用 " + f));
["home", "pat", "terms", "drill", "me"].forEach(t =>
  ok(html.indexOf('id="v-' + t + '"') > 0 && app.indexOf("PAGES." + t) > 0, "缺 tab 视图或渲染器：" + t));
const swtxt = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
const vHtml = (html.match(/data\.js\?v=(\d+)/) || [])[1];
const vSw = (swtxt.match(/data\.js\?v=(\d+)/) || [])[1];
ok(!!vHtml && vHtml === vSw, "data.js 版本号缺失或 index.html(" + vHtml + ") 与 sw.js(" + vSw + ") 不一致");
ok(/ignoreSearch/.test(swtxt), "sw 回退未用 ignoreSearch");
ok(/sessionStorage/.test(app) && /controllerchange/.test(app), "缺 controllerchange 死循环守卫");

const nL = SCENES.reduce((a, s) => a + s.lines.length, 0);
const nT = TERMSETS.reduce((a, t) => a + t.terms.length, 0);
const nP = allPats.length;
const nF = allPats.reduce((a, x) => a + x.p.fills.length, 0);
console.log("\n" + "-".repeat(46));
console.log("分组 " + GROUPS.length + " · 场景 " + SCENES.length + " · 模板 " + nP +
  "（可组合 " + nF + " 句） · 例句 " + nL + " · 专业词 " + nT);
console.log(fail ? "✗ 通过 " + pass + " 项，失败 " + fail + " 项" : "✓ 全部通过（" + pass + " 项）");
process.exit(fail ? 1 : 0);

/* 内容源自检：node tests/test.js */
const path = require("path");
const fs = require("fs");
const { GROUPS, SCENES, TERMSETS } = require(path.join(__dirname, "..", "data.js"));

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
  ok(!!(s.name && s.en && s.icon), s.id + " 缺 name/en/icon");
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

sec("引用完整性（app.js / index.html）");
const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
ok(app.indexOf("SCENES") > 0 && app.indexOf("TERMSETS") > 0, "app.js 没引用内容源");
["data.js", "app.js", "manifest.json"].forEach(f =>
  ok(html.indexOf(f) > 0, "index.html 未引用 " + f));
["home", "terms", "drill", "me"].forEach(t =>
  ok(html.indexOf('id="v-' + t + '"') > 0 && app.indexOf("PAGES." + t) > 0, "缺 tab 视图或渲染器：" + t));
const swtxt = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
ok(/data\.js\?v=/.test(swtxt) && /data\.js\?v=/.test(html), "data.js 未带版本号（改内容后手机会读旧缓存）");
ok(/ignoreSearch/.test(swtxt), "sw 回退未用 ignoreSearch");
ok(/sessionStorage/.test(app) && /controllerchange/.test(app), "缺 controllerchange 死循环守卫");

const nL = SCENES.reduce((a, s) => a + s.lines.length, 0);
const nT = TERMSETS.reduce((a, t) => a + t.terms.length, 0);
console.log("\n" + "-".repeat(46));
console.log("分组 " + GROUPS.length + " · 场景 " + SCENES.length + " · 句子 " + nL + " · 专业词 " + nT);
console.log(fail ? "✗ 通过 " + pass + " 项，失败 " + fail + " 项" : "✓ 全部通过（" + pass + " 项）");
process.exit(fail ? 1 : 0);

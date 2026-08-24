/* 内容源自检：node tests/test.js */
const path = require("path");
const fs = require("fs");
const { GROUPS, SCENES, TERMSETS, PATTERNS, nearParts } = require(path.join(__dirname, "..", "data.js"));

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


sec("微对话");
let nDlg = 0, nTurn = 0;
SCENES.forEach(s => {
  ok(!!s.dlg, s.id + " 缺微对话");
  if (!s.dlg) return;
  nDlg++; nTurn += s.dlg.length;
  ok(s.dlg.length >= 6, s.id + " 对话太短（" + s.dlg.length + " 句），至少 6 句才算走完一轮");
  ok(s.dlg.length <= 10, s.id + " 对话太长（" + s.dlg.length + " 句），演练会累");
  const you = s.dlg.filter(d => d[0] === "y").length;
  ok(you >= 3, s.id + " 你说的只有 " + you + " 句，练不到什么");
  ok(Math.abs(you - (s.dlg.length - you)) <= 2, s.id + " 你和对方说的句数太不平衡");
  let last = null;
  s.dlg.forEach((d, i) => {
    const at = s.id + " 第" + (i + 1) + "句";
    ok(Array.isArray(d) && d.length === 3, at + " 不是 [谁,英文,中文] 三元组");
    if (!Array.isArray(d) || d.length !== 3) return;
    ok(d[0] === "y" || d[0] === "t", at + " 说话人只能是 y/t，实为 " + d[0]);
    ok(!/[\u4e00-\u9fa5]/.test(d[1]), at + " 英文里混入中文：" + d[1]);
    ok(/[\u4e00-\u9fa5]/.test(d[2]), at + " 中文栏没有中文：" + d[2]);
    ok(d[1].split(/\s+/).length <= 16, at + " 太长（" + d[1].split(/\s+/).length + " 词），对话句要短");
    ok(d[0] !== last, at + " 和上一句是同一个人说的，不成对话");
    last = d[0];
  });
  // 对话应该真的用上这个场景的核心表达
  const norm = x => x.toLowerCase().replace(/[^a-z ]/g, "");
  const youText = s.dlg.filter(d => d[0] === "y").map(d => norm(d[1])).join(" | ");
  const core = norm(s.lines[0].en).split(/\s+/).filter(w => w.length > 3);
  const hit = core.filter(w => youText.indexOf(w) >= 0).length;
  ok(hit >= Math.min(2, core.length), s.id + " 对话里没用上本场景的核心说法：" + s.lines[0].en);
});
ok(nDlg === SCENES.length, "不是每个场景都有对话");

sec("对方回答（听力素材）");
let nReply = 0, nSplit = 0;
SCENES.forEach(s => s.lines.forEach((l, i) => {
  const at = s.id + "#" + i;
  if (!l.reply || !/[a-zA-Z]/.test(l.reply)) return;
  nReply++;
  ok(!!l.rz, at + " 对方回答缺中文 rz（听力题要用）");
  if (!l.rz) return;
  ok(/[\u4e00-\u9fa5]/.test(l.rz), at + " rz 里没有中文：" + l.rz);
  const en = l.reply.split(" / "), zh = l.rz.split("/ ");
  ok(en.length === zh.length, at + " 英文 " + en.length + " 句、中文 " + zh.length + " 句，对不上");
  nSplit += en.length;
  en.forEach(e => ok(!/[\u4e00-\u9fa5]/.test(e), at + " 对方回答英文里混入中文：" + e));
}));
ok(nReply > 100, "对方回答条数太少");

sec("界面上的英文都要能点读");
// 曾经漏掉两处：「换个说法」有音频却没给喇叭按钮；「近义句式」压根没生成音频
const appSrc = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
ok(/data-say="' \+ esc\(l\.alt\)/.test(appSrc) || /esc\(l\.alt\)[^]{0,200}data-say/.test(appSrc),
   "「换个说法」没有朗读按钮 —— 有音频也听不到");
ok(/nearParts\(p\.near\)/.test(appSrc), "「近义句式」没有走 nearParts 渲染，英文点不了");
ok(!/function nearParts/.test(appSrc),
   "app.js 自己又写了一份 nearParts —— 必须只用 data.js 里那份，否则规则会漂移");
const genSrc = fs.readFileSync(path.join(__dirname, "..", "tools", "gen_audio.py"), "utf8");
ok(/nearParts\(/.test(genSrc), "gen_audio.py 没有走 nearParts，近义句式不会被合成");
ok(!/\\\\\(\[\^\)\]/.test(genSrc),
   "gen_audio.py 的模板字符串里又出现了裸反斜杠正则 —— 会被吃掉导致静默失效");

sec("发音覆盖（微信里全靠这些 mp3）");
const audDir = path.join(__dirname, "..", "audio");
let AUDIO_MAP = null;
if (fs.existsSync(path.join(audDir, "manifest.js"))) {
  const src = fs.readFileSync(path.join(audDir, "manifest.js"), "utf8");
  AUDIO_MAP = JSON.parse(src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1));
}
ok(!!AUDIO_MAP, "audio/manifest.js 不存在或解析不了 —— 跑 .venv/bin/python tools/gen_audio.py");
if (AUDIO_MAP) {
  const need = new Set();
  SCENES.forEach(sc => {
    sc.lines.forEach(l => need.add(l.en));
    (sc.pat || []).forEach(p => p.fills.forEach(f => need.add(p.pat.replace("{}", f[0]))));
  });
  PATTERNS.forEach(p => p.fills.forEach(f => need.add(p.pat.replace("{}", f[0]))));
  TERMSETS.forEach(t => t.terms.forEach(x => need.add(x.en)));
  const missing = [...need].filter(t => !AUDIO_MAP[t]);
  ok(missing.length === 0, "有 " + missing.length + " 条没有录音，微信里点了会没声音，例如：" + missing.slice(0, 3).join(" / "));
  const noFile = Object.values(AUDIO_MAP).filter(f => !fs.existsSync(path.join(audDir, f)));
  ok(noFile.length === 0, "manifest 里有 " + noFile.length + " 条指向不存在的 mp3");
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  ok(/audio\/manifest\.js/.test(html), "index.html 没引入 audio/manifest.js");
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  ok(/AUDIO_MAP/.test(app) && /SILENT_WAV/.test(app), "app.js 没走 mp3 通道或缺静音解锁");
  ok(/WeixinJSBridgeReady/.test(app), "app.js 缺微信 JSBridge 解锁");
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  ok(!/\.mp3/.test(sw), "sw.js 不该预缓存 mp3（近千个文件会拖垮首屏）");
}

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
console.log("微对话 " + nDlg + " 段 " + nTurn + " 句 · 对方回答 " + nReply + " 条（拆句 " + nSplit + "）");
console.log("分组 " + GROUPS.length + " · 场景 " + SCENES.length + " · 模板 " + nP +
  "（可组合 " + nF + " 句） · 例句 " + nL + " · 专业词 " + nT);
console.log(fail ? "✗ 通过 " + pass + " 项，失败 " + fail + " 项" : "✓ 全部通过（" + pass + " 项）");
process.exit(fail ? 1 : 0);

/* 开口说 · 主逻辑
 * 内容全部来自 data.js（GROUPS / SCENES / TERMSETS），本文件不写死任何句子。
 */
"use strict";

/* ========== 0. 索引 ========== */
const LINES = [];
SCENES.forEach(s => s.lines.forEach((l, i) => LINES.push(
  Object.assign({}, l, { sid: s.id, sname: s.name, sen: s.en, icon: s.icon, group: s.group, key: s.id + "#" + i })
)));
const PATS = [];   // 所有模板：核心句型 + 场景模板
PATTERNS.forEach((p, i) => PATS.push(Object.assign({}, p, { core: true, key: "P:core#" + i, from: "核心句型" })));
SCENES.forEach(sc => (sc.pat || []).forEach((p, i) => PATS.push(
  Object.assign({}, p, { core: false, sid: sc.id, sname: sc.name, group: sc.group, key: "P:" + sc.id + "#" + i, from: sc.name })
)));
const REPLIES = [];   // 听力素材：对方的回答，按 " / " 拆成单句
SCENES.forEach(sc => sc.lines.forEach((l, i) => {
  if (!l.reply || !/[a-zA-Z]/.test(l.reply) || !l.rz) return;
  const en = l.reply.split(" / "), zh = l.rz.split("/ ");
  en.forEach((e, j) => REPLIES.push({
    en: e.trim(), zh: (zh[j] || zh[0] || "").trim(),
    ask: l.en, askZh: l.zh, sname: sc.name,
    key: "R:" + sc.id + "#" + i + "." + j
  }));
}));
const DLGS = [];   // 微对话：每场景一段完整往返
SCENES.forEach(sc => { if (sc.dlg) DLGS.push({ sid: sc.id, sname: sc.name, sen: sc.en, group: sc.group, rows: sc.dlg, key: "D:" + sc.id }); });
const TERMS = [];
TERMSETS.forEach(t => t.terms.forEach((x, i) => TERMS.push(
  Object.assign({}, x, { tid: t.id, tname: t.name, key: "T:" + t.id + "#" + i })
)));
const GROUP_OF = {}; GROUPS.forEach(g => GROUP_OF[g.id] = g);
const SCENE_OF = {}; SCENES.forEach(s => SCENE_OF[s.id] = s);

/* ========== 1. 存储 ========== */
const KEY = { srs: "spoken_srs_v1", fav: "spoken_fav_v1", cfg: "spoken_cfg_v1", log: "spoken_log_v1" };
function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
let SRS = load(KEY.srs, {});
let FAV = load(KEY.fav, {});
let CFG = Object.assign({ slow: false, autoplay: true, showZh: true, qnum: 10 }, load(KEY.cfg, {}));
let LOG = load(KEY.log, {});           // { "2026-08-22": {done:12, right:9} }

const DAY = 864e5;
const INTERVAL = [0, 1, 2, 4, 8, 16, 30];   // box → 间隔天数
function today() { const d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
function srsOf(k) { return SRS[k] || { box: 0, due: 0 }; }
function grade(k, ok) {
  const s = srsOf(k);
  s.box = ok ? Math.min(6, s.box + 1) : Math.max(0, s.box - 1);
  s.due = Date.now() + INTERVAL[s.box] * DAY;
  s.seen = (s.seen || 0) + 1;
  SRS[k] = s; save(KEY.srs, SRS);
  const t = today(); LOG[t] = LOG[t] || { done: 0, right: 0 };
  LOG[t].done++; if (ok) LOG[t].right++; save(KEY.log, LOG);
}
function dueList() {
  const now = Date.now();
  return PATS.concat(LINES, TERMS).filter(x => SRS[x.key] && SRS[x.key].due <= now && SRS[x.key].box < 6);
}
function learnedCount() { return Object.keys(SRS).filter(k => SRS[k].box >= 3).length; }

/* ========== 2. 发音 ==========
 * 主通道：预合成的 mp3（tools/gen_audio.py 生成，AUDIO_MAP 是索引）。
 * 为什么不直接用 speechSynthesis：微信内置浏览器（安卓 X5 / iOS WKWebView）
 * 基本不支持它，点了没声音——这正是用户在微信里打开时遇到的问题。
 * 系统 TTS 只作兜底：mp3 里没有的文本，或播放被拦截时才用。
 */
const AUD = typeof Audio !== "undefined" ? new Audio() : null;
if (AUD) { AUD.preload = "auto"; }
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";

function audioFile(text) {
  if (typeof AUDIO_MAP === "undefined") return null;
  const t = String(text).trim();
  return AUDIO_MAP[t] || AUDIO_MAP[t.split(/[（(]/)[0].trim()] || null;
}

/* iOS / 微信要求：音频必须先在一次真实触摸里「解锁」，否则后续全部静音 */
let audioReady = false, noSoundWarned = false;
function unlockAudio() {
  if (audioReady) return;
  audioReady = true;
  try {
    if (AUD) { AUD.src = SILENT_WAV; const p = AUD.play(); if (p && p.catch) p.catch(() => {}); }
  } catch (e) {}
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0.01; u.lang = "en-US";
    speechSynthesis.speak(u); pickVoice();
  } catch (e) {}
}
document.addEventListener("touchend", unlockAudio, { passive: true });
document.addEventListener("click", unlockAudio);
/* 微信 iOS 里 JSBridge 就绪后再解锁一次，成功率更高 */
document.addEventListener("WeixinJSBridgeReady", unlockAudio);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { try { if (AUD) AUD.pause(); speechSynthesis.cancel(); } catch (e) {} }
});

let VOICE = null;
function pickVoice() {
  if (!window.speechSynthesis) return;
  const vs = speechSynthesis.getVoices();
  if (!vs.length) return;
  const pref = ["Samantha", "Google US English", "Alex", "Ava", "Allison", "Nicky", "Aaron"];
  for (const p of pref) { const v = vs.find(v => v.name.indexOf(p) >= 0 && /en[-_]US/i.test(v.lang)); if (v) { VOICE = v; return; } }
  VOICE = vs.find(v => /en[-_]US/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null;
}
if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

/* 主入口：先 mp3，不行才系统 TTS */
function say(text, slow) {
  unlockAudio();
  const f = audioFile(text);
  if (AUD && f) {
    try {
      AUD.pause();
      AUD.src = "audio/" + f;
      AUD.playbackRate = slow || CFG.slow ? 0.65 : 1;
      AUD.currentTime = 0;
      const p = AUD.play();
      if (p && p.catch) p.catch(() => sayTTS(text, slow));
      return;
    } catch (e) {}
  }
  sayTTS(text, slow);
}
function sayTTS(text, slow) {
  if (!("speechSynthesis" in window)) return noSound();
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).replace(/—/g, ",").replace(/\.\.\./g, " "));
    u.lang = "en-US"; if (VOICE) u.voice = VOICE;
    u.rate = slow || CFG.slow ? 0.62 : 0.94; u.pitch = 1;
    u.onerror = noSound;
    speechSynthesis.speak(u);
  } catch (e) { noSound(); }
}
function noSound() {
  if (noSoundWarned) return;
  noSoundWarned = true;
  toast("这句还没有录音，且当前浏览器不支持朗读");
}

/* ========== 3. 小工具 ========== */
const $ = s => document.querySelector(s);
const ic = (name, cls) => '<svg class="i' + (cls ? " " + cls : "") + '"><use href="#i-' + name + '"/></svg>';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let toastTimer;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 1900);
}
function stars(n) {
  let h = '<span class="stars">';
  for (let i = 1; i <= 3; i++) h += ic("star", i <= n ? "fill" : "off");
  return h + "</span>";
}
const FQTXT = { 3: "几乎每次都用", 2: "常用", 1: "备用" };
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function seededPick(arr, n, seed) {
  let s = 0; for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  const out = [], used = {};
  while (out.length < Math.min(n, arr.length)) {
    s = (s * 1103515245 + 12345) >>> 0;
    const i = s % arr.length;
    if (!used[i]) { used[i] = 1; out.push(arr[i]); }
  }
  return out;
}

/* ========== 4. 路由 ========== */
let TAB = "home";
let STACK = [];          // 当前 tab 内的页面栈
const PAGES = {};        // 渲染器注册表

function go(page, arg, replace) {
  const st = { tab: TAB, page, arg };
  if (replace) STACK[STACK.length - 1] = st; else STACK.push(st);
  history.pushState({ tab: TAB, depth: STACK.length }, "");
  render();
}
function switchTab(tab) {
  TAB = tab; STACK = [{ tab, page: tab, arg: null }];
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.dataset.tab === tab));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + tab));
  $("#app").scrollTop = 0;
  render();
}
function back() { if (STACK.length > 1) { STACK.pop(); render(); } }
window.addEventListener("popstate", () => { if (STACK.length > 1) { STACK.pop(); render(); } });

function render() {
  const st = STACK[STACK.length - 1];
  const box = $("#v-" + TAB + " .wrap");
  $("#back").classList.toggle("on", STACK.length > 1);
  $("#act").innerHTML = "";
  $("#act").classList.remove("on");
  $("#act").onclick = null;
  (PAGES[st.page] || (() => { box.innerHTML = "<div class='empty'>页面不存在</div>"; }))(box, st.arg);
  if (STACK.length > 1) $("#app").scrollTop = 0;
}
function secBar(title, note, foldScope) {
  return '<div class="sec"><span class="t">' + esc(title) + '</span><span class="l"></span>' +
    (foldScope ? '<button class="secbtn" data-foldall="' + foldScope + '">全部展开</button>'
               : note ? '<span class="n">' + esc(note) + "</span>" : "") + "</div>";
}
function setTitle(main, sub) {
  $("#ttl").innerHTML = esc(main) + (sub ? ' <span class="sub">' + esc(sub) + "</span>" : "");
}
function topAction(icon, fn) {
  const a = $("#act"); a.innerHTML = ic(icon); a.classList.add("on"); a.onclick = fn;
}


/* ========== 5. 模板卡（可点词填空） ========== */
let PSEQ = 0;
function splitPat(p) {
  const i = p.indexOf("{}");
  return i < 0 ? [p, ""] : [p.slice(0, i), p.slice(i + 2)];
}
function patCard(p, opt) {
  opt = opt || {};
  const id = "p" + (PSEQ++);
  const [a, b] = splitPat(p.pat);
  const fav = FAV[p.key] ? "on" : "";
  const fold = opt.fold !== false;   // 默认折叠；场景页传 fold:false 直接展开
  return '<div class="pcard' + (opt.plain ? " plain" : "") + (fold ? " fold" : "") +
      '" id="' + id + '" data-pk="' + p.key + '">' +
    (fold ? '<div class="foldhead" data-pfold="' + id + '">' : "") +
    '<div class="phead">' +
      '<span class="tag">' + ic("slot") + (opt.label || (p.core ? "核心句型" : "场景模板")) + "</span>" +
      (opt.from ? '<span class="pill">' + esc(p.from) + "</span>" : "") +
      (fold ? '<span class="pill">' + p.fills.length + " 个换法</span>" : "") +
      '<span class="sp"></span>' +
      '<button class="iconbtn ' + fav + '" data-fav="' + p.key + '">' + ic("star", "sm") + "</button>" +
      '<button class="iconbtn" data-psay="' + id + '">' + ic("sound", "sm") + "</button>" +
      (fold ? '<span class="foldarrow">' + ic("next") + "</span>" : "") +
    "</div>" +
    '<div class="ppat">' + esc(a) +
      '<span class="slot empty" data-slot="' + id + '">' + esc(p.slot || "____") + "</span>" +
      esc(b) + "</div>" +
    '<div class="pzh">' + esc(p.zh).replace(/\{\}/g, '<span class="zs">' + esc(p.slot || "…") + "</span>") + "</div>" +
    (fold ? "</div>" : "") +
    '<div class="pbody">' +
      (p.use ? '<div class="puse">' + esc(p.use) + "</div>" : "") +
      '<div class="pfills">' + p.fills.map((f, i) =>
        '<button class="pfill" data-fill="' + id + '" data-fi="' + i + '">' + esc(f[0]) +
        '<span class="zh">' + esc(f[1]) + "</span></button>").join("") + "</div>" +
      (p.where ? '<div class="pmeta"><b>常出现在</b> ' + esc(p.where) + "</div>" : "") +
      (p.near ? '<div class="pmeta"><b>近义句式</b> ' + esc(p.near) + "</div>" : "") +
    "</div></div>";
}
/* 折叠开合：点卡片头部展开，点里面的收藏/喇叭按钮不触发 */
document.addEventListener("click", e => {
  if (e.target.closest("[data-fav],[data-psay],[data-fill],[data-say],[data-slow]")) return;
  const h = e.target.closest("[data-pfold],[data-tfold]");
  if (h) {
    const card = document.getElementById(h.dataset.pfold || h.dataset.tfold);
    if (card) {
      const open = card.classList.toggle("open");
      if (open && card.dataset.pk) {         // 展开时顺手念一遍模板的第一个例子
        const p = PATS.find(x => x.key === card.dataset.pk);
        if (p && !card.dataset.filled) say(p.pat.replace("{}", p.fills[0][0]));
      }
    }
    return;
  }
  const fa = e.target.closest("[data-foldall]");
  if (fa) {
    const scope = document.getElementById(fa.dataset.foldall) || document;
    const cards = scope.querySelectorAll(".fold");
    const toOpen = fa.dataset.state !== "open";
    cards.forEach(c => c.classList.toggle("open", toOpen));
    fa.dataset.state = toOpen ? "open" : "";
    fa.textContent = toOpen ? "全部收起" : "全部展开";
  }
});

/* 点替换词 → 填进空里并朗读 */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-fill],[data-psay]");
  if (!t) return;
  const id = t.dataset.fill || t.dataset.psay;
  const card = document.getElementById(id);
  if (!card) return;
  const p = PATS.find(x => x.key === card.dataset.pk);
  if (!p) return;
  const slot = card.querySelector("[data-slot]");
  if (t.dataset.fill !== undefined) {
    const f = p.fills[+t.dataset.fi];
    card.querySelectorAll(".pfill").forEach(x => x.classList.remove("on"));
    t.classList.add("on");
    slot.textContent = f[0];
    slot.classList.remove("empty"); slot.classList.add("filled");
    card.dataset.filled = f[0];
    say(p.pat.replace("{}", f[0]));
  } else {
    say(card.dataset.filled ? p.pat.replace("{}", card.dataset.filled) : p.pat.replace("{}", p.fills[0][0]));
  }
});


/* ========== 5c. 微对话 ========== */
function dlgBlock(rows, sid) {
  return '<div class="dlgbar"><button class="btn gh" data-dlgplay="' + sid + '">' + ic("play") +
      "连播整段</button></div>" +
    '<div class="dlg" id="dlg-' + sid + '">' + rows.map((r, i) =>
      '<div class="bub ' + r[0] + '" data-di="' + i + '" data-say="' + esc(r[1]) + '">' +
        '<div class="who">' + (r[0] === "y" ? "你" : "对方") + "</div>" +
        '<div class="be">' + esc(r[1]) + "</div>" +
        '<div class="bz">' + esc(r[2]) + "</div></div>").join("") + "</div>";
}
/* 整段连播：按句长估时依次念，当前句高亮 */
let dlgTimer = null;
document.addEventListener("click", e => {
  const t = e.target.closest("[data-dlgplay]");
  if (!t) return;
  const box = document.getElementById("dlg-" + t.dataset.dlgplay);
  if (!box) return;
  clearTimeout(dlgTimer);
  const bubs = [...box.querySelectorAll(".bub")];
  bubs.forEach(b => b.classList.remove("playing"));
  let i = 0;
  const next = () => {
    bubs.forEach(b => b.classList.remove("playing"));
    if (i >= bubs.length) return;
    const b = bubs[i];
    b.classList.add("playing");
    if (b.scrollIntoView) b.scrollIntoView({ block: "center", behavior: "smooth" });
    say(b.dataset.say);
    const words = b.dataset.say.split(/\s+/).length;
    i++;
    dlgTimer = setTimeout(next, Math.max(1600, words * 420));
  };
  next();
});

/* ========== 5b. 句子卡片 ========== */
function lineCard(l, idx) {
  const fav = FAV[l.key] ? "on" : "";
  const box = srsOf(l.key).box;
  return '<div class="lcard' + (l.freq === 3 ? " top1" : "") + '" data-key="' + l.key + '">' +
    '<div class="lhead">' +
      stars(l.freq) +
      '<span class="fq">' + FQTXT[l.freq] + "</span>" +
      (box >= 3 ? '<span class="pill acc">已掌握</span>' : "") +
      '<span class="sp"></span>' +
      '<button class="iconbtn ' + fav + '" data-fav="' + l.key + '">' + ic("star", "sm") + "</button>" +
      '<button class="iconbtn" data-slow="' + esc(l.en) + '">' + ic("slow", "sm") + "</button>" +
      '<button class="iconbtn" data-say="' + esc(l.en) + '">' + ic("sound", "sm") + "</button>" +
    "</div>" +
    '<div class="len">' + esc(l.en) + "</div>" +
    '<div class="lzh">' + esc(l.zh) + "</div>" +
    '<div class="lmore" id="m' + idx + '">' +
      '<div class="r"><span class="k">什么时候用</span><span class="v">' + esc(l.tip) + "</span></div>" +
      (l.reply ? '<div class="r"><span class="k">对方会说</span><span class="v"><em>' + esc(l.reply) + "</em>" +
        (l.rz ? '<br><span style="color:var(--ink3);font-size:12px">' + esc(l.rz) + "</span>" : "") +
        (/[a-zA-Z]/.test(l.reply) ? ' <button class="iconbtn" style="width:24px;height:24px;display:inline-flex;vertical-align:middle" data-say="' +
          esc(l.reply.split(" / ")[0]) + '">' + ic("sound", "sm") + "</button>" : "") + "</span></div>" : "") +
      (l.alt ? '<div class="r"><span class="k">换个说法</span><span class="v"><em>' + esc(l.alt) + "</em></span></div>" : "") +
    "</div>" +
    '<button class="togmore" data-more="m' + idx + '">' + ic("next") + "用法</button>" +
    "</div>";
}

/* 事件委托：发音 / 收藏 / 展开 */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-say],[data-slow],[data-fav],[data-more],[data-go],[data-tab]");
  if (!t) return;
  if (t.dataset.say !== undefined) { say(t.dataset.say); }
  else if (t.dataset.slow !== undefined) { say(t.dataset.slow, true); }
  else if (t.dataset.fav !== undefined) {
    const k = t.dataset.fav;
    if (FAV[k]) { delete FAV[k]; t.classList.remove("on"); toast("已取消收藏"); }
    else { FAV[k] = 1; t.classList.add("on"); toast("已收藏"); }
    save(KEY.fav, FAV);
  }
  else if (t.dataset.more) {
    const m = document.getElementById(t.dataset.more);
    const open = m.classList.toggle("on");
    t.classList.toggle("open", open);
    t.innerHTML = ic("next") + (open ? "收起" : "用法");
  }
  else if (t.dataset.go) { go(t.dataset.go, t.dataset.arg || null); }
  else if (t.dataset.tab) { switchTab(t.dataset.tab); }
});

/* ========== 6. 首页：分组 ========== */
PAGES.home = function (box) {
  setTitle("开口说", "SPEAK UP");
  topAction("search", () => go("search"));
  const due = dueList().length;
  const t = LOG[today()] || { done: 0, right: 0 };

  let h = '<div class="hero">' +
    "<h3>" + ic("target") + "今日五句</h3>" +
    "<p>从最高频的句子里挑五句，念熟就能出门。今天已练 " + t.done + " 题。</p>" +
    '<div style="display:flex;gap:9px;flex-wrap:wrap">' +
      '<button class="go" data-go="daily">开始' + ic("next") + "</button>" +
      '<button class="go" style="background:var(--card3);color:var(--ink)" data-go="drill-run" data-arg="sayit">' +
        ic("mic") + "秒答</button></div></div>" +
    '<div class="stats">' +
      '<div class="stat"><b>' + PATS.length + "</b><span>句型模板</span></div>" +
      '<div class="stat"><b>' + learnedCount() + "</b><span>已掌握</span></div>" +
      '<div class="stat"><b>' + due + "</b><span>待复习</span></div>" +
    "</div>";

  h += '<div class="sec"><span class="t">生活场景</span><span class="l"></span><span class="n">' + SCENES.length + " 个场景</span></div>";
  h += '<div class="grid">';
  GROUPS.forEach(g => {
    const n = SCENES.filter(s => s.group === g.id).length;
    h += '<button class="gcard" data-go="group" data-arg="' + g.id + '">' +
      '<span class="ct">' + n + "</span>" +
      '<span class="ib">' + ic(g.icon, "lg") + "</span>" +
      '<div class="nm">' + esc(g.name) + "</div>" +
      '<div class="ds">' + esc(g.desc) + "</div></button>";
  });
  h += "</div>";
  h += '<div class="empty" style="padding:26px 10px 0;font-size:12px">每个场景先给两个句型模板，再给三句现成的。<br>模板熟了就能自己换词造句。</div>';
  box.innerHTML = h;
};

/* 今日五句 */
PAGES.daily = function (box) {
  setTitle("今日五句", "DAILY 5");
  const list = seededPick(LINES.filter(l => l.freq === 3), 5, today());
  let h = '<div class="hero" style="margin-bottom:14px"><h3>' + ic("target") + "今天这五句</h3>" +
    "<p>点喇叭跟着念三遍。念顺了去「练习 → 跟读打分」验收。</p></div>";
  list.forEach((l, i) => {
    h += '<div class="sec"><span class="t">' + esc(l.sname) + '</span><span class="l"></span></div>' + lineCard(l, "d" + i);
  });
  h += '<div class="btnrow"><button class="btn main" data-go="drill-run" data-arg="shadow">' + ic("mic") + "去跟读打分</button></div>";
  box.innerHTML = h;
};

/* 分组 → 场景列表 */
PAGES.group = function (box, gid) {
  const g = GROUP_OF[gid];
  setTitle(g.icon + " " + g.name, g.desc);
  const list = SCENES.filter(s => s.group === gid);
  let h = '<div class="slist">';
  list.forEach((s, i) => {
    const done = s.lines.every((_, j) => srsOf(s.id + "#" + j).box >= 3);
    h += '<button class="srow' + (done ? " done" : "") + '" data-go="scene" data-arg="' + s.id + '">' +
      '<span class="ix">' + (i + 1) + "</span>" +
      '<span class="bar"></span>' +
      '<span class="tx"><div class="nm">' + esc(s.name) + '</div><div class="en">' + esc(s.en) + "</div></span>" +
      '<span class="ar">' + ic("next") + "</span></button>";
  });
  h += "</div>";
  box.innerHTML = h;
};

/* 场景详情 */
PAGES.scene = function (box, sid) {
  const s = SCENE_OF[sid];
  setTitle(s.name, s.en);
  topAction("play", () => { let i = 0; const seq = () => { if (i < s.lines.length) { say(s.lines[i].en); i++; setTimeout(seq, 3200); } }; seq(); });
  let h = '<div class="sec"><span class="t">句型模板</span><span class="l"></span><span class="n">点词填空</span></div>';
  PATS.filter(p => p.sid === sid).forEach(p => h += patCard(p, { fold: false }));
  h += '<div class="sec"><span class="t">现成的三句</span><span class="l"></span><span class="n">按频率排</span></div>';
  s.lines.forEach((l, i) => h += lineCard(Object.assign({}, l, { key: sid + "#" + i }), sid + i));
  if (s.dlg) {
    h += '<div class="sec"><span class="t">完整对话</span><span class="l"></span><span class="n">从头到尾走一遍</span></div>' +
      dlgBlock(s.dlg, sid);
  }
  h += '<div class="btnrow"><button class="btn main" data-go="dlgrun" data-arg="' + sid + '">' + ic("mic") + "演练这段对话</button></div>" +
    '<div class="btnrow"><button class="btn gh" data-go="drill-run" data-arg="fill:' + sid + '">' + ic("slot") + '练模板</button>' +
    '<button class="btn gh" data-go="drill-run" data-arg="quiz:' + sid + '">' + ic("pen") + "练句子</button></div>";
  box.innerHTML = h;
};

/* 搜索 */
PAGES.search = function (box) {
  setTitle("搜索", "SEARCH");
  box.innerHTML = '<div class="searchbox"><span class="si">' + ic("search", "sm") + "</span>" +
    '<input id="q" placeholder="中英文都行：打车 / taxi / 八字 / hexagram" autofocus></div><div id="res"></div>';
  const inp = box.querySelector("#q"), res = box.querySelector("#res");
  const run = () => {
    const q = inp.value.trim().toLowerCase();
    if (q.length < 1) { res.innerHTML = '<div class="empty">输入关键词开始搜<br>句子和专业单词一起搜</div>'; return; }
    const ps = PATS.filter(p => (p.pat + p.zh + (p.use || "") + p.from + p.fills.map(f => f.join()).join()).toLowerCase().indexOf(q) >= 0).slice(0, 12);
    const ls = LINES.filter(l => (l.en + l.zh + l.sname + l.tip).toLowerCase().indexOf(q) >= 0).slice(0, 30);
    const ts = TERMS.filter(t => (t.en + t.zh + t.py + t.def + t.note).toLowerCase().indexOf(q) >= 0).slice(0, 20);
    let h = "";
    if (ps.length) {
      h += '<div class="sec"><span class="t">句型模板</span><span class="l"></span><span class="n">' + ps.length + "</span></div>";
      ps.forEach(p => h += patCard(p, { from: true }));
    }
    if (ls.length) {
      h += '<div class="sec"><span class="t">句子</span><span class="l"></span><span class="n">' + ls.length + "</span></div>";
      ls.forEach((l, i) => h += lineCard(l, "q" + i));
    }
    if (ts.length) {
      h += '<div class="sec"><span class="t">专业词</span><span class="l"></span><span class="n">' + ts.length + "</span></div>";
      ts.forEach(t => h += termCard(t));
    }
    res.innerHTML = h || '<div class="empty">没找到「' + esc(q) + "」<br>换个词试试</div>";
  };
  inp.addEventListener("input", run); run();
  setTimeout(() => inp.focus(), 100);
};


/* ========== 6b. 句型页 ========== */
PAGES.pat = function (box) {
  setTitle("句型模板", "PATTERNS");
  topAction("search", () => { switchTab("home"); go("search"); });
  const done = PATTERNS.filter(p => srsOf(p.key).box >= 3).length;
  let h = '<div class="hero"><h3>' + ic("slot") + "先记模板，再自己填空</h3>" +
    "<p>下面 " + PATTERNS.length + " 个骨架顶掉大半场合。一个 Could I have ___ 就能换出十几句。" +
    "点任意一个替换词，它会填进空里并念给你听。</p>" +
    '<button class="go" data-go="drill-run" data-arg="fill">练填空' + ic("next") + "</button></div>";
  h += '<div class="stats">' +
    '<div class="stat"><b>' + PATTERNS.length + "</b><span>核心句型</span></div>" +
    '<div class="stat"><b>' + PATS.length + "</b><span>模板总数</span></div>" +
    '<div class="stat"><b>' + done + "</b><span>已掌握</span></div></div>";
  h += secBar("核心句型", null, "v-pat");
  PATTERNS.forEach((p, i) => h += patCard(PATS.find(x => x.key === "P:core#" + i)));
  h += '<div class="sec"><span class="t">场景模板</span><span class="l"></span><span class="n">' +
    (PATS.length - PATTERNS.length) + " 个</span></div>";
  GROUPS.forEach(g => {
    const n = PATS.filter(p => p.group === g.id).length;
    h += '<button class="mrow" data-go="patgroup" data-arg="' + g.id + '"><span class="ib">' + ic(g.icon, "sm") + "</span>" +
      '<span class="tx"><div class="nm">' + esc(g.name) + '</div><div class="ds">' + esc(g.desc) + "</div></span>" +
      '<span class="vl">' + n + " 个</span></button>";
  });
  box.innerHTML = h;
};
PAGES.patgroup = function (box, gid) {
  const g = GROUP_OF[gid];
  setTitle(g.name + " · 模板", g.desc);
  let h = '<div class="sec"><span class="t">' + esc(g.name) + '</span><span class="l"></span>' +
    '<button class="secbtn" data-foldall="v-pat">全部展开</button></div>';
  SCENES.filter(s => s.group === gid).forEach(sc => {
    h += '<div class="sec" style="margin:16px 2px 10px"><span class="t" style="font-size:11.5px;color:var(--ink2)">' +
      esc(sc.name) + '</span><span class="l"></span><span class="n">' + esc(sc.en) + "</span></div>";
    PATS.filter(p => p.sid === sc.id).forEach(p => h += patCard(p, { plain: true }));
  });
  box.innerHTML = h;
};


/* 对话演练：轮到你说时先给中文，说完翻开对答案；对方的话自动播 */

PAGES.dlgpick = function (box) {
  setTitle("对话演练", "ROLE PLAY");
  let h = '<div class="hero"><h3>' + ic("chat") + "整段来回走一遍</h3>" +
    "<p>单句会说，不等于接得上话。这里每个场景一段完整对话：对方的话自动播给你听，" +
    "轮到你时先看中文自己说出来，再翻开对答案。</p></div>";
  GROUPS.forEach(g => {
    const list = DLGS.filter(d => d.group === g.id);
    if (!list.length) return;
    h += '<div class="sec"><span class="t">' + esc(g.name) + '</span><span class="l"></span><span class="n">' +
      list.length + " 段</span></div>";
    list.forEach(d => {
      h += '<button class="mrow" data-go="dlgrun" data-arg="' + d.sid + '"><span class="ib">' + ic("chat", "sm") + "</span>" +
        '<span class="tx"><div class="nm">' + esc(d.sname) + '</div><div class="ds">' + esc(d.sen) + "</div></span>" +
        '<span class="vl">' + d.rows.length + " 句</span></button>";
    });
  });
  box.innerHTML = h;
};

PAGES.dlgrun = function (box, sid) {
  const sc = SCENE_OF[sid];
  setTitle(sc.name + " · 演练", "ROLE PLAY");
  const rows = sc.dlg;
  let at = 0;
  const state = [];   // 已走过的行

  function draw() {
    let h = '<div class="qbar"><div class="pg"><i style="width:' + (at / rows.length * 100) + '%"></i></div>' +
      '<span class="nm">' + Math.min(at + 1, rows.length) + " / " + rows.length + "</span></div>" +
      '<div class="dlg" id="rp">';
    state.forEach(i => {
      const r = rows[i];
      h += '<div class="bub ' + r[0] + '" data-say="' + esc(r[1]) + '">' +
        '<div class="who">' + (r[0] === "y" ? "你" : "对方") + "</div>" +
        '<div class="be">' + esc(r[1]) + "</div>" +
        '<div class="bz">' + esc(r[2]) + "</div></div>";
    });
    h += "</div>";
    if (at >= rows.length) {
      h += '<div class="fb on ok" style="text-align:center"><div class="t" style="justify-content:center">' +
        ic("check", "sm") + "整段走完了</div>" +
        '<div class="btnrow"><button class="btn gh" data-dlgplay2="1">' + ic("play") + "整段连播</button>" +
        '<button class="btn main" id="again">' + ic("repeat") + "再来一遍</button></div></div>";
    } else {
      const r = rows[at];
      if (r[0] === "y") {
        h += '<div class="qbox" style="min-height:auto;padding:16px"><div class="qh">轮到你说</div>' +
          '<div class="qz" style="font-size:19px">' + esc(r[2]) + "</div></div>" +
          '<button class="btn main" id="flip" style="width:100%;padding:15px">' + ic("next") + "说完了，看答案</button>";
      } else {
        h += '<div class="qbox" style="min-height:auto;padding:16px"><div class="qh">对方在说……</div>' +
          '<button class="btn main" id="go" style="margin-top:6px">' + ic("sound") + "听完了，继续</button></div>";
      }
    }
    box.innerHTML = h;
    const rp = box.querySelector("#rp");
    if (rp && rp.lastElementChild && rp.lastElementChild.scrollIntoView)
      rp.lastElementChild.scrollIntoView({ block: "nearest" });

    const flip = box.querySelector("#flip");
    if (flip) flip.onclick = () => {
      const r = rows[at];
      say(r[1]);
      flip.outerHTML = '<div class="fb on ok"><div class="en" style="text-align:center;font-size:19px">' +
        esc(r[1]) + "</div>" +
        '<div class="btnrow" style="margin-top:10px"><button class="btn gh" data-say="' + esc(r[1]) + '">' +
          ic("sound") + "再听</button>" +
        '<button class="btn main" id="nx2">' + ic("next") + "下一句</button></div></div>";
      box.querySelector("#nx2").onclick = () => { state.push(at); at++; draw(); };
    };
    const go = box.querySelector("#go");
    if (go) {
      say(rows[at][1]);
      go.onclick = () => { state.push(at); at++; draw(); };
    }
    const ag = box.querySelector("#again");
    if (ag) ag.onclick = () => { at = 0; state.length = 0; draw(); };
    const p2 = box.querySelector("[data-dlgplay2]");
    if (p2) p2.onclick = () => {
      let i = 0;
      const bubs = [...box.querySelectorAll("#rp .bub")];
      const next = () => {
        bubs.forEach(b => b.classList.remove("playing"));
        if (i >= bubs.length) return;
        bubs[i].classList.add("playing");
        say(bubs[i].dataset.say);
        const w = bubs[i].dataset.say.split(/\s+/).length; i++;
        setTimeout(next, Math.max(1600, w * 420));
      };
      next();
    };
  }
  draw();
};

/* ========== 7. 单词本 ========== */
let TSEQ = 0;
function termCard(t, opt) {
  opt = opt || {};
  const fav = FAV[t.key] ? "on" : "";
  const fold = opt.fold !== false;
  const id = "t" + (TSEQ++);
  return '<div class="tcard' + (fold ? " fold" : "") + '" id="' + id + '">' +
    (fold ? '<div class="foldhead" data-tfold="' + id + '">' : "") +
    '<div class="thead"><div class="ten">' + esc(t.en) +
      '<div class="tzh">' + esc(t.zh) + "</div>" +
      (t.py && t.py !== "—" ? '<div class="tpy">' + esc(t.py) + "</div>" : "") +
    "</div>" +
    '<button class="iconbtn ' + fav + '" data-fav="' + t.key + '">' + ic("star", "sm") + "</button>" +
    '<button class="iconbtn" data-say="' + esc(t.en) + '">' + ic("sound", "sm") + "</button>" +
    (fold ? '<span class="foldarrow">' + ic("next") + "</span>" : "") + "</div>" +
    (fold ? "</div>" : "") +
    '<div class="tdef" data-say="' + esc(t.def) + '">' + esc(t.def) + "</div>" +
    '<div class="tnote">' + esc(t.note).replace(/⚠️/g, "<b>⚠️</b>") + "</div></div>";
}
PAGES.terms = function (box) {
  setTitle("专业单词本", "I CHING TERMS");
  topAction("search", () => { switchTab("home"); go("search"); });
  let h = '<div class="hero"><h3>' + ic("yinyang") + "用英语讲你这一行</h3>" +
    "<p>易经、八字、风水、术数的行业英文：术语 + 一句能直接背的英文释义 + 别说错的提示。共 " +
    TERMS.length + " 词。</p>" +
    '<button class="go" data-go="drill-run" data-arg="word">背单词' + ic("next") + "</button></div>";
  h += '<div class="sec"><span class="t">分类</span><span class="l"></span></div><div class="grid">';
  TERMSETS.forEach(t => {
    h += '<button class="gcard" data-go="termset" data-arg="' + t.id + '">' +
      '<span class="ct">' + t.terms.length + "</span>" +
      '<span class="ib">' + ic(t.icon, "lg") + "</span>" +
      '<div class="nm">' + esc(t.name) + "</div>" +
      '<div class="ds">' + esc(t.en) + "</div></button>";
  });
  h += "</div>";
  box.innerHTML = h;
};
PAGES.termset = function (box, tid) {
  const set = TERMSETS.find(t => t.id === tid);
  setTitle(set.name, set.en);
  topAction("play", () => { let i = 0; const seq = () => { if (i < set.terms.length) { say(set.terms[i].en); i++; setTimeout(seq, 2200); } }; seq(); });
  box.innerHTML = '<div class="sec"><span class="t">' + esc(set.name) + '</span><span class="l"></span>' +
    '<button class="secbtn" data-foldall="v-terms">全部展开</button></div>' +
    set.terms.map((x, i) => termCard(Object.assign({}, x, { key: "T:" + tid + "#" + i }))).join("");
};

/* ========== 8. 练习 ========== */
PAGES.drill = function (box) {
  setTitle("练习", "PRACTICE");
  const due = dueList().length;
  const favN = Object.keys(FAV).length;
  let h = '<div class="hero"><h3>' + ic("chart") + "今天的进度</h3><p>" +
    ((LOG[today()] || {}).done || 0) + " 题已答，正确 " +
    ((LOG[today()] || {}).right || 0) + " 题。待复习 " + due + " 条。</p></div>";
  h += '<div class="sec"><span class="t">选个练法</span><span class="l"></span></div><div class="modes">';
  h += '<button class="mode" data-go="dlgpick"><span class="ib">' + ic("chat", "lg") + "</span>" +
    '<span class="tx"><div class="nm">对话演练 <span class="pill">' + DLGS.length + " 段</span></div>" +
    '<div class="ds">整段来回走一遍：对方的话自动播，轮到你先自己说</div></span></button>';
  h += mode("", "mic", "秒答", "看中文，自己出声说，再翻答案对一遍。走路上也能练", "sayit");
  h += mode("w", "sound", "听懂对方", "只放声音不给字，听对方那句是什么意思", "listen");
  h += mode("", "slot", "模板填空", "给你模板和要表达的意思，选对的词填进空里", "fill");
  h += mode("b", "repeat", "复习到期的", "按遗忘曲线挑，答对推远，答错拉近", "review", due ? due + " 条到期" : "暂时没有");
  h += mode("", "pen", "中译英", "看中文说英文，四选一，客观判分", "quiz");
  h += mode("w", "blocks", "连词成句", "打乱的单词按顺序点回去，练语序", "build");
  h += mode("", "blocks", "跟读打分", "对着麦克风念，逐词比对给分（微信里不支持，用 Safari 开）", "shadow");
  h += mode("b", "yinyang", "专业单词", "易经文化行业词，中英互测", "word");
  h += "</div>";
  h += '<div class="sec"><span class="t">练哪些</span><span class="l"></span></div>';
  h += '<button class="mrow" data-go="drill-run" data-arg="quiz:fav"><span class="ib">' + ic("star", "sm") + "</span>" +
    '<span class="tx"><div class="nm">只练收藏</div><div class="ds">你标星的模板、句子和单词</div></span>' +
    '<span class="vl">' + favN + " 条</span></button>";
  GROUPS.forEach(g => {
    const n = LINES.filter(l => l.group === g.id).length;
    h += '<button class="mrow" data-go="drill-run" data-arg="quiz:g-' + g.id + '"><span class="ib">' + ic(g.icon, "sm") + "</span>" +
      '<span class="tx"><div class="nm">' + esc(g.name) + '</div><div class="ds">' + esc(g.desc) + "</div></span>" +
      '<span class="vl">' + n + " 句</span></button>";
  });
  box.innerHTML = h;
};
function mode(cls, icon, nm, ds, arg, tagv) {
  return '<button class="mode ' + cls + '" data-go="drill-run" data-arg="' + arg + '">' +
    '<span class="ib">' + ic(icon, "lg") + "</span>" +
    '<span class="tx"><div class="nm">' + nm + (tagv ? ' <span class="pill">' + tagv + "</span>" : "") +
    '</div><div class="ds">' + ds + "</div></span></button>";
}

/* --- 出题池 --- */
function poolOf(arg) {
  const [mode, scope] = String(arg).split(":");
  let pool;
  if (mode === "listen") {
    pool = scope && scope.indexOf("g-") === 0
      ? REPLIES.filter(r => (SCENE_OF[r.key.slice(2).split("#")[0]] || {}).group === scope.slice(2)) : REPLIES;
    return { mode, pool };
  }
  if (mode === "sayit") {
    const base = scope && SCENE_OF[scope] ? LINES.filter(l => l.sid === scope)
      : scope && scope.indexOf("g-") === 0 ? LINES.filter(l => l.group === scope.slice(2))
      : LINES.concat(PATS.reduce((a, p) => a.concat(p.fills.map(f => ({
          en: p.pat.replace("{}", f[0]), zh: p.zh.replace("{}", f[1]),
          sname: p.from, key: p.key + ":" + f[0]
        }))), []));
    return { mode, pool: base };
  }
  if (mode === "fill") {
    pool = scope && SCENE_OF[scope] ? PATS.filter(p => p.sid === scope)
      : scope && scope.indexOf("g-") === 0 ? PATS.filter(p => p.group === scope.slice(2))
      : PATS;
    return { mode, pool };
  }
  if (mode === "review") pool = dueList();
  else if (mode === "word") pool = TERMS;
  else if (scope === "fav") pool = PATS.concat(LINES, TERMS).filter(x => FAV[x.key]);
  else if (scope && scope.indexOf("g-") === 0) pool = LINES.filter(l => l.group === scope.slice(2));
  else if (scope && SCENE_OF[scope]) pool = LINES.filter(l => l.sid === scope);
  else pool = LINES;
  return { mode, pool };
}

let Q = null;   // 当前一轮
PAGES["drill-run"] = function (box, arg) {
  const { mode, pool } = poolOf(arg);
  if (!pool.length) { box.innerHTML = '<div class="empty">这里还没有内容<br>先去场景里收藏几句，或等复习到期</div>'; setTitle("练习"); return; }
  const n = Math.min(CFG.qnum, pool.length);
  Q = { mode, arg, list: shuffle(pool).slice(0, n), i: 0, right: 0, box };
  setTitle({ review: "复习", quiz: "中译英", build: "连词成句", shadow: "跟读打分",
    word: "专业单词", fill: "模板填空", sayit: "秒答", listen: "听懂对方" }[mode] || "练习", "");
  step();
};
function step() {
  const b = Q.box;
  if (Q.i >= Q.list.length) return finish();
  const item = Q.list[Q.i];
  const isTerm = item.key.indexOf("T:") === 0;
  const isPat = item.key.indexOf("P:") === 0;
  const isReply = item.key.indexOf("R:") === 0;
  let m = Q.mode;
  if (m === "review") m = isPat ? "fill" : isTerm ? "word" : (Math.random() < 0.5 ? "quiz" : "build");
  if (isPat) m = "fill";                       // 模板只出填空题
  else if (m === "fill") m = isTerm ? "word" : "quiz";
  if (m === "word" && !isTerm) m = "quiz";
  if (m === "build" && isTerm) m = "word";
  if (m === "shadow" && isTerm) m = "word";

  const bar = '<div class="qbar"><div class="pg"><i style="width:' + (Q.i / Q.list.length * 100) + '%"></i></div>' +
    '<span class="nm">' + (Q.i + 1) + " / " + Q.list.length + "</span></div>";
  if (Q.mode === "sayit") return qSayIt(b, bar, item);
  if (Q.mode === "listen" || isReply) return qListen(b, bar, item);
  ({ quiz: qQuiz, build: qBuild, shadow: qShadow, word: qWord, fill: qFill })[m](b, bar, item);
}
function nextBtn(fn) {
  return '<div class="btnrow"><button class="btn main" id="nx">下一题' + ic("next") + "</button></div>";
}
function bindNext() { const n = document.getElementById("nx"); if (n) n.onclick = () => { Q.i++; step(); }; }
function answered(ok, key) {
  grade(key, ok); if (ok) Q.right++;
}



/* 秒答：看中文 → 自己出声说 → 翻答案对一遍。全程一根手指，微信里也能用 */
function qSayIt(b, bar, item) {
  b.innerHTML = bar +
    '<div class="qbox" style="min-height:150px">' +
      '<div class="qh">' + esc(item.sname || "") + " · 用英语怎么说</div>" +
      '<div class="qz" style="font-size:23px">' + esc(item.zh) + "</div>" +
    "</div>" +
    '<button class="btn main" id="flip" style="width:100%;padding:16px">' + ic("next") + "说完了，看答案</button>" +
    '<div class="fb" id="fb"></div>';
  b.querySelector("#flip").onclick = () => {
    if (b.dataset.done) return; b.dataset.done = 1;
    say(item.en);
    b.querySelector("#flip").style.display = "none";
    const fb = $("#fb");
    fb.className = "fb on ok";
    fb.innerHTML =
      '<div class="en" style="font-size:20px;text-align:center;margin:4px 0 10px">' + esc(item.en) + "</div>" +
      '<div class="btnrow" style="margin:0">' +
        '<button class="btn gh" data-say="' + esc(item.en) + '">' + ic("sound") + "再听</button>" +
        '<button class="btn gh" data-slow="' + esc(item.en) + '">' + ic("slow") + "慢速</button>" +
      "</div>" +
      '<div class="btnrow"><button class="btn gh" id="miss" style="color:var(--warm)">卡壳了</button>' +
        '<button class="btn main" id="got">说出来了</button></div>';
    document.getElementById("got").onclick = () => { answered(true, item.key); Q.i++; step(); };
    document.getElementById("miss").onclick = () => { answered(false, item.key); Q.i++; step(); };
  };
  delete b.dataset.done;
}

/* 听懂对方：只放声音不给字，选它是什么意思 */
function qListen(b, bar, item) {
  const wrongs = shuffle(REPLIES.filter(r => r.key !== item.key && r.zh !== item.zh)).slice(0, 3);
  const opts = shuffle([item].concat(wrongs));
  b.innerHTML = bar +
    '<div class="qbox" style="min-height:150px">' +
      '<div class="qh">' + esc(item.sname) + " · 对方回你这么一句</div>" +
      '<button class="mic" id="rep" style="width:76px;height:76px;margin:6px auto 4px">' + ic("sound") + "</button>" +
      '<div class="qh">点喇叭重听，先别看选项</div>' +
    "</div>" +
    '<div class="opts">' + opts.map((o, i) =>
      '<button class="opt" data-i="' + i + '">' + esc(o.zh) + "</button>").join("") + "</div>" +
    '<div class="fb" id="fb"></div>';
  setTimeout(() => say(item.en), 240);
  b.querySelector("#rep").onclick = () => say(item.en);
  b.querySelectorAll(".opt").forEach((el, i) => el.onclick = () => {
    if (b.dataset.done) return; b.dataset.done = 1;
    const ok = opts[i].key === item.key;
    b.querySelectorAll(".opt").forEach((x, j) => {
      if (opts[j].key === item.key) x.classList.add("right");
      else if (j === i) x.classList.add("wrong"); else x.classList.add("dim");
    });
    answered(ok, item.key);
    $("#fb").className = "fb on " + (ok ? "ok" : "no");
    $("#fb").innerHTML = '<div class="t">' + ic(ok ? "check" : "close", "sm") + (ok ? "听对了" : "它其实是说") + "</div>" +
      '<div class="en">' + esc(item.en) + '</div><div class="zh">' + esc(item.zh) + "</div>" +
      '<div class="zh" style="margin-top:8px;color:var(--ink3)">这是在你说完这句之后：<br>' +
        esc(item.ask) + " —— " + esc(item.askZh) + "</div>" +
      '<div class="btnrow" style="margin-top:10px"><button class="btn gh" data-slow="' + esc(item.en) + '">' +
        ic("slow") + "慢速再听</button></div>" + nextBtn();
    bindNext();
  });
  delete b.dataset.done;
}

/* 模板填空：给模板 + 要表达的意思，选正确的词填进空里 */
function qFill(b, bar, item) {
  const right = item.fills[Math.floor(Math.random() * item.fills.length)];
  const others = shuffle(PATS.filter(p => p.key !== item.key)
    .reduce((a, p) => a.concat(p.fills), [])
    .filter(f => f[0] !== right[0])).slice(0, 3);
  const opts = shuffle([right].concat(others));
  const [a, c] = splitPat(item.pat);
  b.innerHTML = bar +
    '<div class="qbox"><div class="qh">' + esc(item.from) + " · 把空填上</div>" +
    '<div class="ppat">' + esc(a) + '<span class="slot empty" id="fslot">____</span>' + esc(c) + "</div>" +
    '<div class="qh" style="color:var(--acc);font-size:13px">要表达：' + esc(right[1]) + "</div></div>" +
    '<div class="opts">' + opts.map((o, i) =>
      '<button class="opt" data-i="' + i + '">' + esc(o[0]) + '<span class="zh">' + esc(o[1]) + "</span></button>").join("") + "</div>" +
    '<div class="fb" id="fb"></div>';
  say(item.pat.replace("{}", right[0]));
  b.querySelectorAll(".opt").forEach((el, i) => el.onclick = () => {
    if (b.dataset.done) return; b.dataset.done = 1;
    const ok = opts[i][0] === right[0];
    b.querySelectorAll(".opt").forEach((x, j) => {
      if (opts[j][0] === right[0]) x.classList.add("right");
      else if (j === i) x.classList.add("wrong"); else x.classList.add("dim");
    });
    const sl = b.querySelector("#fslot");
    sl.textContent = right[0]; sl.classList.remove("empty"); sl.classList.add("filled");
    answered(ok, item.key);
    say(item.pat.replace("{}", right[0]));
    $("#fb").className = "fb on " + (ok ? "ok" : "no");
    $("#fb").innerHTML = '<div class="t">' + ic(ok ? "check" : "close", "sm") + (ok ? "对了" : "正确答案") + "</div>" +
      '<div class="en">' + esc(item.pat.replace("{}", right[0])) + "</div>" +
      '<div class="zh">' + esc(item.zh.replace("{}", right[1])) + "</div>" +
      (item.use ? '<div class="zh" style="margin-top:6px;color:var(--ink3)">' + esc(item.use) + "</div>" : "") +
      nextBtn();
    bindNext();
  });
  delete b.dataset.done;
}

/* 中译英 4 选 1 */
function qQuiz(b, bar, item) {
  const wrongs = shuffle(LINES.filter(l => l.key !== item.key && l.en !== item.en)).slice(0, 3);
  const opts = shuffle([item].concat(wrongs));
  b.innerHTML = bar +
    '<div class="qbox"><div class="qh">' + esc(item.sname) + " · 用英语怎么说</div>" +
    '<div class="qz">' + esc(item.zh) + "</div></div>" +
    '<div class="opts">' + opts.map((o, i) =>
      '<button class="opt" data-i="' + i + '">' + esc(o.en) + "</button>").join("") + "</div>" +
    '<div class="fb" id="fb"></div>';
  b.querySelectorAll(".opt").forEach((el, i) => el.onclick = () => {
    if (b.dataset.done) return; b.dataset.done = 1;
    const ok = opts[i].key === item.key;
    b.querySelectorAll(".opt").forEach((x, j) => {
      if (opts[j].key === item.key) x.classList.add("right");
      else if (j === i) x.classList.add("wrong"); else x.classList.add("dim");
    });
    answered(ok, item.key);
    say(item.en);
    $("#fb").className = "fb on " + (ok ? "ok" : "no");
    $("#fb").innerHTML = '<div class="t">' + ic(ok ? "check" : "close", "sm") + (ok ? "对了" : "正确答案") + "</div>" +
      '<div class="en">' + esc(item.en) + '</div><div class="zh">' + esc(item.tip) + "</div>" +
      nextBtn();
    bindNext();
  });
  delete b.dataset.done;
}

/* 连词成句 */
function qBuild(b, bar, item) {
  const words = item.en.split(/\s+/);
  const pool = shuffle(words.map((w, i) => ({ w, i })));
  b.innerHTML = bar +
    '<div class="qbox"><div class="qh">' + esc(item.sname) + " · 拼出这句话</div>" +
    '<div class="qz" style="font-size:16px">' + esc(item.zh) + "</div></div>" +
    '<div class="ansbox" id="ans"></div>' +
    '<div class="chips" id="chips">' + pool.map((p, i) =>
      '<button class="chip" data-p="' + i + '">' + esc(p.w) + "</button>").join("") + "</div>" +
    '<div class="btnrow"><button class="btn gh" id="undo">' + ic("back") + '退一个</button>' +
    '<button class="btn main" id="chk">检查</button></div>' +
    '<div class="fb" id="fb"></div>';
  const picked = [];
  const ans = b.querySelector("#ans");
  const paint = () => ans.innerHTML = picked.map(p => '<span class="chip">' + esc(pool[p].w) + "</span>").join("");
  b.querySelectorAll(".chip[data-p]").forEach((el, i) => el.onclick = () => {
    if (el.classList.contains("used")) return;
    el.classList.add("used"); picked.push(i); paint();
  });
  b.querySelector("#undo").onclick = () => {
    const p = picked.pop(); if (p === undefined) return;
    b.querySelectorAll(".chip[data-p]")[p].classList.remove("used"); paint();
  };
  b.querySelector("#chk").onclick = () => {
    if (b.dataset.done) return;
    const got = picked.map(p => pool[p].w).join(" ");
    const ok = got === item.en;
    if (!ok && picked.length < words.length) return toast("还有词没用上");
    b.dataset.done = 1;
    answered(ok, item.key); say(item.en);
    ans.style.borderColor = ok ? "var(--acc)" : "var(--red)";
    $("#fb").className = "fb on " + (ok ? "ok" : "no");
    $("#fb").innerHTML = '<div class="t">' + ic(ok ? "check" : "close", "sm") + (ok ? "完全正确" : "正确语序是") + "</div>" +
      '<div class="en">' + esc(item.en) + '</div><div class="zh">' + esc(item.zh) + "</div>" +
      nextBtn();
    bindNext();
  };
  delete b.dataset.done;
}

/* 专业单词：中英互测 */
function qWord(b, bar, item) {
  const isTerm = item.key.indexOf("T:") === 0;
  const src = isTerm ? TERMS : LINES;
  const en2zh = Math.random() < 0.5;
  const wrongs = shuffle(src.filter(x => x.key !== item.key)).slice(0, 3);
  const opts = shuffle([item].concat(wrongs));
  const qt = isTerm ? (en2zh ? item.en : item.zh) : (en2zh ? item.en : item.zh);
  b.innerHTML = bar +
    '<div class="qbox"><div class="qh">' + (isTerm ? esc(item.tname) : esc(item.sname)) + " · " + (en2zh ? "什么意思" : "英语怎么说") + "</div>" +
    '<div class="qz">' + esc(qt) + "</div></div>" +
    '<div class="opts">' + opts.map((o, i) =>
      '<button class="opt" data-i="' + i + '">' + esc(en2zh ? o.zh : o.en) + "</button>").join("") + "</div>" +
    '<div class="fb" id="fb"></div>';
  if (en2zh) say(item.en);
  b.querySelectorAll(".opt").forEach((el, i) => el.onclick = () => {
    if (b.dataset.done) return; b.dataset.done = 1;
    const ok = opts[i].key === item.key;
    b.querySelectorAll(".opt").forEach((x, j) => {
      if (opts[j].key === item.key) x.classList.add("right");
      else if (j === i) x.classList.add("wrong"); else x.classList.add("dim");
    });
    answered(ok, item.key); say(item.en);
    $("#fb").className = "fb on " + (ok ? "ok" : "no");
    $("#fb").innerHTML = '<div class="t">' + ic(ok ? "check" : "close", "sm") + (ok ? "对了" : "正确答案") + "</div>" +
      '<div class="en">' + esc(item.en) + " — " + esc(item.zh) + "</div>" +
      '<div class="zh">' + esc(item.def || item.tip) + "</div>" +
      (item.note ? '<div class="zh" style="margin-top:5px">' + esc(item.note) + "</div>" : "") +
      nextBtn();
    bindNext();
  });
  delete b.dataset.done;
}

/* 跟读打分 */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9'\s]/g, " ").replace(/\s+/g, " ").trim(); }
function lcsMark(target, heard) {
  const a = norm(target).split(" "), b = norm(heard).split(" ");
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const hit = new Array(a.length).fill(false);
  let i = a.length, j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { hit[i - 1] = true; i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--; else j--;
  }
  const score = a.length ? Math.round(dp[a.length][b.length] / a.length * 100) : 0;
  return { score, hit, words: target.split(/\s+/) };
}
function qShadow(b, bar, item) {
  b.innerHTML = bar +
    '<div class="qbox"><div class="qh">' + esc(item.sname) + " · 念这一句</div>" +
    '<div class="qz">' + esc(item.en) + "</div>" +
    '<div class="qh" style="color:var(--ink2)">' + esc(item.zh) + "</div></div>" +
    '<div class="btnrow" style="margin:0 0 4px"><button class="btn gh" data-say="' + esc(item.en) + '">' + ic("sound") + "听一遍</button>" +
    '<button class="btn gh" data-slow="' + esc(item.en) + '">' + ic("slow") + "慢速</button></div>" +
    '<button class="mic" id="mic">' + ic("mic") + "</button>" +
    '<div class="qh" id="mst" style="text-align:center">点麦克风，念完自动判分</div>' +
    '<div class="fb" id="fb"></div>';
  const mic = b.querySelector("#mic"), mst = b.querySelector("#mst");
  if (!SR) {
    mic.classList.add("busy"); mic.innerHTML = ic("mic");
    mst.innerHTML = "这个浏览器不支持语音识别<br>用 Chrome 或 Safari 打开可自动打分。<br>现在改成自评：念一遍，选下面。";
    b.querySelector("#fb").className = "fb on ok";
    b.querySelector("#fb").innerHTML = '<div class="btnrow" style="margin:0">' +
      '<button class="btn gh" id="bad">不太顺</button><button class="btn main" id="good">念顺了</button></div>';
    b.querySelector("#good").onclick = () => { answered(true, item.key); Q.i++; step(); };
    b.querySelector("#bad").onclick = () => { answered(false, item.key); say(item.en); setTimeout(() => { Q.i++; step(); }, 1400); };
    return;
  }
  let rec = null, done = false;
  mic.onclick = () => {
    if (done) return;
    if (rec) { try { rec.stop(); } catch (e) {} return; }
    rec = new SR(); rec.lang = "en-US"; rec.interimResults = false; rec.maxAlternatives = 3;
    mic.classList.add("rec"); mic.innerHTML = ic("stop"); mst.textContent = "在听…… 念完点一下停止";
    rec.onresult = ev => {
      let best = "", bs = -1;
      for (let i = 0; i < ev.results[0].length; i++) {
        const alt = ev.results[0][i].transcript;
        const s = lcsMark(item.en, alt).score;
        if (s > bs) { bs = s; best = alt; }
      }
      finishShadow(best);
    };
    rec.onerror = ev => {
      mic.classList.remove("rec"); mic.innerHTML = ic("mic"); rec = null;
      mst.textContent = ev.error === "not-allowed" ? "麦克风被拒绝了，去浏览器设置里允许" : "没听清，再试一次";
    };
    rec.onend = () => { mic.classList.remove("rec"); mic.innerHTML = ic("mic"); rec = null; };
    try { rec.start(); } catch (e) { mst.textContent = "启动失败，再点一次"; rec = null; }
  };
  function finishShadow(heard) {
    done = true;
    const r = lcsMark(item.en, heard);
    const ok = r.score >= 70;
    answered(ok, item.key);
    mst.textContent = "";
    const marked = r.words.map((w, i) => '<span class="' + (r.hit[i] ? "g" : "m") + '">' + esc(w) + "</span>").join(" ");
    $("#fb").className = "fb on " + (ok ? "ok" : "no");
    $("#fb").innerHTML =
      '<div class="score" style="color:' + (ok ? "var(--acc)" : "var(--warm)") + '">' + r.score +
      "<small>分 · " + (r.score >= 90 ? "很地道" : r.score >= 70 ? "能听懂" : "再来一遍") + "</small></div>" +
      '<div class="heard">' + marked + "</div>" +
      '<div class="zh" style="text-align:center;margin-top:8px;color:var(--ink3);font-size:12px">识别到：' + esc(heard) + "</div>" +
      '<div class="btnrow"><button class="btn gh" id="again">再念一次</button>' +
      '<button class="btn main" id="nx">下一句' + ic("next") + "</button></div>";
    bindNext();
    document.getElementById("again").onclick = () => { done = false; step(); };
  }
}

/* 结算 */
function finish() {
  const pct = Math.round(Q.right / Q.list.length * 100);
  const b = Q.box;
  b.innerHTML = '<div class="qbox" style="min-height:200px">' +
    '<div class="score" style="color:var(--acc)">' + pct + '<small>分 · 答对 ' + Q.right + " / " + Q.list.length + "</small></div>" +
    '<div class="qh" style="margin-top:10px">' +
    (pct >= 90 ? "这批可以放一放了，明天再复习" : pct >= 60 ? "还行，错的会自动排进复习" : "先回场景里多念两遍再来") +
    "</div></div>" +
    '<div class="btnrow"><button class="btn gh" data-tab="drill">换一种练</button>' +
    '<button class="btn main" id="rep">' + ic("repeat") + "再来一轮</button></div>";
  b.querySelector("#rep").onclick = () => PAGES["drill-run"](b, Q.arg);
}

/* ========== 9. 我的 ========== */
PAGES.me = function (box) {
  setTitle("我的", "ME");
  const favLines = LINES.filter(l => FAV[l.key]), favTerms = TERMS.filter(t => FAV[t.key]),
    favPats = PATS.filter(p => FAV[p.key]);
  const d7 = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(Date.now() - i * DAY);
    const k = dt.getFullYear() + "-" + (dt.getMonth() + 1) + "-" + dt.getDate();
    d7.push((LOG[k] || {}).done || 0);
  }
  const total = Object.values(LOG).reduce((a, v) => a + v.done, 0);
  let h = '<div class="stats" style="margin-top:2px">' +
    '<div class="stat"><b>' + learnedCount() + "</b><span>已掌握</span></div>" +
    '<div class="stat"><b>' + total + "</b><span>累计答题</span></div>" +
    '<div class="stat"><b>' + dueList().length + "</b><span>待复习</span></div></div>";
  h += '<div class="sec"><span class="t">最近七天</span><span class="l"></span></div>' +
    '<div class="lcard" style="display:flex;align-items:flex-end;gap:6px;height:96px;padding:14px">' +
    d7.map((v, i) => {
      const mx = Math.max(4, ...d7);
      return '<div style="flex:1;text-align:center">' +
        '<div style="height:' + Math.round(v / mx * 56) + 'px;background:' + (i === 6 ? "var(--acc)" : "var(--card3)") +
        ';border-radius:5px;min-height:3px"></div>' +
        '<div style="font-size:10px;color:var(--ink3);margin-top:5px">' + (i === 6 ? "今天" : v) + "</div></div>";
    }).join("") + "</div>";

  h += '<div class="sec"><span class="t">收藏</span><span class="l"></span></div>';
  h += '<button class="mrow" data-go="favs"><span class="ib">' + ic("star", "sm") + '</span><span class="tx">' +
    '<div class="nm">我收藏的</div><div class="ds">模板、句子和专业词</div></span>' +
    '<span class="vl">' + (favPats.length + favLines.length + favTerms.length) + " 条</span></button>";
  h += '<button class="mrow" data-go="drill-run" data-arg="review"><span class="ib">' + ic("repeat", "sm") + '</span><span class="tx">' +
    '<div class="nm">复习到期的</div><div class="ds">按遗忘曲线排的</div></span>' +
    '<span class="vl">' + dueList().length + " 条</span></button>";

  h += '<div class="sec"><span class="t">设置</span><span class="l"></span></div>';
  h += swRow("slow", "slow", "默认慢速朗读", "点喇叭直接用慢速念");
  h += '<button class="mrow" id="qn"><span class="ib">' + ic("sliders", "sm") + '</span><span class="tx">' +
    '<div class="nm">每轮题量</div><div class="ds">点击切换 5 / 10 / 20</div></span>' +
    '<span class="vl">' + CFG.qnum + " 题</span></button>";
  const nAud = typeof AUDIO_MAP === "undefined" ? 0 : Object.keys(AUDIO_MAP).length;
  h += '<button class="mrow" data-go="soundcheck"><span class="ib">' + ic("sound", "sm") + '</span><span class="tx">' +
    '<div class="nm">发音自检</div><div class="ds">听不到声音？点这里测一下</div></span>' +
    '<span class="vl">' + nAud + " 条录音</span></button>";
  h += '<button class="mrow" id="clr"><span class="ib">' + ic("trash", "sm") + '</span><span class="tx">' +
    '<div class="nm">清空学习记录</div><div class="ds">收藏、进度、复习安排全部重置</div></span>' +
    '<span class="vl red">清空</span></button>';
  h += '<div class="empty" style="font-size:11.5px;padding:24px 10px 0">开口说 · 美式英语为主<br>' +
    PATS.length + " 句型模板 · " + LINES.length + " 例句 · " + SCENES.length + " 场景 · " + TERMS.length + " 专业词</div>";
  box.innerHTML = h;

  box.querySelectorAll("[data-sw]").forEach(el => el.onclick = () => {
    const k = el.dataset.sw; CFG[k] = !CFG[k]; save(KEY.cfg, CFG); render();
  });
  box.querySelector("#qn").onclick = () => {
    CFG.qnum = CFG.qnum === 5 ? 10 : CFG.qnum === 10 ? 20 : 5; save(KEY.cfg, CFG); render();
  };
  box.querySelector("#clr").onclick = () => {
    if (!confirm("确定清空全部学习记录？收藏和进度都会没有。")) return;
    SRS = {}; FAV = {}; LOG = {};
    save(KEY.srs, SRS); save(KEY.fav, FAV); save(KEY.log, LOG);
    toast("已清空"); render();
  };
};

PAGES.soundcheck = function (box, arg) {
  setTitle("发音自检", "SOUND CHECK");
  const nAud = typeof AUDIO_MAP === "undefined" ? 0 : Object.keys(AUDIO_MAP).length;
  const demo = "Could I have some water, please?";
  const hasMp3 = !!audioFile(demo);
  const wx = /MicroMessenger/i.test(navigator.userAgent);
  box.innerHTML =
    '<div class="hero"><h3>' + ic("sound") + "点下面的按钮，应该能听到一句英文</h3>" +
    "<p>本站发音走的是预先录好的 mp3，不依赖手机的语音引擎，" +
    "所以在微信里打开也能出声。" + (wx ? "当前正是在微信里打开的。" : "") + "</p></div>" +
    '<div class="lcard" style="margin-top:14px"><div class="len">' + esc(demo) + "</div>" +
    '<div class="lzh">能给我一杯水吗？</div>' +
    '<div class="btnrow"><button class="btn main" id="t1">' + ic("sound") + "播放</button>" +
    '<button class="btn gh" id="t2">' + ic("slow") + "慢速</button></div></div>" +
    '<div class="sec"><span class="t">状态</span><span class="l"></span></div>' +
    '<div class="mrow" style="cursor:default"><span class="ib">' + ic("check", "sm") + '</span>' +
      '<span class="tx"><div class="nm">录音库</div><div class="ds">站内预合成的英文发音</div></span>' +
      '<span class="vl">' + nAud + " 条</span></div>" +
    '<div class="mrow" style="cursor:default"><span class="ib">' + ic(hasMp3 ? "check" : "close", "sm") + '</span>' +
      '<span class="tx"><div class="nm">这句用哪个通道</div><div class="ds">' +
      (hasMp3 ? "预合成 mp3（微信可用）" : "系统语音合成（微信里可能没声音）") + "</div></span>" +
      '<span class="vl' + (hasMp3 ? "" : " red") + '">' + (hasMp3 ? "mp3" : "TTS") + "</span></div>" +
    '<div class="mrow" style="cursor:default"><span class="ib">' + ic("sliders", "sm") + '</span>' +
      '<span class="tx"><div class="nm">系统语音兜底</div><div class="ds">' +
      (VOICE ? esc(VOICE.name) : window.speechSynthesis ? "有引擎但没挑到英文声音" : "本浏览器不支持") + "</div></span></div>" +
    '<div class="empty" style="font-size:12px;padding:22px 8px 0;text-align:left;line-height:2">' +
      "还是听不到？按顺序排查：<br>" +
      "1. 手机侧面的静音键关了吗（iPhone 静音时网页声音也没有）<br>" +
      "2. 音量调到一半以上<br>" +
      "3. 在微信里点右上角「···」→ 在浏览器中打开<br>" +
      "4. 换 Safari 或 Chrome 打开同一个网址</div>";
  box.querySelector("#t1").onclick = () => say(demo);
  box.querySelector("#t2").onclick = () => say(demo, true);
};

function swRow(k, icon, nm, ds) {
  return '<button class="mrow" data-sw="' + k + '"><span class="ib">' + ic(icon, "sm") + "</span>" +
    '<span class="tx"><div class="nm">' + nm + '</div><div class="ds">' + ds + "</div></span>" +
    '<span class="sw ' + (CFG[k] ? "on" : "") + '"></span></button>';
}
PAGES.favs = function (box) {
  setTitle("我的收藏", "FAVORITES");
  const ps = PATS.filter(p => FAV[p.key]), ls = LINES.filter(l => FAV[l.key]), ts = TERMS.filter(t => FAV[t.key]);
  if (!ps.length && !ls.length && !ts.length) { box.innerHTML = '<div class="empty">还没有收藏<br>在模板、句子或单词卡片上点星标就能收进来</div>'; return; }
  let h = "";
  if (ps.length) {
    h += '<div class="sec"><span class="t">句型模板</span><span class="l"></span><span class="n">' + ps.length + "</span></div>";
    ps.forEach(p => h += patCard(p, { from: true, fold: false }));
  }
  if (ls.length) { h += '<div class="sec"><span class="t">句子</span><span class="l"></span><span class="n">' + ls.length + "</span></div>"; ls.forEach((l, i) => h += lineCard(l, "f" + i)); }
  if (ts.length) { h += '<div class="sec"><span class="t">专业词</span><span class="l"></span><span class="n">' + ts.length + "</span></div>"; ts.forEach(t => h += termCard(t)); }
  h += '<div class="btnrow"><button class="btn main" data-go="drill-run" data-arg="quiz:fav">练收藏的' + ic("next") + "</button></div>";
  box.innerHTML = h;
};

/* ========== 10. 启动 ========== */
$("#back").onclick = back;
switchTab("home");

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  let reloaded = sessionStorage.getItem("spoken_reloaded");
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    sessionStorage.setItem("spoken_reloaded", "1");
    location.reload();
  });
}

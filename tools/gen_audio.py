#!/usr/bin/env python3
"""
把 data.js 里所有英文预合成 mp3，放进 audio/，并写出 audio/manifest.js。

为什么要预合成：微信内置浏览器（安卓 X5 / iOS WKWebView）基本不支持
speechSynthesis，点了没声音。魔法英语乐园踩过同一个坑，解法就是预合成 mp3。

用法：
    .venv/bin/python tools/gen_audio.py              # 增量：只补缺的
    .venv/bin/python tools/gen_audio.py --voice en-US-AriaNeural   # 换声音（全部重生成）
    .venv/bin/python tools/gen_audio.py --clean      # 顺便删掉内容里已经没有的旧音频

改了 data.js 之后必须重跑，否则新句子没有发音。
"""
import asyncio, json, os, sys, glob, hashlib, subprocess, re

DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(DIR, "audio")
VOICE_FILE = os.path.join(OUT, ".voice")

args = sys.argv[1:]
VOICE = "en-US-JennyNeural"          # 美式女声，跟魔法英语乐园同一把嗓子
if "--voice" in args: VOICE = args[args.index("--voice") + 1]
CLEAN = "--clean" in args
RATE = "-8%"                          # 稍慢一点，口语跟读更好跟
CONC = 8                              # 并发数

os.makedirs(OUT, exist_ok=True)

# 从唯一内容源里取全部英文：例句 + 模板×替换词组合出的完整句 + 专业术语和释义
node = r'''
const fs=require("fs"),vm=require("vm"),ctx={};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[1],"utf8"),ctx);
const out=vm.runInContext(`(function(){
  const s=new Set();
  SCENES.forEach(sc=>{
    sc.lines.forEach(l=>{ s.add(l.en); if(l.reply&&/[a-zA-Z]/.test(l.reply)) s.add(l.reply); if(l.alt) s.add(l.alt); });
    (sc.pat||[]).forEach(p=>p.fills.forEach(f=>s.add(p.pat.replace("{}",f[0]))));
  });
  PATTERNS.forEach(p=>p.fills.forEach(f=>s.add(p.pat.replace("{}",f[0]))));
  TERMSETS.forEach(t=>t.terms.forEach(x=>{ s.add(x.en); s.add(x.def); }));
  return [...s].filter(x=>x&&/[a-zA-Z]/.test(x)&&x!=="—");
})()`,ctx);
process.stdout.write(JSON.stringify(out));
'''
texts = json.loads(subprocess.check_output(["node", "-e", node, os.path.join(DIR, "data.js")], text=True))
# 「换个说法」里带中文注解的，只取括号前的英文
texts = [re.split(r"[（(]", t)[0].strip() for t in texts]
texts = sorted({t for t in texts if t and re.search(r"[a-zA-Z]", t)})

def fname(t):
    slug = re.sub(r"[^a-z0-9]+", "_", t.lower()).strip("_")[:40]
    return f"{slug}_{hashlib.md5(t.encode()).hexdigest()[:6]}.mp3"

prev = open(VOICE_FILE).read().strip() if os.path.exists(VOICE_FILE) else ""
if prev and prev != VOICE:
    for f in glob.glob(os.path.join(OUT, "*.mp3")): os.remove(f)
    print(f"声音由 [{prev}] 换成 [{VOICE}]，已清空旧音频")

MAP = {t: fname(t) for t in texts}
todo = [(t, f) for t, f in MAP.items() if not os.path.exists(os.path.join(OUT, f))]
print(f"声音 {VOICE} {RATE}｜文本 {len(texts)} 条｜待生成 {len(todo)} 条")

import edge_tts
fails = []
async def one(t, f, sem, i):
    async with sem:
        p = os.path.join(OUT, f)
        for attempt in range(3):
            try:
                await edge_tts.Communicate(t, VOICE, rate=RATE).save(p)
                if os.path.getsize(p) > 500:
                    if i % 50 == 0: print(f"  {i}/{len(todo)} …")
                    return
                os.remove(p)
            except Exception as e:
                if os.path.exists(p): os.remove(p)
                await asyncio.sleep(1 + attempt)
        fails.append(t)

async def main():
    sem = asyncio.Semaphore(CONC)
    await asyncio.gather(*[one(t, f, sem, i) for i, (t, f) in enumerate(todo)])

if todo:
    asyncio.run(main())
open(VOICE_FILE, "w").write(VOICE)

MAP = {t: f for t, f in MAP.items() if os.path.exists(os.path.join(OUT, f))}
if CLEAN:
    keep = set(MAP.values())
    for p in glob.glob(os.path.join(OUT, "*.mp3")):
        if os.path.basename(p) not in keep: os.remove(p)

with open(os.path.join(OUT, "manifest.js"), "w", encoding="utf-8") as fh:
    fh.write("/* 由 tools/gen_audio.py 生成，勿手改 */\nconst AUDIO_MAP = ")
    json.dump(MAP, fh, ensure_ascii=False, indent=0, sort_keys=True)
    fh.write(";\n")

size = sum(os.path.getsize(p) for p in glob.glob(os.path.join(OUT, "*.mp3")))
print(f"完成：{len(MAP)} 条音频，{size/1048576:.1f} MB" + (f"，失败 {len(fails)} 条" if fails else ""))
for t in fails[:10]: print("  失败:", t)
sys.exit(1 if fails else 0)

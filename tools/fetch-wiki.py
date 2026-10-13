# -*- coding: utf-8 -*-
"""从 zh.minecraft.wiki 抓原始 wikitext，提取与编辑器能力相关的技术性更改。

⚠️ 保留但当前不可用（留档，避免后人重复踩坑）：
   zh.minecraft.wiki 前面挂着 Cloudflare JS 挑战，纯 HTTP 客户端一律被拦：

     curl  → HTTP 403，响应体是 "Please wait" 挑战页
     本脚本(urllib) → HTTP 403
     官方 api.php / action=raw → 同样 403

   只有「真实浏览器」通道能过，例如本项目的 read_page（Firecrawl 云端浏览器），
   或 read_page 直接读 wiki 自己的 api.php：
     https://zh.minecraft.wiki/api.php?action=parse&page=数据包&section=11&prop=wikitext&format=json&formatversion=2

   实际取证流程见 README「数据来源与检索策略」。
   本脚本的逻辑（关键词过滤 + 日期提取）仍可用于任何允许脚本抓取的 MediaWiki 站点。
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request

PAGES = [
    ("1.0",    ["Java版1.0", "Java版1.0.0"]),
    ("1.4.2",  ["Java版1.4.2"]),
    ("1.8",    ["Java版1.8"]),
    ("1.12",   ["Java版1.12"]),
    ("1.13",   ["Java版1.13"]),
    ("1.19.4", ["Java版1.19.4"]),
    ("1.20.5", ["Java版1.20.5"]),
    ("1.21.2", ["Java版1.21.2"]),
    ("1.21.4", ["Java版1.21.4"]),
    ("1.21.5", ["Java版1.21.5"]),
    ("26.1",   ["Java版26.1", "Java版26.1.0"]),
]

KEYWORDS = [
    "命令", "NBT", "物品堆叠组件", "数据组件", "数据包", "函数", "选择器", "粒子",
    "扁平化", "命名空间", "标签", "刷怪蛋", "物品ID", "注册表", "语法", "execute",
    "give", "setblock", "summon", "data ", "mcfunction", "战利品表", "命令方块",
    "组件", "附魔", "物品栏", "ID", "资源包版本", "数据包版本", "协议版本",
]

UA = "Mozilla/5.0 (compatible; MCEditorDataBot/1.0; +local)"


def fetch(title):
    q = urllib.parse.urlencode({"title": title, "action": "raw"})
    url = "https://zh.minecraft.wiki/index.php?" + q
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.read().decode("utf-8", "replace")


def extract_date(text):
    pats = [
        r"\|\s*date\s*=\s*([^\n|}]+)",
        r"发布(?:时间|日期)\s*=\s*([^\n|}]+)",
        r"\|release\s*=\s*([^\n|}]+)",
        r"发布时间[：:]\s*([0-9]{4}年[0-9]{1,2}月[0-9]{1,2}日)",
    ]
    for p in pats:
        m = re.search(p, text)
        if m:
            return m.group(1).strip()
    m = re.search(r"(20\d{2}年\d{1,2}月\d{1,2}日)", text)
    return m.group(1) if m else ""


def extract_hits(text):
    hits = []
    seen = set()
    for line in text.split("\n"):
        s = line.strip()
        if len(s) < 8:
            continue
        if not s.startswith("*"):
            continue
        if not any(k in s for k in KEYWORDS):
            continue
        clean = re.sub(r"\{\{[^}]*\}\}", " ", s)
        clean = re.sub(r"\[\[([^\]|]*)\|([^\]]*)\]\]", r"\2", clean)
        clean = re.sub(r"\[\[([^\]]*)\]\]", r"\1", clean)
        clean = re.sub(r"'''?", "", clean)
        clean = re.sub(r"<[^>]+>", "", clean)
        clean = re.sub(r"\s+", " ", clean).strip(" *·-—")
        if len(clean) < 10:
            continue
        key = clean[:40]
        if key in seen:
            continue
        seen.add(key)
        hits.append(clean[:150])
        if len(hits) >= 9:
            break
    return hits


def main():
    out = []
    for label, titles in PAGES:
        got = None
        for t in titles:
            try:
                text = fetch(t)
                if "Wikipedia" not in text and len(text) > 400:
                    got = (t, text)
                    break
            except Exception as e:
                got = got or None
                sys.stderr.write("ERR %s: %s\n" % (t, e))
            time.sleep(0.4)
        if not got:
            out.append({"label": label, "error": "抓取失败"})
            continue
        title, text = got
        out.append({
            "label": label,
            "page": title,
            "url": "https://zh.minecraft.wiki/w/" + urllib.parse.quote(title),
            "bytes": len(text),
            "date": extract_date(text),
            "hits": extract_hits(text),
        })
        sys.stderr.write("OK %s (%s bytes, %d hits)\n" % (title, len(text), len(out[-1]["hits"])))
        time.sleep(0.4)
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()

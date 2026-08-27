#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_news.py —— AI0571 每日资讯自动抓取与页面数据改写脚本
==============================================================

工作流程：
  1. 从多个中文 AI 资讯 RSS 源抓取最新条目
  2. 清洗摘要（去 HTML 标签、去站点名前缀、截断到 60 字），时间统一转北京时间
  3. 按关键词自动分类打标签（热点 / 新模型 / 融资 / 行业动态）
  4. 按标题相似度去重、按时间倒序排序，头条卡 = 最新一条
  5. 直接改写 index.html 中的 NEWS / TIMELINE 数组（保持单文件自包含特性）
  6. 打印更新摘要

用法：
  python fetch_news.py

设计原则：
  - 容错：某个源失败自动跳过，不影响其它源
  - 兜底：全部源都失败时，不修改 index.html（保留旧数据）
  - 时效：默认只取 3 天内的新鲜资讯，不足时放宽到 14 天，避免旧闻混入
  - 幂等：重复运行结果一致（相同 feed 内容产生相同输出）
"""

import re
import sys
import json
import html as html_lib
import difflib
import datetime
from datetime import timezone, timedelta

import requests
import feedparser

# --------------------------------------------------------------------------
# 配置区
# --------------------------------------------------------------------------

# 北京时间
BEIJING_TZ = timezone(timedelta(hours=8))

# 每次写入 NEWS 的目标条数（原页面 16 条，保持“左右”；医药两个 Tab 各需保底，故增至 20）
TARGET_NEWS = 20
# 每次写入 TIMELINE 的目标条数（原页面 6 条）
TARGET_TIMELINE = 6
# 单个源最多贡献条数（防止某源刷屏，保证多源均衡；取 8 条使分类分布更均衡）
MAX_PER_SOURCE = 8
# 资讯时效窗口（小时）：默认 72h（3 天），不足目标条数时放宽到 336h（14 天）
FRESH_HOURS = 72
MAX_HOURS = 336

# RSS 源列表：
#   name     -> 站点名称（用于“来源”标注）
#   url      -> RSS/Atom 地址
#   ai_only  -> True 表示该源是 AI 垂直源，全部条目都算 AI 资讯；
#               False 表示综合科技源，需按关键词过滤 AI 相关条目
SOURCES = [
    # AI 垂直源：全部条目都算 AI 资讯
    {"name": "量子位",    "url": "https://www.qbitai.com/feed",          "ai_only": True},
    # 综合科技源：需按 AI 关键词过滤
    {"name": "雷锋网",    "url": "https://www.leiphone.com/feed",        "ai_only": False},
    {"name": "极客公园",  "url": "https://www.geekpark.net/rss",         "ai_only": False},
    {"name": "InfoQ 中文", "url": "https://www.infoq.cn/feed",           "ai_only": False},
    {"name": "IT之家",    "url": "https://www.ithome.com/rss/",          "ai_only": False},
    {"name": "爱范儿",    "url": "https://www.ifanr.com/feed",           "ai_only": False},
    {"name": "OSCHINA",   "url": "https://www.oschina.net/news/rss",     "ai_only": False},
    {"name": "钛媒体",    "url": "https://www.tmtpost.com/rss",          "ai_only": False},
    # 医药/设备 AI 专项源（今日头条搜索，国内可达，原文链接可直接打开；
    #  queries 为搜索词列表，逐个搜索后合并去重）
    {"name": "头条医药AI", "type": "toutiao",
     "queries": ["AI制药", "医药AI 大模型", "AI 药物研发"],
     "force_cat": "MEDPHARMA"},
    {"name": "头条设备AI", "type": "toutiao",
     "queries": ["医疗器械 人工智能", "手术机器人 AI", "医学影像 AI"],
     "force_cat": "MEDDEVICE"},
]

# 判定“是否属于 AI 资讯”的关键词（用于综合科技源过滤），分强弱两档：
#   AI_STRONG —— 强 AI 信号，命中 1 个即算 AI 资讯
#   AI_WEAK   —— 弱信号（如“模型/算力/芯片”），需同时命中 2 个才放行，
#                避免把“iPhone 芯片”这类纯硬件新闻放进来
# 泛化的公司名（微软/谷歌/华为等）不放进关键词，避免把与 AI 无关的新闻带进来。
AI_STRONG = [
    "人工智能", "大模型", "机器学习", "深度学习", "神经网络", "生成式",
    "多模态", "智能体", "自动驾驶", "机器人", "具身", "文生", "图生",
    "视频生成", "语音识别", "自然语言", "语义", "基础模型", "开源模型",
    "GPT", "Gemini", "Claude", "DeepSeek", "OpenAI", "Anthropic",
    "智谱", "讯飞", "豆包", "通义", "文心", "Kimi", "Llama", "Copilot",
    "Agent", "AIGC", "AGI", "Transformer", "Diffusion",
]
AI_WEAK = ["模型", "算力", "数据中心", "智算", "芯片", "编码", "推理", "训练", "算法"]
# 短英文词需词边界：前后不是英文字母/数字才命中（如 AIO 不命中 AI）
AI_BOUNDARY_RE = re.compile(r"(?i)(?<![a-z0-9])(ai|gpu|llm)(?![a-z0-9])")

# 分类关键词（按优先级从高到低匹配）
FUNDING_STRONG = [
    "融资", "收购", "投资", "募资", "并购", "增资", "配售",
    "轮融资", "融资完成", "拟收购", "亿元融资",
]
FUNDING_TITLE_ONLY = ["上市", "IPO", "拟上市", "递交招股书", "冲刺上市"]
MODEL_KEYWORDS = [
    "发布", "推出", "开源", "上线", "正式", "升级", "版本", "更新",
    "大模型", "模型", "多模态", "参数", "权重", "GPT", "Gemini", "Claude",
    "DeepSeek", "LLM", "智能体", "Agent", "生成", "编码", "训练",
]
INDUSTRY_KEYWORDS = [
    "行业", "政策", "监管", "市场", "报告", "预测", "销量",
    "营收", "利润", "合作", "落地", "生态", "标准", "峰会", "大会",
    "调查", "统计", "商用", "就业", "版权", "财报", "裁员",
    "竞争", "格局", "趋势", "白皮书",
]

# 医药行业 AI 关键词（优先级最高，命中即归入“医药AI”Tab）
MED_PHARMA_KEYWORDS = [
    "医药", "制药", "药物", "新药", "药品", "疫苗", "药企", "药厂",
    "临床", "医院", "诊疗", "病理", "靶点", "基因", "细胞", "抗体",
    "生物制药", "仿制药", "临床试验", "精准医疗", "肿瘤", "癌症",
    "GLP-1", "CRO", "医药研发", "大分子", "小分子", "蛋白", "DNA", "RNA",
    "中药", "医疗器械临床", "医学研究", "药物研发",
]

# 医疗设备/仪器 AI 关键词（命中即归入“设备AI”Tab）
MED_DEVICE_KEYWORDS = [
    "医疗器械", "医疗设备", "医学影像", "超声", "内镜", "手术机器人",
    "康复机器人", "监护仪", "IVD", "体外诊断", "检测仪器", "质谱",
    "色谱", "实验室自动化", "医疗硬件", "可穿戴医疗", "影像诊断",
    "核磁", "CT", "心电图", "血糖", "助听", "义肢", "脑机接口",
    "化验", "生化分析", "基因测序仪", "诊断设备", "医疗机器人",
    "智能医疗设备", "POCT",
]

# 抓取请求头与超时
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; AI0571-news-bot/1.0; +https://AI0571.com)"}
TIMEOUT = 15

# index.html 路径（与脚本同目录）
INDEX_PATH = "index.html"
# 前端轮询用数据文件（含更新时间戳 + 资讯数据，仅在内容变化时改写）
DATA_PATH = "data.json"


# --------------------------------------------------------------------------
# 工具函数
# --------------------------------------------------------------------------

def clean_html(text: str) -> str:
    """去掉 HTML 标签、反转义实体、合并空白。"""
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", "", text)          # 去标签
    text = html_lib.unescape(text)               # 反转义 &amp; &lt; 等
    text = text.replace("\u200b", "")            # 去零宽字符
    text = re.sub(r"\s+", " ", text).strip()     # 合并空白
    return text


def truncate(text: str, limit: int = 60) -> str:
    """截断摘要到 60 字（原页面摘要约 30-60 字）。"""
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip("，。；、") + "…"


def norm_title(title: str) -> str:
    """标题归一化：去空白与标点，用于相似度比较。"""
    return re.sub(r"[\W_]+", "", title.lower())


def is_similar(a: str, b: str, threshold: float = 0.66) -> bool:
    """判断两个标题是否相似（用于跨源去重）。"""
    na, nb = norm_title(a), norm_title(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    if na in nb or nb in na:
        return True
    return difflib.SequenceMatcher(None, na, nb).ratio() >= threshold


def is_ai_related(title: str, summary: str) -> bool:
    """
    综合源过滤：判定条目是否属于 AI 资讯。
      - 命中短英文词（AI/GPU/LLM，词边界）-> True
      - 命中 ≥1 个强信号 -> True
      - 命中 ≥2 个弱信号 -> True（如“芯片 + 算力”是 AI 芯片新闻）
      - 否则 False
    """
    blob = title + " " + summary
    if AI_BOUNDARY_RE.search(blob):
        return True
    low = blob.lower()
    strong = sum(1 for k in AI_STRONG if k.lower() in low)
    if strong >= 1:
        return True
    weak = sum(1 for k in AI_WEAK if k.lower() in low)
    return weak >= 2


def classify(title: str, summary: str) -> str:
    """
    按标题/摘要关键词分类（优先级从高到低）：
      医药AI / 设备AI（行业特征最明确，优先）
      融资/收购/投资/上市…
      发布/开源/模型…
      行业/政策/市场…
      默认 HOT
    """
    blob = title + " " + summary
    if any(k in blob for k in MED_PHARMA_KEYWORDS):
        return "MEDPHARMA"
    if any(k in blob for k in MED_DEVICE_KEYWORDS):
        return "MEDDEVICE"
    if any(k in blob for k in FUNDING_STRONG):
        return "FUNDING"
    if any(k in title for k in FUNDING_TITLE_ONLY):
        return "FUNDING"
    if any(k in blob for k in MODEL_KEYWORDS):
        return "MODEL"
    if any(k in blob for k in INDUSTRY_KEYWORDS):
        return "INDUSTRY"
    return "HOT"


def to_beijing(entry):
    """
    把 RSS 条目的发布时间转成北京时间。
    返回 (dt, iso, mmdd)：
      dt    -> 带时区的 datetime（用于时效过滤）
      iso   -> 'YYYY-MM-DDTHH:MM'  用于 NEWS.d
      mmdd  -> 'MM-DD HH:MM'       用于 TIMELINE
    无时间信息时使用当前北京时间兜底。
    """
    t = entry.get("published_parsed") or entry.get("updated_parsed")
    if t:
        dt = datetime.datetime(*t[:6], tzinfo=timezone.utc).astimezone(BEIJING_TZ)
    else:
        dt = datetime.datetime.now(BEIJING_TZ)
    iso = dt.strftime("%Y-%m-%dT%H:%M")
    mmdd = dt.strftime("%m-%d %H:%M")
    return dt, iso, mmdd


# --------------------------------------------------------------------------
# 抓取与解析
# --------------------------------------------------------------------------

def fetch_source(src: dict) -> list:
    """
    抓取单个源并解析为条目列表。
    支持两种类型：
      - 普通 RSS/Atom（url 字段）
      - toutiao：今日头条搜索（type='toutiao'，queries + force_cat 字段）
    任一步失败都抛异常，由调用方捕获跳过。
    """
    if src.get("type") == "toutiao":
        return fetch_toutiao(src)

    resp = requests.get(src["url"], headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    feed = feedparser.parse(resp.content)
    if not feed.entries:
        raise ValueError("feed 无条目")

    items = []
    for e in feed.entries:
        title = clean_html(e.get("title", "")).strip()
        if not title:
            continue

        summary = clean_html(e.get("summary", "") or e.get("description", ""))
        # 去掉摘要开头的站点名前缀，如 “IT之家 8 月 26 日消息，”
        summary = re.sub(r"^%s\s*" % re.escape(src["name"]), "", summary)
        summary = re.sub(r"^.{0,12}?月\s*\d+\s*日(消息|讯)[，:：]?\s*", "", summary)
        # 摘要为空或全是非中文（如图片 alt / 拼音垃圾）时，用标题兜底
        if not summary or not re.search(r"[\u4e00-\u9fff]", summary):
            summary = truncate(title, 50)
        summary = truncate(summary, 60)

        # 综合源：过滤非 AI 内容
        if not src["ai_only"] and not is_ai_related(title, summary):
            continue

        dt, iso, mmdd = to_beijing(e)
        now = datetime.datetime.now(BEIJING_TZ)
        age = max(0.0, (now - dt).total_seconds() / 3600.0)
        items.append({
            "title": title,
            "summary": summary,
            "iso": iso,          # 'YYYY-MM-DDTHH:MM' 北京时间
            "mmdd": mmdd,        # 'MM-DD HH:MM'
            "dt": dt,            # 带时区时间
            "age": age,          # 距今小时数
            "source": src["name"],
            "link": e.get("link", "").strip(),
            "c": classify(title, summary),
        })
    return items


def fetch_toutiao(src: dict) -> list:
    """
    今日头条搜索源（医药/设备 AI 专项）。
    从 so.toutiao.com 搜索页解码 HTML，提取标题 + group_id（构造原文链接）。
    国内网络可直接访问，原文链接直接可打开（解决 Google News 链接打不开的问题）。
    结果直接打上 src['force_cat'] 分类。
    """
    import urllib.parse as up
    queries = src.get("queries") or [src["query"]]
    times_pool = []
    items = []
    for q in queries:
        url = "https://so.toutiao.com/search?keyword=" + up.quote(q) + "&pd=information"
        resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        resp.raise_for_status()
        decoded = up.unquote(resp.text)
        if not times_pool:
            times_pool = re.findall(r'"publish_time":"(\d+)"', decoded)
        blocks = re.findall(
            r'<a href="([^"]*?)"[^>]*?class="[^"]*?l-card-title[^"]*?"[^>]*?>(.*?)</a>',
            decoded)
        for idx, (href, t) in enumerate(blocks):
            t = clean_html(t).strip()
            if not t:
                continue
            h2 = up.unquote(href)
            m = re.search(r'group/(\d+)/', h2)
            if not m:
                continue
            gid = m.group(1)
            # 时间：publish_time 序列按顺序近似配对（仅取合理范围）
            dt = datetime.datetime.now(BEIJING_TZ)
            if idx < len(times_pool) and times_pool[idx].isdigit():
                try:
                    ts = int(times_pool[idx])
                    if 1577808000 <= ts <= 2208988800:   # 2020-01-01 ~ 2039-12-31
                        dt = datetime.datetime.fromtimestamp(ts, tz=BEIJING_TZ)
                except (ValueError, OSError, OverflowError):
                    pass
            iso = dt.strftime("%Y-%m-%dT%H:%M")
            now = datetime.datetime.now(BEIJING_TZ)
            age = max(0.0, (now - dt).total_seconds() / 3600.0)
            items.append({
                "title": t,
                "summary": truncate(t, 60),
                "iso": iso,
                "mmdd": dt.strftime("%m-%d %H:%M"),
                "dt": dt,
                "age": age,
                "source": src["name"],
                "link": "https://www.toutiao.com/article/%s/" % gid,
                "c": src["force_cat"],
            })
    # 按链接去重 + 限制条数
    seen, out = set(), []
    for it in items:
        if it["link"] in seen:
            continue
        seen.add(it["link"])
        out.append(it)
    return out[:MAX_PER_SOURCE]


def filter_recent(items: list) -> list:
    """
    时效过滤：优先 3 天内，不足目标条数时放宽到 14 天。
    超过 14 天的旧闻一律丢弃，避免旧闻混入“每日资讯”。
    医药/设备 AI 内容量少，若 3 天内不足 3 条，额外放宽到 14 天保底。
    """
    fresh = [it for it in items if it["age"] <= FRESH_HOURS]
    if len(fresh) >= TARGET_NEWS:
        med_fresh = [it for it in fresh if it["c"] in ("MEDPHARMA", "MEDDEVICE")]
        if len(med_fresh) < 3:
            med_extra = [it for it in items
                         if FRESH_HOURS < it["age"] <= MAX_HOURS
                         and it["c"] in ("MEDPHARMA", "MEDDEVICE")]
            return fresh + med_extra
        return fresh
    recent = [it for it in items if it["age"] <= MAX_HOURS]
    return recent


def dedupe(items: list) -> list:
    """
    去重：
      1. 相同链接只保留一次
      2. 标题完全一致 / 高度相似（跨源转载）只保留一次
      3. 相似时保留发布时间更新的那条
    """
    seen_links = set()
    kept = []
    for it in sorted(items, key=lambda x: x["iso"], reverse=True):
        link = it["link"]
        if link and link in seen_links:
            continue
        if any(is_similar(it["title"], k["title"]) for k in kept):
            continue
        if link:
            seen_links.add(link)
        kept.append(it)
    return kept


# --------------------------------------------------------------------------
# 组装 NEWS / TIMELINE
# --------------------------------------------------------------------------

def build_news(items: list) -> list:
    """
    组装 NEWS 数组（保持原结构字段不变）：
      {c:'分类', d:'YYYY-MM-DDTHH:MM', t:'标题', s:'摘要（含来源标注）'}
    头条卡 = 时间最新的一条（渲染时取数组第一位）。
    其余条目在保证分类多样性前提下按时间倒序填充到 TARGET_NEWS 条。
    """
    items = sorted(items, key=lambda x: x["iso"], reverse=True)
    if not items:
        return []

    headline = items[0]                       # 头条卡：最新一条
    rest = items[1:]

    # 分类均衡：医药/设备两类各保底 3 条（内容少需保护），通用四类各 2 条，
    # 避免某分类刷屏、tab 无内容
    by_cat = {}
    for it in rest:
        by_cat.setdefault(it["c"], []).append(it)
    balanced = []
    for cat, cap in (("MEDPHARMA", 3), ("MEDDEVICE", 3),
                     ("MODEL", 2), ("FUNDING", 2), ("INDUSTRY", 2), ("HOT", 2)):
        balanced.extend(by_cat.get(cat, [])[:cap])
    # 剩余名额用最新条目补齐
    selected = balanced
    selected_ids = {id(x) for x in selected}
    for it in rest:
        if len(selected) >= TARGET_NEWS - 1:
            break
        if id(it) not in selected_ids:
            selected.append(it)
            selected_ids.add(id(it))

    news = [headline] + selected[: TARGET_NEWS - 1]
    return [make_entry(it) for it in news]


def build_timeline(items: list, n: int = TARGET_TIMELINE) -> list:
    """组装 TIMELINE 数组：取最新 n 条，格式 ['MM-DD HH:MM','标题']。"""
    items = sorted(items, key=lambda x: x["iso"], reverse=True)
    return [[it["mmdd"], truncate(it["title"], 80)] for it in items[:n]]


def make_entry(it: dict) -> dict:
    """把抓取条目映射为页面数据结构（保留原字段：c/d/t/s）。"""
    # 摘要末尾追加来源标注，满足转载版权要求
    summary = it["summary"]
    suffix = "（来源：%s）" % it["source"]
    if not summary.endswith(suffix):
        if summary:
            summary += suffix
        else:
            summary = suffix
    return {
        "c": it["c"],
        "d": it["iso"],
        "t": it["title"],
        "s": summary,
        "u": it.get("link", ""),   # 原文链接，供“阅读全文”跳转
    }


# --------------------------------------------------------------------------
# 改写 index.html
# --------------------------------------------------------------------------

def js_str(s: str) -> str:
    """把字符串转成单引号 JS 字面量（转义反斜杠与单引号）。"""
    return s.replace("\\", "\\\\").replace("'", "\\'")


def render_news(news: list) -> str:
    lines = ["  const NEWS = ["]
    for it in news:
        lines.append(
            "    {c:'%s', d:'%s', t:'%s', s:'%s', u:'%s'},"
            % (it["c"], js_str(it["d"]), js_str(it["t"]), js_str(it["s"]), js_str(it.get("u", "")))
        )
    lines.append("  ];")
    return "\n".join(lines)


def render_timeline(timeline: list) -> str:
    lines = ["  const TIMELINE = ["]
    for t, text in timeline:
        lines.append("    ['%s','%s']," % (js_str(t), js_str(text)))
    lines.append("  ];")
    return "\n".join(lines)


def rewrite_index(news: list, timeline: list) -> dict:
    """
    在 index.html 中：
      - 替换 NEWS / TIMELINE 数组
      - 更新徽标日期为今天（北京时间）
      - 更新 hero 统计 “今日更新” 数字
    返回改动统计。
    """
    with open(INDEX_PATH, "r", encoding="utf-8", newline="") as f:
        content = f.read()

    original = content
    stats = {"news_replaced": False, "timeline_replaced": False,
             "date_replaced": False, "count_replaced": False,
             "week_replaced": False, "content_changed": False}

    # 1) 替换 NEWS
    #    注意：匹配时把行首缩进一并吞掉，替换为标准 2 空格缩进，保证重复运行不漂移
    new_news_block = render_news(news)
    content, n_news = re.subn(
        r"^[ \t]*(?:const|let) NEWS = \[.*?\];", new_news_block, content, count=1,
        flags=re.M | re.S
    )
    stats["news_replaced"] = n_news > 0

    # 2) 替换 TIMELINE
    new_tl_block = render_timeline(timeline)
    content, n_tl = re.subn(
        r"^[ \t]*(?:const|let) TIMELINE = \[.*?\];", new_tl_block, content, count=1,
        flags=re.M | re.S
    )
    stats["timeline_replaced"] = n_tl > 0

    # 3) 更新徽标日期（北京时间今天）
    today = datetime.datetime.now(BEIJING_TZ).strftime("%Y-%m-%d")
    content, n_date = re.subn(
        r'(badge mono">)\d{4}-\d{2}-\d{2}( · 今日已更新)',
        r"\g<1>%s\g<2>" % today, content, count=1
    )
    stats["date_replaced"] = n_date > 0

    # 4) 更新 hero 今日更新条数
    content, n_cnt = re.subn(
        r'(id="statToday">)\d+(</span>)', r"\g<1>%d\g<2>" % len(news), content, count=1
    )
    stats["count_replaced"] = n_cnt > 0

    # 5) 更新 hero「本周新增」条数（本周一 00:00 至今的资讯数）
    now = datetime.datetime.now(BEIJING_TZ)
    monday = (now - datetime.timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0)
    week_start_iso = monday.strftime("%Y-%m-%dT%H:%M")
    week_new = sum(1 for it in news if it["d"] >= week_start_iso)
    content, n_week = re.subn(
        r'(id="statWeek">)\d+(</span>)', r"\g<1>%d\g<2>" % week_new, content, count=1
    )
    stats["week_replaced"] = n_week > 0

    changed = content != original
    stats["content_changed"] = changed
    if changed:
        with open(INDEX_PATH, "w", encoding="utf-8", newline="") as f:
            f.write(content)

    return stats


def write_data_json(news: list, timeline: list) -> None:
    """
    生成 data.json，供前端轮询检测更新。
    仅在内容有变化时调用（由调用方判断），避免产生无意义 commit。
    结构：{updated: 'YYYY-MM-DDTHH:MM:SS', news: [...], timeline: [...]}
    """
    payload = {
        "updated": datetime.datetime.now(BEIJING_TZ).strftime("%Y-%m-%dT%H:%M:%S"),
        "news": news,
        "timeline": timeline,
    }
    with open(DATA_PATH, "w", encoding="utf-8", newline="") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("AI0571 每日资讯自动更新")
    print("=" * 60)

    all_items = []
    ok_sources = []
    for src in SOURCES:
        try:
            items = fetch_source(src)
            # 每个源最多贡献 MAX_PER_SOURCE 条
            items = items[:MAX_PER_SOURCE]
            all_items.extend(items)
            ok_sources.append(src["name"])
            print("[OK]   %-10s 抓取 %d 条" % (src["name"], len(items)))
        except Exception as ex:
            print("[跳过] %-10s 失败：%s" % (src["name"], type(ex).__name__))

    if not all_items:
        print("\n[警告] 所有源均失败或无有效条目，保留 index.html 现有数据。")
        sys.exit(1)

    items = dedupe(all_items)
    items = filter_recent(items)
    print("\n去重 + 时效过滤后共 %d 条（来源：%s）" % (len(items), "、".join(ok_sources)))

    news = build_news(items)
    timeline = build_timeline(items)

    stats = rewrite_index(news, timeline)
    if not stats["news_replaced"] or not stats["timeline_replaced"]:
        print("\n[错误] 未能定位 index.html 中的 NEWS/TIMELINE 数组，文件未改写。")
        sys.exit(2)

    # 内容有变化时同步写 data.json；无变化保持旧文件（避免无效提交与部署）
    if stats["content_changed"]:
        write_data_json(news, timeline)
        print("  data.json 已同步写入 ✓")
    else:
        print("  data.json 内容无变化，未改写（避免无效提交）")

    print("\n更新摘要：")
    print("  抓取来源：%d 个（%s）" % (len(ok_sources), "、".join(ok_sources)))
    print("  抓取条目：%d 条（去重前）→ %d 条（去重+时效后）" % (len(all_items), len(items)))
    print("  写入 NEWS：%d 条" % len(news))
    print("  写入 TIMELINE：%d 条" % len(timeline))
    print("  分类分布：%s" % ", ".join(
        "%s=%d" % (c, sum(1 for it in news if it["c"] == c))
        for c in ("MEDPHARMA", "MEDDEVICE", "MODEL", "FUNDING", "INDUSTRY", "HOT")
    ))
    print("  徽标日期已更新为：%s" % datetime.datetime.now(BEIJING_TZ).strftime("%Y-%m-%d"))
    print("  index.html 改写完成 ✓")


if __name__ == "__main__":
    main()

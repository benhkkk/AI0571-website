#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_skills.py —— 抓取 GitHub 每周最热/最新的 AI Agent 技能包（Skills）榜单
================================================================================

数据来源：
  1. GitHub Search API（官方 skills / agent skills 相关仓库，按 stars 与 created 排序）
  2. 官方与知名 Skills 仓库白名单（保证榜单权威性，API 搜索不到也保留）

输出：
  - 改写 index.html 中的 SKILLS 数组（首屏直出）
  - 更新 data.json 的 skills 字段（供前端轮询自动更新）

设计原则：
  - 容错：单个 API 请求失败自动跳过；全部失败保留旧数据
  - 去重：按 full_name 合并白名单与搜索结果
  - 排名：按 star 数降序；最近 7 天内新建的仓库标记为「新」
  - 幂等：相同结果重复运行输出一致
"""

import os
import re
import sys
import json
import html as html_lib
import datetime
from datetime import timezone, timedelta

import requests

BEIJING_TZ = timezone(timedelta(hours=8))

# --------------------------------------------------------------------------
# 配置区
# --------------------------------------------------------------------------

# 榜单条数
TARGET_SKILLS = 10

# GitHub API Token（Actions 环境自动注入 GITHUB_TOKEN，本地可用个人令牌；未设置则匿名）
TOKEN = os.environ.get("GITHUB_TOKEN", "").strip()
HEADERS = {
    "User-Agent": "AI0571-skills-bot/1.0 (+https://AI0571.com)",
    "Accept": "application/vnd.github+json",
}
if TOKEN:
    HEADERS["Authorization"] = "token " + TOKEN
TIMEOUT = 15

# 官方与知名 Skills 仓库白名单（owner/repo）——保证权威仓库不被搜索漏掉
WHITELIST = [
    "anthropics/skills",        # Claude 官方技能包
    "openai/skills",            # OpenAI 技能包
    "google-gemini/skills",     # Gemini 官方技能
    "anthropics/claude-code",   # Claude Code
    "wshobson/agents",          # 知名 Multi-Agent 框架
]

# 搜索词（组合出"AI 技能包"语义的仓库）
SEARCH_QUERIES = [
    # 最热：按 star 排序
    {"q": "skills agent in:name,description", "sort": "stars", "order": "desc", "per_page": 25},
    {"q": "claude skills in:name,description", "sort": "stars", "order": "desc", "per_page": 25},
    # 最新：最近 7 天新建
    {"q": "agent skills in:name,description created:>%s" % (
        (datetime.datetime.now(BEIJING_TZ) - datetime.timedelta(days=7)).strftime("%Y-%m-%d")
    ), "sort": "created", "order": "desc", "per_page": 15},
]

# 最低 star 过滤（白名单不受限）
MIN_STARS = 50

INDEX_PATH = "index.html"
DATA_PATH = "data.json"


# --------------------------------------------------------------------------
# 工具函数
# --------------------------------------------------------------------------

def clean_text(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", "", text)
    text = html_lib.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def truncate(text: str, limit: int = 90) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip("，。；、") + "…"


def gh_api(url: str) -> dict:
    """调用 GitHub API，失败抛异常由调用方处理。"""
    resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def is_new(created_at: str) -> bool:
    """created_at 是否在最近 7 天内（标记「本周新发布」）。"""
    try:
        dt = datetime.datetime.fromisoformat(created_at.replace("Z", "+00:00")).astimezone(BEIJING_TZ)
        return (datetime.datetime.now(BEIJING_TZ) - dt).days <= 7
    except Exception:
        return False


# --------------------------------------------------------------------------
# 抓取
# --------------------------------------------------------------------------

def fetch_by_search() -> list:
    """通过 Search API 抓取，返回条目列表（失败跳过）。"""
    items = []
    for q in SEARCH_QUERIES:
        url = ("https://api.github.com/search/repositories?q=%s&sort=%s&order=%s&per_page=%d"
               % (q["q"].replace(" ", "+"), q["sort"], q["order"], q["per_page"]))
        try:
            data = gh_api(url)
            for repo in data.get("items", []):
                items.append({
                    "full_name": repo["full_name"],
                    "desc": truncate(clean_text(repo.get("description") or repo.get("name"))),
                    "stars": repo.get("stargazers_count", 0),
                    "url": repo.get("html_url", ""),
                    "created": repo.get("created_at", ""),
                })
            print("[OK]   搜索 '%s' 命中 %d 条" % (q["q"].split(" in:")[0][:30], len(data.get("items", []))))
        except Exception as ex:
            print("[跳过] 搜索 '%s' 失败：%s" % (q["q"][:30], type(ex).__name__))
    return items


def fetch_whitelist() -> list:
    """抓取白名单仓库信息（404 的自动跳过）。"""
    items = []
    for full in WHITELIST:
        try:
            repo = gh_api("https://api.github.com/repos/%s" % full)
            items.append({
                "full_name": repo["full_name"],
                "desc": truncate(clean_text(repo.get("description") or repo.get("name"))),
                "stars": repo.get("stargazers_count", 0),
                "url": repo.get("html_url", ""),
                "created": repo.get("created_at", ""),
            })
            print("[OK]   白名单 %s（★%d）" % (full, repo.get("stargazers_count", 0)))
        except Exception as ex:
            print("[跳过] 白名单 %s：%s" % (full, type(ex).__name__))
    return items


def build_skills():
    """
    合并白名单 + 搜索结果，去重、过滤、按 star 排序，返回榜单。
    若搜索全部失败（API 限额/网络问题），返回 None —— 调用方应保留旧数据。
    """
    whitelist = fetch_whitelist()
    whitelist_names = {it["full_name"] for it in whitelist}
    search_items = fetch_by_search()
    if not search_items:
        print("\n[警告] GitHub 搜索全部失败（可能触发 API 限额），本次不更新榜单，保留旧数据。")
        return None

    merged = {it["full_name"]: it for it in (whitelist + search_items)}
    # 排序：star 降序；白名单同星时优先
    ranked = sorted(merged.values(), key=lambda x: (-x["stars"], x["full_name"] not in whitelist_names))

    skills = []
    seen = set()
    for it in ranked:
        if it["full_name"] in seen:
            continue
        seen.add(it["full_name"])
        if it["stars"] < MIN_STARS and it["full_name"] not in whitelist_names:
            continue
        skills.append({
            "n": len(skills) + 1,
            "r": it["full_name"],
            "d": it["desc"],
            "s": it["stars"],
            "u": it["url"],
            "new": is_new(it["created"]),
        })
        if len(skills) >= TARGET_SKILLS:
            break
    return skills


# --------------------------------------------------------------------------
# 改写 index.html / data.json
# --------------------------------------------------------------------------

def js_str(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "\\'")


def render_skills(skills: list) -> str:
    lines = ["  const SKILLS = ["]
    for it in skills:
        lines.append(
            "    {n:%d, r:'%s', d:'%s', s:%d, u:'%s', new:%s},"
            % (it["n"], js_str(it["r"]), js_str(it["d"]), it["s"], js_str(it["u"]), "true" if it["new"] else "false")
        )
    lines.append("  ];")
    return "\n".join(lines)


def rewrite_index(skills: list) -> bool:
    """替换或插入 index.html 中的 SKILLS 数组，返回是否发生改动。"""
    with open(INDEX_PATH, "r", encoding="utf-8", newline="") as f:
        content = f.read()
    original = content
    block = render_skills(skills)

    content, n = re.subn(
        r"^[ \t]*const SKILLS = \[.*?\];", block, content, count=1, flags=re.M | re.S
    )
    if n == 0:
        # 首次插入：放到 TIMELINE 数组之后
        m = re.search(r"^[ \t]*const TIMELINE = \[.*?\];", content, flags=re.M | re.S)
        if not m:
            print("[错误] 未找到 TIMELINE 数组锚点，无法插入 SKILLS。")
            return False
        content = content[:m.end()] + "\n" + block + content[m.end():]

    # 更新 hero「Skill 榜单」数字
    content, n_sk = re.subn(
        r'(id="statSkills">)\d+(</span>)', r"\g<1>%d\g<2>" % len(skills), content, count=1
    )

    if content != original:
        with open(INDEX_PATH, "w", encoding="utf-8", newline="") as f:
            f.write(content)
        return True
    return False


def update_data_json(skills: list, changed: bool) -> None:
    """更新 data.json 的 skills 字段；changed=True 时刷新 updated 时间戳。"""
    payload = {"updated": None, "news": [], "timeline": [], "skills": []}
    if os.path.exists(DATA_PATH):
        try:
            with open(DATA_PATH, "r", encoding="utf-8") as f:
                payload.update(json.load(f))
        except Exception:
            pass
    payload["skills"] = skills
    if changed:
        payload["updated"] = datetime.datetime.now(BEIJING_TZ).strftime("%Y-%m-%dT%H:%M:%S")
    with open(DATA_PATH, "w", encoding="utf-8", newline="") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("AI0571 GitHub AI 技能包热榜抓取")
    print("=" * 60)

    skills = build_skills()
    if skills is None:
        print("保留现有榜单数据，退出（不产生提交）。")
        sys.exit(0)
    if not skills:
        print("\n[警告] 未抓到任何技能包数据，保留现有数据。")
        sys.exit(1)

    print("\n榜单（TOP %d）：" % len(skills))
    for it in skills:
        tag = " [本周新] " if it["new"] else "        "
        print("  %02d.%s %-40s ★%d" % (it["n"], tag, it["r"], it["s"]))

    index_changed = rewrite_index(skills)
    update_data_json(skills, changed=index_changed)
    print("\n%s" % ("index.html SKILLS 已更新 ✓ + data.json 已同步 ✓" if index_changed
                    else "榜单无变化，未改写文件（避免无效提交）"))


if __name__ == "__main__":
    main()

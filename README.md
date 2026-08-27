# AI0571.com · 资讯自动更新部署指南

> 本目录是一个**自包含的静态网站**（单文件 `index.html`，无构建步骤），配上一套
> 「每 10 分钟自动抓取 AI 资讯 → 改写页面数据 → 自动部署 → 前端轮询自动刷新」的免费自动化流水线。
>
> 全程 **零成本**：GitHub（免费）+ Cloudflare Pages（免费额度）。
> 全程需要你手动操作的部分只有下面 4 步，之后自动更新，无需再管。

---

## 这套系统是怎么工作的（30 秒看懂）

```
GitHub Actions 每 10 分钟定时触发（cron '*/10 * * * *'）
        │
        ▼
fetch_news.py 抓取 7 个中文 AI 资讯 RSS 源
（量子位 / 雷锋网 / 极客公园 / InfoQ / IT之家 / 爱范儿 / OSCHINA）
        │  清洗摘要、自动分类（热点/新模型/融资/行业动态）、跨源去重
        ▼
改写 index.html 的 NEWS（16 条）/ TIMELINE（6 条）数组
并同步生成 data.json（含更新时间戳 + 全部数据）
        │  仅在内容有变化时提交，避免无效 commit
        ▼
git commit + push 到 GitHub 仓库
        │
        ▼
Cloudflare Pages 检测到 push，自动重新部署
        │
        ▼
你打开着的网页里，前端 JS 每 5 分钟轮询 data.json，
发现更新时间戳变化 → 自动重渲染页面（无需手动刷新）
```

> 注意 1：**cron 时间用的是 UTC**，`*/10 * * * *` 表示每 10 分钟触发一次，
> 分钟间隔与时区无关，北京时间同样每 10 分钟一次。
> 注意 2：GitHub Actions 的定时触发官方不保证准时（高峰期可能延迟/跳过），
> 脚本已做容错：数据无变化不提交；若未来需要更严格的实时性，可迁移到
> Cloudflare Workers Cron + KV 方案。

---

## 第一步：把网站放到 GitHub

1. 注册一个 GitHub 账号：<https://github.com>（免费）
2. 登录后点右上角 **＋ → New repository** 新建仓库：
   - Repository name：随便起，例如 `ai0571`
   - Public / Private 都可以（Cloudflare Pages 免费套餐支持私有仓库）
   - 不要勾选 "Add a README"（避免和目录里的 README 冲突）
   - 点 **Create repository**
3. 把本目录（`ai0571-website`）里的**所有文件**上传到仓库：
   - 最简单的方式：在仓库页面点 **Add file → Upload files**，
     把 `index.html`、`fetch_news.py`、`requirements.txt`、`README.md`、
     `.github` 文件夹（整个拖进去）全部上传
   - 也可以在本机用 Git 命令推送（会 Git 的话）：
     ```bash
     cd ai0571-website
     git init
     git add .
     git commit -m "init"
     git branch -M main
     git remote add origin https://github.com/<你的用户名>/ai0571.git
     git push -u origin main
     ```

上传完成后，到仓库的 **Actions** 页面应该能看到名为 `daily-update` 的工作流。

---

## 第二步：用 Cloudflare Pages 部署网站

1. 注册 Cloudflare：<https://dash.cloudflare.com>（免费）
2. 左侧菜单 **Workers & Pages → Create → Pages → Connect to Git**
3. 按提示授权 GitHub（选刚建的仓库）
4. 构建配置保持默认即可（这是一个纯静态站，**不需要**任何构建命令）：
   - **Build command**：留空
   - **Build output directory**：填 `/`（站点根目录）
   - 点 **Save and Deploy**
5. 等 1-2 分钟，Cloudflare 会给出一个 `xxx.pages.dev` 的临时网址，
   打开确认网站正常显示。

---

## 第三步：绑定你的域名 AI0571.com

1. 在 Cloudflare Pages 项目页面 → **Custom domains → Add custom domain**，
   输入 `AI0571.com`，按提示继续（它会让你也加一个 `www` 的）
2. Cloudflare 会给你两条 DNS 记录让你添加，一般是：
   ```
   类型   名称    内容                   代理
   CNAME  www    <你的项目>.pages.dev    已代理（橙色云朵）
   ```
3. 去你的域名注册商（如果域名在**阿里云**，去阿里云控制台 → 域名 → 解析设置）：
   - 添加一条 **CNAME** 记录：
     - 主机记录：`www`
     - 记录值：`<你的项目>.pages.dev`
     - TTL：默认（10 分钟或自动）
   - 如果 Cloudflare 让你加根域名的记录，按它的提示操作即可
4. 回到 Cloudflare 等记录生效（几分钟到几小时不等），
   访问 <https://AI0571.com> 和 <https://www.AI0571.com> 验证。

> 💡 如果域名 DNS 已经在阿里云管理，Cloudflare 的 Pages 绑定流程会引导你
> 手动添加记录。只要 CNAME 指向 `xxx.pages.dev` 就能生效，不需要把 DNS
> 整体迁到 Cloudflare。

---

## 第四步：验证“自动更新”

1. 打开仓库 **Actions** 页面，能看到 `daily-update` 工作流
2. 点击工作流名称 → 右侧 **Run workflow** 按钮（手动触发一次，用于测试）→ 确认
3. 等约 1-2 分钟，工作流跑完
4. 回到仓库首页，刷新，点开 `index.html` 和 `data.json`，看资讯数据是否已更新
5. 再过 1-2 分钟，访问你的网站：打开着的页面**无需手动刷新**，
   前端每 5 分钟会自动轮询 `data.json` 并更新页面内容

此后工作流每 10 分钟自动触发一次（数据无变化时不会产生多余提交），无需任何手动操作。

---

## 常见问题

### 1. RSS 源失效了 / 想换更多源怎么办？
打开 `fetch_news.py` 顶部 `SOURCES` 列表，增删源即可：

```python
SOURCES = [
    {"name": "量子位",    "url": "https://www.qbitai.com/feed",          "ai_only": True},
    # ai_only=True 表示该源全是 AI 资讯，无需过滤
    {"name": "雷锋网",    "url": "https://www.leiphone.com/feed",        "ai_only": False},
    # ai_only=False 表示综合科技源，脚本会自动按关键词过滤出 AI 相关内容
]
```
改完在本地跑一次 `python fetch_news.py` 确认没问题，再提交推送到 GitHub。

### 2. 更新失败怎么排查？
- 打开仓库 **Actions** 页面 → 点失败的运行 → 看日志
- 常见原因：
  - 某个 RSS 源挂了 → 日志里会显示 `[跳过] xxx 失败`，脚本会自动跳过，不影响其它源
  - 所有源都失败 → 脚本会**保留旧数据**、不修改页面（这是刻意设计的容错）
  - 依赖没装上 → 检查日志里 `pip install` 那一步
- 手动修复后，点 **Run workflow** 重新跑一次即可

### 3. 时区问题
- 页面上的时间和“今日更新”徽标都是**北京时间**，脚本会自动把 RSS 里的
  时间统一换算成北京时间
- GitHub Actions 的定时是 UTC，但 `*/10 * * * *` 的**分钟间隔与时区无关**，
  北京时间同样每 10 分钟触发一次
- 如果你改了 `fetch_news.py` 里的 `BEIJING_TZ` 或工作流的 cron，注意换算

### 3.5 为什么 GitHub Actions 的定时不“准时”？
- GitHub 官方说明：schedule 触发可能延迟（高峰期 5-15 分钟甚至更久），
  极端情况可能跳过某一班——这不是脚本问题
- 脚本已做双重保障：数据无变化不提交、单源失败自动跳过、全源失败保留旧数据
- 若你需要**严格分钟级实时**，建议迁移到 Cloudflare Workers Cron + KV：
  由 Cloudflare 的定时器精确触发，前端轮询 API 接口

### 4. 为什么有些摘要很短/和标题一样？
部分源（如量子位）的 RSS 只提供很短的摘要，甚至没有摘要。
脚本做了兜底：摘要为空或乱码时用标题代替，保证卡片不空。属正常现象。

### 5. 私有仓库可以吗？
可以。Cloudflare Pages 免费套餐支持连接私有 GitHub 仓库。

### 6. 想改更新条数 / 分类规则？
都在 `fetch_news.py` 顶部的**配置区**：
- `TARGET_NEWS`（默认 16 条）、`TARGET_TIMELINE`（默认 6 条）
- `FUNDING_STRONG` / `MODEL_KEYWORDS` / `INDUSTRY_KEYWORDS` 分类关键词
- `AI_STRONG` / `AI_WEAK` 判断“是不是 AI 资讯”的关键词

---

## ⚠️ 版权提醒

本站资讯来自公开 RSS 源，**转载需保留来源**。脚本已自动在每条摘要末尾
加上来源标注，例如：`……（来源：量子位）`，并在页面底部保留版权信息。

如需让整张卡片可点击跳转原文，可在 `index.html` 的 `card` / `head`
渲染函数中，把 `阅读全文 →` 改为带链接的写法，例如：

```js
const card = n => `<article class="card">
  ...<a class="more" href="${n.u}" target="_blank" rel="noopener">阅读全文 →</a>
</article>`;
```

（前提是在 `fetch_news.py` 的 `make_entry()` 里给每条数据加上 `u` 字段存原文链接。）

---

## 目录结构

```
ai0571-website/
├── index.html                  # 网站本体（单文件，数据由脚本改写，含前端轮询）
├── data.json                   # 前端轮询用数据（更新时间戳 + 资讯/时间线/技能包榜单）
├── fetch_news.py               # 抓取 AI 资讯 RSS + 分类 + 去重 + 改写页面与 data.json
├── fetch_skills.py             # 抓取 GitHub 每周热 Skill 榜单（Search API + 白名单）
├── requirements.txt            # Python 依赖（requests, feedparser）
├── README.md                   # 本指南
└── .github/workflows/
    └── daily-update.yml        # 每 10 分钟自动运行的 GitHub Actions 工作流
```

## 每周热 Skill 板块说明

首页「每周热 Skill」板块展示 GitHub 上最热最新的 AI Agent 技能包仓库（周榜 TOP 10）：

- **数据来源**：GitHub Search API（`skills agent` / `claude skills` 等关键词，按 star 排名）
  + 官方知名技能包白名单（anthropics/skills、openai/skills 等）
- **排名**：按 star 数降序；最近 7 天新建的仓库标记「本周新」
- **更新频率**：随工作流每 10 分钟自动刷新（GitHub API 限额足够，无额外成本）
- **调整榜单**：改 `fetch_skills.py` 顶部的 `WHITELIST` / `SEARCH_QUERIES` / `TARGET_SKILLS` 即可
- **容错**：搜索失败时保留旧榜单，不会用空数据覆盖页面


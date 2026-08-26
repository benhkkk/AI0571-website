# AI0571.com · 每日自动更新部署指南

> 本目录是一个**自包含的静态网站**（单文件 `index.html`，无构建步骤），配上一套
> 「每日 08:00 自动抓取 AI 资讯 → 改写页面数据 → 自动部署」的免费自动化流水线。
>
> 全程 **零成本**：GitHub（免费）+ Cloudflare Pages（免费额度）。
> 全程需要你手动操作的部分只有下面 4 步，之后每天自动更新，无需再管。

---

## 这套系统是怎么工作的（30 秒看懂）

```
每天北京时间 08:00（GitHub Actions 定时触发）
        │
        ▼
fetch_news.py 抓取 7 个中文 AI 资讯 RSS 源
（量子位 / 雷锋网 / 极客公园 / InfoQ / IT之家 / 爱范儿 / OSCHINA）
        │  清洗摘要、自动分类（热点/新模型/融资/行业动态）、跨源去重
        ▼
直接改写 index.html 里的 NEWS（16 条）和 TIMELINE（6 条）数组
        │
        ▼
git commit + push 到 GitHub 仓库
        │
        ▼
Cloudflare Pages 检测到 push，自动重新部署 → 你的网站就更新了
```

> 注意：**cron 时间用的是 UTC**。北京时间 08:00 = UTC 00:00，
> 所以工作流里写的是 `'0 0 * * *'`，实际效果就是每天早上 8 点更新。

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

## 第四步：验证“每日自动更新”

1. 打开仓库 **Actions** 页面，能看到 `daily-update` 工作流
2. 点击工作流名称 → 右侧 **Run workflow** 按钮（手动触发一次，用于测试）→ 确认
3. 等约 1-2 分钟，工作流跑完
4. 回到仓库首页，刷新，点开 `index.html`，看里面的资讯数据是否变成了最新抓取的内容
5. 再过 1-2 分钟，访问你的网站，确认页面也更新了

以后每天北京时间 08:00 会自动执行一次，无需任何手动操作。

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
- GitHub Actions 的定时是 UTC，所以工作流里写 `'0 0 * * *'`（= 北京 08:00）
- 如果你改了 `fetch_news.py` 里的 `BEIJING_TZ` 或工作流的 cron，注意换算

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
├── index.html                  # 网站本体（单文件，数据由脚本改写）
├── fetch_news.py               # 抓取 + 分类 + 去重 + 改写页面数据
├── requirements.txt            # Python 依赖（requests, feedparser）
├── README.md                   # 本指南
└── .github/workflows/
    └── daily-update.yml        # 每天 08:00 自动运行的 GitHub Actions 工作流
```

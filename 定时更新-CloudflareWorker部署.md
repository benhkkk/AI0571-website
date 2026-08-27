# 定时更新-CloudflareWorker部署.md

## 为什么需要这个 Worker

实测发现 **GitHub Actions 的定时触发（schedule）不可靠**——官方声明可能延迟、高峰期甚至跳过，
我们验证中连续多个整点窗口均未触发。因此改用 **Cloudflare Workers 的 Cron Triggers** 作为
精确"闹钟"：每 10 分钟准时调用 GitHub API 触发一次工作流，其余链路（抓取 → 提交 →
Pages 自动部署 → 前端轮询）完全不变。

```
Cloudflare Worker（Cron */10，精确触发）
   → 调用 GitHub Actions API（workflow_dispatch）
   → Actions 跑 fetch_news.py + fetch_skills.py
   → git push → Cloudflare Pages 自动重新部署
   → 前端每 5 分钟轮询 data.json → 页面自动更新
```

全程免费（Workers 免费额度 + Actions 免费额度）。

---

## 部署步骤（约 5 分钟，需在 Cloudflare 控制台操作）

### 第 1 步：准备 GitHub 令牌（专用）

1. 打开 <https://github.com/settings/tokens> → **Generate new token (classic)**
2. Note 写 `AI0571 cron trigger`；Expiration 选 **No expiration**（Worker 长期使用）
3. **勾选两个权限**（必须）：
   - `repo`（整个勾上）
   - `workflow`
4. 生成后复制 `ghp_...` 开头的令牌，**先存到记事本**（只显示一次）
   > 若之前给过我的令牌已撤销，请重新生成；此令牌只放在 Cloudflare 的 Secrets 里，不会暴露。

### 第 2 步：创建 Worker

1. 打开 <https://dash.cloudflare.com> → 左侧 **Workers & Pages** → **Create** → **Worker**
2. 名称填：`ai0571-update-trigger` → **Deploy**
3. 部署后点 **Edit code**，把本目录的 `worker.js` 全部内容粘贴进去（替换模板）→ **Deploy**（右上角）

### 第 3 步：设置定时触发器（Cron）

1. Worker 页面 → **Settings** → **Triggers** → **Cron Triggers** → **Add Cron Trigger**
2. 填：`*/10 * * * *`（每 10 分钟一次，Cloudflare 精确调度）
3. **Save**

### 第 4 步：添加密钥（Secrets）

1. Worker 页面 → **Settings** → **Variables and Secrets** → **Add** → 选 **Secret**
2. 添加一条：
   - 名称：`GH_PAT`
   - 值：第 1 步复制的 `ghp_...` 令牌
3. **Deploy / Save**
   > 可选（不填用默认值）：`GH_OWNER`=benhkkk、`GH_REPO`=AI0571-website、`GH_WORKFLOW`=daily-update.yml

### 第 5 步：验证

1. 浏览器访问 Worker 域名（形如 `https://ai0571-update-trigger.<你的子域>.workers.dev/trigger`）
2. 页面显示 `GitHub trigger -> 204` 即成功（手动触发了一次）
3. 打开 GitHub 仓库 **Actions** 页面，应能看到刚触发的新运行
4. 等 1-2 分钟运行完成 → Pages 自动重新部署 → 网站数据更新

---

## 之后的效果

- 每 10 分钟，Cloudflare 定时器**准时**调用一次 → Actions 抓取 → 页面自动更新
- 若某次抓取无新数据，Actions 会跳过提交（避免刷 commit），属正常
- 页面开着时，前端每 5 分钟轮询 `data.json`，有新数据自动刷新（无需手动刷新浏览器）

## 故障排查

| 现象 | 排查 |
|---|---|
| `/trigger` 返回 missing GH_PAT | Secrets 没加对，检查名称是否为 `GH_PAT` |
| 返回 401/403 | 令牌权限不足，确认勾选了 repo + workflow |
| Actions 有运行但数据没变 | 无新数据（正常）；或看 Actions 日志 |
| Worker 有 cron 但没运行 | 检查 Triggers 页 Cron 是否保存成功 |

## 与原方案的差异

- ~~GitHub Actions schedule（不可靠，可能延迟/跳过）~~
- ✅ Cloudflare Worker Cron（精确每 10 分钟）+ 手动可触发

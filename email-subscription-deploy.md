# AI0571 邮件订阅 · 部署手册（Pages Functions 方案 · v2）

## 架构（最终版 v2）
站点由 **Cloudflare Pages** 托管，HTTP 后端用 **Pages Functions**（同域原生后端，零 Route 配置）：

```
订阅/退订/发信/诊断 全部走 Pages Functions（functions/api/*）
  ├─ POST /api/subscribe           公开：访客自助订阅（限流 + 临时邮箱黑名单）
  ├─ GET  /api/unsubscribe         公开：退订（两步确认，防邮件扫描器误退订）
  ├─ GET  /api/send-test           需 ADMIN_TOKEN：发一封测试邮件
  ├─ GET  /api/send-digest         需 ADMIN_TOKEN：单发/群发日报（当天幂等）
  ├─ GET  /api/cron-status         宽松鉴权：看 Worker cron 日志
  ├─ GET  /api/check-subscription  需 ADMIN_TOKEN：查邮箱是否已订阅
  ├─ GET  /api/subscriber-count    需 ADMIN_TOKEN：订阅者数量（脱敏）
  └─ GET  /api/cron-report         Worker 上报日志用（宽松鉴权）

自动发送日报（双保险，两条路都带「当天只发一次」幂等）：
  ├─ 保险A：GitHub Actions（daily-update.yml 4c 步骤）
  │    工作日 UTC 00:00~00:09（= 北京 08:00~08:09）调用 /api/send-digest?broadcast=1
  │    —— 推荐以这条为准：Actions 稳定（实测 100% success）
  └─ 保险B：Worker `ai0571-update-trigger` cron `0 0 * * 1-5`
        Worker 侧需 KV(SUBS) + Secret(RESEND_API_KEY) 绑定正常才生效
```

> KV（SUBS）在 Worker 与 Pages Functions 共用同一命名空间。KV 里除了订阅者邮箱，还存系统 key：`cron-log`（执行日志）、`rl:*`（限流）、`digest-sent:*`（群发幂等）——遍历订阅者时已统一排除。

---

## 第 1 步：Resend（发信服务）— 已完成
域名 `ai0571.com` 已在阿里云加好 DNS 验证记录，Resend 显示 Verified；API Key（`re_xxxx`）已生成。
> 免费版 $0/月，含 **3000 封/月 + 每日上限 100 封**。发件人统一 `noreply@ai0571.com`。

---

## 第 2 步：KV 命名空间 — 已完成
`ai0571-subscribers`，ID：`03d445998a424254978a56bdb98c5dc7`。

---

## 第 3 步：Pages 项目设置（必须确认）
进入 **Workers & Pages → 你的 Pages 项目（ai0571-website）→ Settings → Functions**：

| 变量 | 类型 | 值 | 状态 |
|---|---|---|---|
| `SUBS` | KV namespace binding | 选 `ai0571-subscribers` | ✅ 已绑 |
| `RESEND_API_KEY` | Secret | 你的 `re_xxxx` | ✅ 已配 |
| `ADMIN_TOKEN` | **新增 Secret/变量** | 一串随机长字符串（用于保护发信/查询端点） | ⬅️ **需你配置** |

`ADMIN_TOKEN` 建议生成方式（任选）：
- 用本手册同目录下 `worker.js` 无关；直接复制下面这串即可（也可自己改）：
  ```
  AI0571-UiQ7aTVw_xRvdHlRsBsBFbA7cMkRVZx6
  ```
- 或自己生成：浏览器打开 https://www.random.org/passwords/ 生成 32 位随机串

⚠️ **配好后**：`send-test`、`send-digest`、`subscriber-count`、`check-subscription` 都必须在 URL 里加 `&token=你的ADMIN_TOKEN` 才能用；`cron-status` 未配 token 前可直连（配了之后也要带 token）。

---

## 第 4 步：GitHub 仓库 Secrets（新增！）
让 Actions 能触发群发，需要把同一个 `ADMIN_TOKEN` 配到 GitHub：
1. GitHub 仓库 `benhkkk/AI0571-website` → **Settings → Secrets and variables → Actions**
2. **New repository secret**：
   - Name：`ADMIN_TOKEN`
   - Value：**与 Pages 项目里配置的完全相同**
3. 保存。

配好后，`daily-update.yml` 的「工作日早晨发送 AI 日报」步骤会自动在每个工作日北京 08:00 触发一次群发（Actions 每 5 分钟跑一次，幂等标记保证当天只发一次）。

---

## 第 5 步：前端 — 已完成
订阅表单已 `fetch('/api/subscribe')` 同域提交；轮询更新会保留你当前选中的 Tab。无需操作。

---

## 第 6 步：Worker（可选，保留为保险B）
`ai0571-update-trigger` 保留现状即可：Cron 触发 GitHub Actions 抓取 + 工作日尝试发日报。若 Worker 侧 KV/Secret 配置齐全则双保险都生效；若 Worker 状态异常也不影响（Actions 那条路会兜底）。

---

## 测试

### 1. 订阅自测（公开，无需 token）
首页填邮箱 → 点订阅 → 显示「已订阅 ✓ 每日早8点查收」。
- 重复订阅会提示「您已订阅过 ✓」（不再显示 8 点查收）
- 一次性邮箱（如 mailinator.com 等）会被拒绝

### 2. 发测试邮件（需 token）
```
https://www.AI0571.com/api/send-test?to=你的邮箱&token=你的ADMIN_TOKEN
```
- 返回 `{"ok":true,...}` → 邮箱立刻收到日报
- 返回 `unauthorized` → token 不对或没传
- 返回 `未配置 ADMIN_TOKEN` → 第 3 步 Pages 变量没配

### 3. 手动群发（需 token）
```
https://www.AI0571.com/api/send-digest?broadcast=1&token=你的ADMIN_TOKEN
```
- 当天已发过会返回 `{"skipped":true,...}`（幂等）
- 强制重发加 `&force=1`

### 4. 查订阅者（需 token）
```
https://www.AI0571.com/api/subscriber-count?token=你的ADMIN_TOKEN
https://www.AI0571.com/api/check-subscription?email=你的邮箱&token=你的ADMIN_TOKEN
```

### 5. 看 cron 日志
```
https://www.AI0571.com/api/cron-status
```
- 返回 `found:false` 且持续为空 → Worker 新版可能未部署成功，不影响 Actions 群发（看 Actions 运行日志确认）
- 返回 `found:true` → 看 `result` 里 `sent` / `error` / `kvBound`

### 6. 退订（公开）
邮件里「退订」链接 → 打开确认页 → 点「确认退订」→ 显示「已退订 ✓」。
> 改成两步确认是为了防止邮件安全扫描器自动 GET 退订链接导致你被误退订。

---

## 故障排查

| 现象 | 排查 |
|---|---|
| 订阅按钮一直「提交中…」 | 看是否线上测（非本地预览）；Pages Functions 是否已部署成功 |
| `/api/send-test` 返回整页 HTML | 请求落回 Pages 静态页，Functions 未生效 → 确认 `functions/api/` 存在且 Pages 重新部署 |
| `missing RESEND_API_KEY` | Pages 项目 Secret 名必须是 `RESEND_API_KEY` |
| `unauthorized` | `ADMIN_TOKEN` 没传或与 Pages 配置不一致 |
| 收不到邮件但 sent=1 | 查 Resend Logs / 垃圾箱；`noreply@ai0571.com` 域名已验证 |
| 工作日没自动发 | ① 打开 GitHub 仓库 Actions 页面，看「工作日早晨发送 AI 日报」步骤输出（是否命中发送窗口、curl 返回什么）② 确认仓库 Secret `ADMIN_TOKEN` 已配 ③ 确认 KV 里有订阅者（`subscriber-count`）|
| Actions 步骤返回 `unauthorized` | 仓库 Secrets 的 `ADMIN_TOKEN` 与 Pages 项目里不一致 |
| Actions 步骤返回 `skipped:true` | 当天已发过（正常，幂等生效） |
| `/api/cron-status` 一直为空 | Worker 新版可能没部署成功；不影响 Actions 群发链路 |

---

## ⚠️ 安全提醒
1. **之前截图暴露过 `RESEND_API_KEY`**：建议去 Resend Revoke 重新生成，并更新 Pages 的 `RESEND_API_KEY`。
2. `ADMIN_TOKEN` 相当于管理钥匙，**不要发到聊天里/截图**；两处（Pages + GitHub Secrets）保持一致。
3. 发信端点（send-test/send-digest）已加鉴权——未配置 token 前会拒绝服务，这是**有意为之**，防止被当成开放邮件中继滥用你的域名。

---

# v3 · 2026-09 静默故障修复与「30 秒自检」

## 这次为什么断（结论）
1. **GitHub Actions 从 2026-09-04 约 UTC 10:00 起，全部运行变成 `startup_failure`**（创建后 1 秒内失败、job 都没起来）。
   → 抓取（news update）和群发（调用 send-digest）**两条路都死了**，所以既没新资讯、也没邮件。
2. **原来的发送窗口只有 UTC 00:00~00:09 这 10 分钟**，GitHub 官方声明定时任务会延迟甚至跳过，
   窗口一旦错过当天就永久不发，且失败完全静默（curl 后面只 `echo ""`）。
3. **Worker 侧没绑 KV 也没有 ADMIN_TOKEN**，导致 `cron-log` 一直是空的（= 从没写过心跳），
   出问题后完全没有可观测的手段。

## v3 改动
| 文件 | 改动 |
|---|---|
| `.github/workflows/daily-update.yml` | ① 频率 `*/10` → `*/20`；② 发送窗口改为**北京时间 07:00~09:59**（每 20 分钟一次 ≈ 9 次机会，靠端点幂等去重，不会重复发）；③ 用 UTC+8 显式换算，不依赖 tzdata；④ 调用结果**检查 HTTP 状态码 + 返回体 `ok` 字段**，失败即 `::error::` 红叉（GitHub 会发失败邮件）；⑤ 末尾加了「失败处置指引」步骤 |
| `functions/api/send-digest.js` | ① 新增 `dry=1` 演练模式（不真发，只报告会给谁发）；② 每次调用（含被幂等跳过）都写 KV `digest-last` 留痕；③ 一封都没发出去时返回 **502** 而不是 200 |
| `functions/api/health.js`（新增） | 链路自检端点，见下 |
| `worker.js` | ① 去掉 10 分钟窄窗口，改为北京时间 07:00~10:00 宽窗口；② 发送通道双保险：A 直连 Resend（需 SUBS+RESEND_API_KEY），B 调 Pages `/api/send-digest`（只需 ADMIN_TOKEN），A 失败自动降级 B；③ 每次 cron 都写心跳（`cron-log`），优先 KV、没绑 KV 就 HTTP 上报 `/api/cron-report`；心跳里带 `env`（kvBound/resendKey/adminToken/ghPat）和 GitHub 触发结果 |
| `wrangler.toml` | cron 收敛为 `*/20 * * * *`；注释写清 Worker 侧必需的三个 Secret |

## 30 秒自检（出问题时第一件事）
浏览器打开（把 `你的ADMIN_TOKEN` 换成真 token，整条链接存书签）：

```
https://www.AI0571.com/api/health?ui=1&token=你的ADMIN_TOKEN
```

会看到一页中文「红绿灯」：站点/ADMIN_TOKEN/RESEND_API_KEY/KV/今日是否已发/订阅人数/
资讯新鲜度/Worker 心跳/GitHub Actions 最近一次结论，并且**直接写出每一颗红灯该怎么修**。
不需要 JSON：删掉 `ui=1` 就是 JSON 版。

判断口诀：
- **`GitHub Actions` 那颗是 ❌（startup_failure / failure）** → 整条自动链路挂了，去
  https://github.com/benhkkk/AI0571-website/actions 看，并检查 GitHub 是否停用了 Actions
  （Settings → Actions → General）以及**仓库 owner 邮箱**里有没有 GitHub 的通知邮件。
- **`Worker 心跳` 是 ❌ / 显示“无”** → Worker 没绑 KV、也没 ADMIN_TOKEN → 到 Cloudflare
  Worker Settings → Variables 加 `ADMIN_TOKEN`（值同 Pages），KV 绑 `SUBS`。
- 只有 **`今日日报已发出` 是 ❌**，其余全绿 → 手动补发：
  `https://www.AI0571.com/api/send-digest?broadcast=1&token=你的ADMIN_TOKEN`
  （先用 `&dry=1` 演练一次确认收件人数，再真发）。
- **`资讯新鲜度` > 24 小时** → 抓取链路断了（同第一条 Actions）。

## 部署后需要人工做的一次性动作
1. Cloudflare Worker `ai0571-update-trigger` → Settings → Variables：
   加 Secret `ADMIN_TOKEN`（与 Pages 同值）；建议同时加 `RESEND_API_KEY` 并把 KV `SUBS` 绑上。
   → 加完后 `Worker 心跳` 立刻变绿。
2. GitHub 仓库 Settings → Actions → General：确认 Actions 是启用状态、Workflow permissions 允许读写。
3. 若 GitHub 确实停用了 Actions，需按其邮件/站内提示处理（或改用付费/等待解除），
   期间可以用上面的手工补发链接兜底。

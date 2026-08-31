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

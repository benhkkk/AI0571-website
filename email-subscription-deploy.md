# AI0571 邮件订阅 · 部署手册（Pages Functions 方案）

## 架构（最终版）
站点由 **Cloudflare Pages** 托管，因此 HTTP 后端直接用 **Pages Functions**（Pages 原生同域后端，零 Route 配置）：

- 前端 `POST /api/subscribe` → **Pages Function** `functions/api/subscribe.js` → 写 **KV（SUBS）**
- 前端 `GET /api/unsubscribe?email=` → **Pages Function** `functions/api/unsubscribe.js` → 删 KV
- 调试 `GET /api/send-test?to=` → **Pages Function** `functions/api/send-test.js` → 调 Resend 发一封
- 手动 `GET /api/send-digest?to=` / `?broadcast=1&secret=` → 手动发日报（单发/群发）
- 诊断 `GET /api/cron-status` → 读取 Worker 最近一次 cron 执行日志
- **Worker `ai0571-update-trigger`** 只跑 Cron（不处理 HTTP）：
  - `*/10 * * * *` → 触发 GitHub Actions 抓取
  - `0 0 * * 1-5`（UTC，= 北京 08:00 工作日）→ 读 KV 订阅列表 + Resend 群发日报

> KV（SUBS）在 Worker 和 Pages Functions 两边**共用同一个命名空间**，所以前端订阅写入的邮箱，Worker 的定时发送能直接读到。

代码已就绪（均已上传 GitHub，Cloudflare 自动部署）：
- `functions/api/subscribe.js`、`functions/api/unsubscribe.js`、`functions/api/send-test.js`（新）
- `worker.js`（精简为仅 cron）
- `index.html`（订阅表单已改真实提交）
- `wrangler.toml`（KV id 已填、两个 cron 已配）

---

## 第 1 步：Resend（发信服务）— 已完成
域名 `ai0571.com` 已在阿里云加好 DNS 验证记录（DKIM TXT / rsend、send CNAME / _dmarc TXT），Resend 显示已 Verified；API Key（`re_xxxx`）已生成。
> 免费版 $0/月，含 **3000 封/月 + 每日上限 100 封**。对 100 人以内订阅量的小站点完全够用；若单日发送破 100 封需升 Pro（$20/月 ≈ ¥140）。发件人统一用 `noreply@ai0571.com`。

---

## 第 2 步：KV 命名空间 — 已完成
已在 Cloudflare 创建 `ai0571-subscribers`，ID：`03d445998a424254978a56bdb98c5dc7`。

---

## 第 3 步：Worker 设置（cron 用，已大部分完成）
进入 Cloudflare 控制台 → **Workers & Pages** → Worker `ai0571-update-trigger`：

| 项 | 状态 | 确认/操作 |
|---|---|---|
| 代码 | ✅ 自动部署 | 仓库 `worker.js` 已更新，Git 集成会自动重新部署，无需手动粘贴 |
| KV 绑定 `SUBS` | 需确认 | **Settings → Variables → KV namespace bindings** 里应有 `SUBS` → `ai0571-subscribers` |
| Secret `RESEND_API_KEY` | 需确认 | **Settings → Variables → Secrets** 里应有 `RESEND_API_KEY` |
| Secret `GH_PAT` | 需确认 | 原有抓取令牌，应仍存在 |
| Cron | ✅ | **Triggers → Cron Triggers** 应有 `*/10 * * * *` 和 `0 0 * * 1-5` |

> ⚠️ **不再需要 Worker Route**（之前 `/api/*` 落回 Pages 就是因为 Route 没配上 + Pages+独立 Worker Route 本身有坑）。HTTP 现由 Pages Functions 接管。

---

## 第 4 步：Pages 项目设置（关键新增步骤！）
站点由 Pages 托管，Functions 需要在 **Pages 项目**里单独绑 KV + Secret（Pages 和 Worker 是两套独立绑定）。

1. Cloudflare 控制台 → **Workers & Pages** → 找到你的 **Pages 项目**（带 `www.AI0571.com`、类型为 Pages，不是 `ai0571-update-trigger` 那个 Worker）→ 点进去。
2. 顶部标签 **Settings** → 左侧/页面内找 **Functions**。
3. **KV namespace bindings** → **Add binding**：
   - Variable name：`SUBS`（必须大写，代码里读 `env.SUBS`）
   - KV namespace：选 `ai0571-subscribers`
   - Save
4. **Environment Variables**（或 Secrets，Production 环境）→ **Add**：
   - Variable name：`RESEND_API_KEY`
   - Value：你的 `re_xxxx`
   - 建议勾选 **Encrypt / Secret** 类型 → Save
5. 保存后，Pages 会自动重新部署（带上 Functions）。

> 如果页面找不到 Functions 设置，确认你的 Pages 项目确实是连着 `benhkkk/AI0571-website` 这个仓库（部署源是 Git）。Functions 只在 Git 连接的 Pages 项目里可用。

---

## 第 5 步：前端 — 已完成
`index.html` 订阅表单已 `fetch('/api/subscribe')` 同域提交，随仓库自动部署。无需操作。

---

## 测试（等第 4 步 Pages 绑定完成后）
1. **订阅自测**：首页填邮箱 → 点订阅 → 按钮显示「已订阅 ✓ 每日早8点查收」。
   - 验证：Cloudflare **KV → ai0571-subscribers** 里应能看到该邮箱。
2. **手动发送测试**（不等到早上）：浏览器开
   `https://www.AI0571.com/api/send-test?to=你的邮箱`
   - 应返回 JSON `{"ok":true,"status":200,...}`，邮箱立刻收到日报邮件。
   - 若返回 `missing RESEND_API_KEY` → 第 4 步 Pages 的 Secret 没配好。
   - 若返回 `SUBS is not defined` → 第 4 步 Pages 的 KV 绑定名不是 `SUBS`。
3. **退订自测**：点邮件里「退订」→ 显示「已退订 ✓」，KV 里该邮箱被删。

---

## 第 6 步：诊断自动日报是否触发

如果工作日早上 08:00 没收到日报，按下面顺序排查：

### 6.1 查看 Worker cron 执行日志
浏览器打开：
```
https://www.AI0571.com/api/cron-status
```
- `found: false` → Worker 尚未触发过（等 10 分钟再试，或看 6.2）
- `found: true` → 看 `data.result`：
  - `type: "sendDailyDigest"` 且 `sent > 0` → 已发送，去垃圾箱找
  - `type: "sendDailyDigest"` 且 `note: "no subscribers"` → KV 里没有订阅者，你根本没订阅成功
  - `error: "Worker 未绑定 SUBS KV"` → Worker 侧 KV 绑定丢失
  - `error: "missing RESEND_API_KEY"` → Worker 侧 Secret 丢失

### 6.2 检查自己是否在订阅列表
在首页底部填邮箱点订阅，若提示「已订阅 ✓」，说明写入 KV。再用浏览器开：
```
https://www.AI0571.com/api/check-subscription?email=你的邮箱
```
- `subscribed: true` → 在列表里
- `subscribed: false` → 订阅失败，检查 Pages 的 KV 绑定

### 6.3 手动补发测试
不等早上 08:00，直接浏览器打开：
```
https://www.AI0571.com/api/send-test?to=你的邮箱
```
返回 `{"ok":true}` 后去邮箱查看。若收到了，说明 Resend + 模板都正常，问题只在自动触发或订阅列表。

### 6.4 手动群发一次
如果确认订阅列表正常、但自动没发，可以手动群发一次：
1. 在 Pages 项目 **Functions → Environment Variables** 加 `BROADCAST_SECRET`，值随便设一个复杂字符串。
2. 浏览器打开：
   ```
   https://www.AI0571.com/api/send-digest?broadcast=1&secret=你设的字符串
   ```
3. 返回 `sent: N` 即表示已群发 N 封。

---

## 第 7 步：关于 Cloudflare "not benefiting from our network" 邮件

你收到的这封邮件是 Cloudflare 的**配置提示/营销邮件**，不是故障告警。意思是：

> 你的域名 `ai0571.com` 已经加到 Cloudflare 账户，但 DNS 管理权还在阿里云（NS 仍是 `dns9.hichina.com` / `dns10.hichina.com`），所以 Cloudflare 的 DNS/CDN 高级功能没有真正生效。

### 要不要切 NS？
| 方案 | 影响 | 建议 |
|---|---|---|
| **不切**（保持阿里云 NS） | 网站、邮件、Worker Cron 当前都能正常工作；只是没用上 Cloudflare DNS 高级功能 | **推荐当前阶段保持现状** |
| **切到 Cloudflare NS**（lisa.ns + nolan.ns） | 必须把所有 DNS 记录（www CNAME、Resend 的 DKIM/SPF/DMARC/CNAME）从阿里云**重新加到 Cloudflare**；全球生效需几小时到 48 小时；期间邮件可能中断 | 除非你需要 Cloudflare 高级 DNS 功能，否则不用切 |

### 结论
**当前 AI0571 网站、自动抓取、邮件订阅都已跑通，不需要切 NS。** 那封邮件可以忽略。如果将来要切，我可以再出一版迁移步骤。

---

## 故障排查

| 现象 | 排查 |
|---|---|
| 订阅按钮一直「提交中…」 | 看是否线上测（非本地预览）；检查 Pages 项目 Functions 是否已部署（部署记录 Success）；Pages 的 KV/Secret 是否绑好 |
| `/api/send-test` 返回整页 HTML | 说明请求落回 Pages 静态页，Functions 未生效 → 确认仓库根有 `functions/api/send-test.js` 且 Pages 已重新部署 |
| `missing RESEND_API_KEY` | 第 4 步 Pages 项目里 Secret 名必须是 `RESEND_API_KEY` 且已 Save |
| `SUBS is not defined` | Pages 项目 KV binding 名必须是 `SUBS`（大写） |
| 收不到邮件但 sent=1 | 查 Resend Logs；确认 `ai0571.com` 已 Verified；查垃圾箱；发件域 `noreply@ai0571.com` 须来自已验证域名 |
| 工作日没自动发 | 访问 `/api/cron-status` 看 Worker 日志；确认 Worker Cron `0 0 * * 1-5` 在；确认 Worker 侧 KV `SUBS` + Secret `RESEND_API_KEY` 已绑；Resend 额度是否耗尽 |
| `/api/cron-status` 返回 `no subscribers` | 说明你没在首页成功订阅，或订阅写到了 Pages 侧但 Worker 读不到（检查两边是否同一 KV namespace） |
| `/api/cron-status` 返回 `missing RESEND_API_KEY` | Worker 侧 Secret `RESEND_API_KEY` 丢失，需去 Worker Settings → Variables 添加 |
| `/api/cron-status` 返回 `Worker 未绑定 SUBS KV` | Worker 侧 KV binding `SUBS` 丢失，检查 wrangler.toml 的 `[[kv_namespaces]]` id 是否正确 |

> 调试端点 `/api/send-test`、`/api/send-digest`、`/api/cron-status` 上线后可保留（方便自查），如担心被滥用可删除文件。

---

## ⚠️ 安全提醒
之前截图里暴露过一次 `RESEND_API_KEY`，如果该 Key 仍在用，建议去 Resend **Revoke** 重新生成，并更新 Worker 和 Pages 两处的 Secret 值。

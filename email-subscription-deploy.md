# AI0571 邮件订阅 · 部署手册

完成后的完整链路：
1. 用户在首页填邮箱 → `POST /api/subscribe`（同域，走 Cloudflare Route）→ 邮箱写入 **KV**
2. 每个工作日 **北京 08:00**（= UTC 00:00，周一至周五）Cloudflare Cron 触发
3. Worker 读取最新 `data.json` + KV 里的订阅邮箱 → 调用 **Resend** 群发 HTML 日报
4. 用户收到邮件，点「退订」→ `GET /api/unsubscribe?email=...` → 从 KV 删除

代码已就绪：`worker.js`（合并了订阅/退订/发送 + 原有抓取触发）、`index.html`（表单已改真实提交）、`wrangler.toml`（已加 KV 绑定和第二个 cron）。下面是你需要在控制台操作的步骤。

---

## 第 1 步：Resend（发信服务）

1. 打开 https://resend.com 注册（用 GitHub 登录最快）。
2. 进入 **Domains** → **Add Domain**，填写 `ai0571.com`，按提示把 Resend 给的 **SPF / DKIM / DMARC** 记录加到 **Cloudflare → ai0571.com → DNS**（TXT 记录，逐条复制粘贴）。
   - 加完后回到 Resend 点 **Verify**，显示 `Verified` 才算通过（DNS 生效可能等几分钟）。
3. 进入 **API Keys** → **Create API Key**，复制 Key（形如 `re_xxxx`），下一步要用。

> 免费额度 3000 封/月，对实验室小站点足够。发件人统一用 `noreply@ai0571.com`（已写在代码里）。

---

## 第 2 步：Cloudflare 创建 KV（存订阅邮箱）

1. Cloudflare 控制台 → 左侧 **Workers & Pages** → **KV** → **Create a namespace**。
2. 名称填 `ai0571-subs`（随便起，记住即可）。
3. 创建后，点进这个 namespace，**复制它的 ID**（一长串字母数字）。下一步要用。

---

## 第 3 步：Worker 设置（5 个小项）

进入 Cloudflare 控制台 → **Workers & Pages** → 你的 `ai0571-update-trigger` Worker。

### 3.1 更新代码
- **Editor / 代码** 里，把 `worker.js` 的完整内容粘贴进去并 **Save**。
  （仓库里的 `worker.js` 就是最新版，可直接复制；或用 Wrangler CLI `wrangler deploy` 从仓库部署。）

### 3.2 绑定 KV
- **Settings → Variables → KV namespace bindings → Add binding**
- Variable name 填 `SUBS`，对应 namespace 选刚建的 `ai0571-subs` → **Save**。

### 3.3 设置 Resend 密钥
- **Settings → Variables → Environment Variables** 里 **Add variable**
- 变量名 `RESEND_API_KEY`，值粘贴第1步的 `re_xxxx` → 勾选 **Encrypt** → **Save**。

### 3.4 加第二个 Cron
- **Settings → Triggers → Cron Retriggers → Add**
- 新增一条：`0 0 * * 1-5`（原有 `*/10 * * * *` 保留，不要删）
- 含义：工作日 UTC 00:00 = 北京 08:00 发送日报。

### 3.5 加 Route（关键，让订阅同域）
- **Settings → Triggers → Routes → Add**
- Route 填：`www.AI0571.com/api/*`
- Service 选 `ai0571-update-trigger`，Environment 选 `production` → **Add**
- 这样 `/api/subscribe`、`/api/unsubscribe` 都由 Worker 处理，且和网站同域、无需跨域配置。

---

## 第 4 步：前端（已自动完成）

`index.html` 的订阅表单已改为 `fetch('/api/subscribe')` 真实提交，我会上传到 GitHub，Cloudflare Pages 会自动重新部署。你无需操作。

---

## 测试（建议上线前做一遍）

1. **订阅自测**：首页填你的邮箱 → 点订阅 → 按钮应显示「已订阅 ✓ 每日早8点查收」。
   - 验证：Worker 控制台 **KV → ai0571-subs** 里应能看到你的邮箱记录。
2. **手动发送测试**（不等人到早上）：浏览器打开
   `https://www.AI0571.com/api/send-test?to=你的邮箱`
   - 应返回 JSON `{"ok":true,"sent":1,...}`，你的邮箱会立刻收到一封日报邮件。
   - 没收到：检查 Resend 控制台 Logs / 垃圾箱；确认域名已 Verified、Key 正确。
3. **退订自测**：点邮件里的「退订」链接 → 应显示「已退订 ✓」，KV 里该邮箱被删除。

---

## 故障排查

| 现象 | 排查 |
|---|---|
| 订阅按钮一直「提交中」 | 检查 Route `www.AI0571.com/api/*` 是否已加；本地预览（file://）不会生效，必须在线上测 |
| 发送测试返回 `missing RESEND_API_KEY` | 第3.3 步变量名必须是 `RESEND_API_KEY` 且已 Save |
| 收不到邮件但 sent=1 | 查 Resend Logs；确认 `ai0571.com` 已 Verified；检查垃圾箱；发件域 `noreply@ai0571.com` 必须来自已验证域名 |
| KV 报错 `SUBS is not defined` | 第3.2 步 binding 名必须是 `SUBS`（大写） |
| 工作日没自动发 | 确认 Cron `0 0 * * 1-5` 已添加；Resend 额度是否耗尽（3000/月） |

> 调试端点 `/api/send-test` 上线后可保留（仅你能方便地触发），如担心被滥用可删除该分支。

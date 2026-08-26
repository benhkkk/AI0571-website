# AI0571.com 上线教程（Cloudflare Pages + 域名绑定）

> 您的 GitHub 仓库已经建好并推送完成（benhkkk/AI0571-website），
> 每日自动更新已验证跑通。现在只差最后两步，**全程约 10 分钟**。
> 这两步需要您本人操作，因为涉及账号登录授权，我无法代办。

---

## 📍 当前进度一览

| 步骤 | 状态 |
|---|---|
| ① GitHub 仓库 + 上传文件 | ✅ 已完成（我代办） |
| ② 每日自动更新工作流 | ✅ 已完成并实测跑通 |
| ③ **Cloudflare Pages 部署** | ⏳ 本次要做的第 1 步 |
| ④ **绑定 AI0571.com 域名** | ⏳ 本次要做的第 2 步 |
| ⑤ 最终验证 | ✅ 做完 ③④ 后自动生效 |

---

## 第 ③ 步：Cloudflare Pages 部署（约 5 分钟）

### 3.1 注册/登录 Cloudflare
1. 打开浏览器访问：**https://dash.cloudflare.com**
2. 点 **Sign up** 注册（可用邮箱，免费）。已注册就直接登录
3. 首次登录会让你"添加站点"——**这一步先跳过**（点页面底部的 "Skip" 或稍后再说），
   因为我们用的是 Pages 功能，不需要把域名托管到 Cloudflare

### 3.2 创建 Pages 项目
1. 登录后，看左侧菜单栏，找到 **Workers & Pages**（工人和页面），点击进入
2. 点右侧蓝色按钮 **Create**（创建）→ 选择 **Pages** 标签页
3. 在 "Connect to Git"（连接到 Git）区域点 **Connect to Git** 按钮
4. 浏览器会跳到 GitHub 授权页面：
   - 如果还没登录 GitHub，先登录
   - 点 **Authorize Cloudflare**（授权），可能需要输一次 GitHub 密码确认
5. 授权完成后，会列出你的仓库列表：
   - 选择 **AI0571-website**
   - 点 **Begin setup**（开始设置）

### 3.3 构建配置（重要，别填错）
进入设置页面后，保持默认即可，只需确认/填写两项：

| 配置项 | 填什么 | 说明 |
|---|---|---|
| **Framework preset**（框架预设） | 保持 **None**（无） | 我们是纯静态站 |
| **Build command**（构建命令） | **留空** | 不需要构建 |
| **Build output directory**（输出目录） | **填 `/`**（斜杠） | 站点根目录 |

> 注意：Build output directory 必须填 `/`，如果留空会部署失败。
> 其他选项（如 "Root directory"）保持默认。

点下方蓝色按钮 **Save and Deploy**（保存并部署）。

### 3.4 等待部署完成
1. 页面会显示部署进度（约 1-2 分钟）
2. 完成后会给你一个网址：**`xxxxxxxx.pages.dev`**（一串随机字母数字）
3. **现在先点开这个网址确认网站正常显示**——应该能看到 AI0571 首页（深色科技风 + AI 资讯卡片）
4. 如果显示正常，第 ③ 步完成 ✅

> 💡 这个 `xxx.pages.dev` 网址就是网站目前的临时地址，
> 接下来把它绑定到您的 AI0571.com。

---

## 第 ④ 步：绑定 AI0571.com 域名（约 5 分钟）

### 4.1 在 Cloudflare 添加自定义域名
1. 回到 Cloudflare 的 Pages 项目页面（就是你刚才部署的那个项目）
2. 顶部标签页找到 **Custom domains**（自定义域）→ 点进去
3. 点 **Add custom domain**（添加自定义域）
4. 输入框填写：**`AI0571.com`**（不带 www）
5. 点 **Continue**（继续）→ 点 **Activate**（激活）
6. Cloudflare 会显示一条 DNS 记录要求你配置，通常是：
   ```
   类型：CNAME
   名称：AI0571.com
   内容：<你的项目>.pages.dev
   ```
   **先别关这个页面**，记下这些信息，下一步去阿里云添加

> 📌 如果 Cloudflare 还让你加 `www` 子域名，可以之后再补，先让主域名生效。

### 4.2 在阿里云添加 DNS 解析记录
1. 打开浏览器访问：**https://dc.console.aliyun.com**（阿里云域名控制台）
2. 登录您的阿里云账号（就是注册 AI0571.com 的账号）
3. 左侧菜单 **域名列表** → 找到 **AI0571.com** → 点右侧 **解析**（或"解析设置"）
4. 点 **添加记录** 按钮，按下面填：

| 配置项 | 填什么 |
|---|---|
| **记录类型** | 选 **CNAME** |
| **主机记录** | 填 **`@`**（表示主域名 AI0571.com 本身） |
| **记录值** | 填 Cloudflare 给你的 **`<你的项目>.pages.dev`** |
| **TTL** | 默认（10 分钟） |

> 如果 Cloudflare 的提示里要求的是 `www` 记录（主机记录填 `www`），
> 那就再按同样方式添加第二条，主机记录填 `www`。
> 以 Cloudflare 页面提示的为准。

5. 点 **确认** 保存

### 4.3 等待生效并验证
1. DNS 解析生效需要等待，**通常 5 分钟到几小时**（一般很快）
2. 回到 Cloudflare 的 Custom domains 页面，看状态从 "Pending"（等待）变成 "Active"（生效）
3. 浏览器访问 **https://AI0571.com** 和 **https://www.AI0571.com** 验证
4. 能看到 AI0571 首页 = 绑定成功 🎉

---

## 第 ⑤ 步：确认每日自动更新继续工作

域名绑定不影响自动更新。日常无需任何操作：

- 每天**北京时间 08:00**，GitHub Actions 自动抓取资讯 → 更新页面 → Cloudflare 自动重新部署
- 想随时手动刷新：GitHub 仓库 → **Actions** 页 → 点 `daily-update` 工作流 → 右侧 **Run workflow** → 确认
- 等 2-3 分钟，访问网站即可看到最新资讯

---

## 🆘 常见问题速查

| 问题 | 解决办法 |
|---|---|
| Cloudflare 显示部署失败 | 检查构建配置：Build command 留空、Build output directory 填 `/` |
| `xxx.pages.dev` 能开但 AI0571.com 打不开 | DNS 还没生效，多等一会儿；确认阿里云 CNAME 记录值拼写正确 |
| 阿里云解析里已有一条同名记录 | 先删掉旧的，再添加新 CNAME，避免冲突 |
| 添加自定义域时 Cloudflare 让改 NS 服务器 | **不需要**！只需按提示添加 CNAME 记录即可，不要改 DNS 服务器 |
| 网站显示但样式错乱 | 刷新浏览器缓存（Ctrl+F5），一般过几分钟自动好 |

---

## ⚠️ 安全提醒

您的 GitHub 令牌（ghp_ 开头）建议现在撤销：
GitHub → 头像 → **Settings** → **Developer settings** → **Personal access tokens**
→ 找到 `AI0571 auto-update` → **Revoke**（撤销）

自动更新用的是 GitHub 内置的 Actions 令牌，**不需要**您的个人令牌，撤销后网站不受影响。

---

## 做完这些，就彻底完工了 🎉

- ✅ 网站：https://AI0571.com（深色科技风 AI 资讯首页）
- ✅ 内容：每天 08:00 自动更新 16 条资讯 + 6 条时间线
- ✅ 成本：0 元（GitHub + Cloudflare 免费额度）
- ✅ 维护：零维护，只需偶尔看看 Actions 日志是否正常

有任何一步卡住，截图发我，我帮您排查。

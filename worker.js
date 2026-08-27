/**
 * AI0571 定时更新触发器（Cloudflare Worker）
 * ==========================================
 *
 * 作用：替代不可靠的 GitHub Actions schedule。
 *   Cloudflare Cron Triggers 精确到分钟（每 10 分钟触发）→
 *   调用 GitHub Actions API（workflow_dispatch）→
 *   Actions 抓取资讯/技能包 → push → Cloudflare Pages 自动部署 →
 *   前端每 5 分钟轮询 data.json 自动更新。
 *
 * 部署步骤见《定时更新-CloudflareWorker部署.md》
 *
 * 所需 Secrets（Worker → Settings → Variables and Secrets）：
 *   GH_PAT        必填：GitHub Personal Access Token（需 repo + workflow 权限）
 *   GH_OWNER      可选：默认 benhkkk
 *   GH_REPO       可选：默认 AI0571-website
 *   GH_WORKFLOW   可选：默认 daily-update.yml
 */

async function triggerGithub(env) {
  const token = env.GH_PAT;
  if (!token) {
    return { ok: false, status: 500, body: 'missing GH_PAT secret' };
  }
  const owner = env.GH_OWNER || 'benhkkk';
  const repo = env.GH_REPO || 'AI0571-website';
  const wf = env.GH_WORKFLOW || 'daily-update.yml';
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wf}/dispatches`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'ai0571-cron-trigger',
      },
      body: JSON.stringify({ ref: 'main' }),
    });
    // 204 = 触发成功入队
    return { ok: resp.status === 204, status: resp.status, body: await resp.text() };
  } catch (e) {
    return { ok: false, status: 500, body: String(e && e.message || e) };
  }
}

export default {
  // Cron 定时触发：每 10 分钟（Cloudflare 精确调度，不延迟）
  async scheduled(event, env, ctx) {
    ctx.waitUntil(triggerGithub(env));
  },

  // 手动触发 / 健康检查：访问 Worker 域名 /trigger 可手动跑一次
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/trigger') {
      const r = await triggerGithub(env);
      return new Response(`GitHub trigger -> ${r.status} ${r.body}`.slice(0, 200), { status: 200 });
    }
    if (url.pathname === '/') {
      return new Response('AI0571 定时更新触发器运行中。GET /trigger 手动触发一次。', { status: 200 });
    }
    return new Response('Not Found', { status: 404 });
  },
};

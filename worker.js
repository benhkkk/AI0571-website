/**
 * AI0571 定时任务 Worker（仅 Cron 触发，不处理 HTTP 请求）
 * ------------------------------------------------------------
 * 职责：
 *  1) Cron */10 * * * *        -> 触发 GitHub Actions 重新抓取资讯
 *  2) Cron 0 0 * * 1-5 (UTC)  -> 每个工作日北京 08:00 发送 AI 日报邮件
 *
 * HTTP 端点（订阅/退订/发送测试）已迁移到 Cloudflare Pages Functions
 * （仓库 /functions/api/*）。站点由 Pages 托管，Functions 是同域原生后端，
 * 无需配置 Worker Route，因此本文件只保留 cron 逻辑。
 *
 * 部署：wrangler.toml 已配置 KV(SUBS) + 两个 Cron；本文件由 Cloudflare
 *       Git 集成自动部署。本 Worker 只跑 Cron，HTTP 端点已全部迁移到
 *       Pages Functions（/functions/api/*）。
 */

const CAT = { HOT: '热门', MODEL: '大模型', FUNDING: '融资', INDUSTRY: '行业', MEDPHARMA: '医药AI', MEDDEVICE: '设备AI' };
const CATCOLOR = { HOT: '#F472B6', MODEL: '#8B5CF6', FUNDING: '#10B981', INDUSTRY: '#3B82F6', MEDPHARMA: '#EC4899', MEDDEVICE: '#14B8A6' };

function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------- 触发 GitHub Actions 抓取 ---------- */
async function triggerGithub(env) {
  const token = env.GH_PAT;
  if (!token) return { ok: false, status: 500, body: 'missing GH_PAT secret' };
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
    return { ok: resp.status === 204, status: resp.status, body: await resp.text() };
  } catch (e) {
    return { ok: false, status: 500, body: String(e && e.message || e) };
  }
}

/* ---------- 订阅者列表（KV）---------- */
async function listSubscribers(env) {
  const emails = [];
  let cursor;
  do {
    const opt = cursor ? { cursor } : {};
    const page = await env.SUBS.list(opt);
    for (const k of page.keys) {
      try {
        const v = JSON.parse(await env.SUBS.get(k.name));
        if (v && v.email) emails.push(v.email);
      } catch (_) { /* skip */ }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return emails;
}

/* ---------- 邮件 HTML 模板 ---------- */
function buildDigestHTML(data, email) {
  const news = (data.news || []).slice(0, 10);
  const dateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const unsub = `https://www.AI0571.com/api/unsubscribe?email=${encodeURIComponent(email || '')}`;
  const top = news[0] || {};

  const items = news.slice(1).map(n => {
    const c = CAT[n.c] || n.c;
    const col = CATCOLOR[n.c] || '#888';
    const time = (n.d || '').replace('T', ' ');
    return `<tr>
      <td style="padding:14px 18px;border-bottom:1px solid #eee;font-family:-apple-system,Segoe UI,Roboto,'PingFang SC','Microsoft YaHei',sans-serif;">
        <span style="display:inline-block;background:${col}1a;color:${col};font-size:12px;font-weight:700;padding:2px 9px;border-radius:999px;margin-right:8px;vertical-align:middle;">${esc(c)}</span>
        <a href="${esc(n.u || '#')}" style="color:#111;font-size:15px;font-weight:600;text-decoration:none;vertical-align:middle;">${esc(n.t)}</a>
        <div style="color:#8a8a8a;font-size:12px;margin-top:5px;">${esc(time)}</div>
      </td>
    </tr>`;
  }).join('');

  const topTime = (top.d || '').replace('T', ' ');
  const topSummary = esc((top.s || '').slice(0, 140));

  return `<!doctype html>
<html lang="zh-CN"><body style="margin:0;background:#f4f5f7;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,'PingFang SC','Microsoft YaHei',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.06);">
    <tr><td style="background:linear-gradient(135deg,#6366F1,#8B5CF6);padding:26px 24px;color:#fff;">
      <div style="font-size:20px;font-weight:800;letter-spacing:.5px;">AI0571 · 每日 AI 日报</div>
      <div style="font-size:13px;opacity:.88;margin-top:6px;">${esc(dateStr)} · 全球 AI / 医药AI / 医疗设备AI 动态速览</div>
    </td></tr>
    ${top.t ? `<tr><td style="padding:20px 24px;">
      <div style="font-size:12px;color:#8B5CF6;font-weight:700;margin-bottom:7px;">今日头条</div>
      <a href="${esc(top.u || '#')}" style="color:#111;font-size:18px;font-weight:800;text-decoration:none;line-height:1.4;">${esc(top.t)}</a>
      ${topSummary ? `<div style="color:#555;font-size:14px;line-height:1.65;margin-top:8px;">${topSummary}…</div>` : ''}
      <div style="color:#999;font-size:12px;margin-top:6px;">${esc(topTime)}</div>
    </td></tr>` : ''}
    <tr><td style="padding:0 0 6px;">
      <table width="100%" cellpadding="0" cellspacing="0">${items}</table>
    </td></tr>
    <tr><td style="padding:16px 24px;background:#fafafa;border-top:1px solid #eee;color:#999;font-size:12px;line-height:1.8;">
      由 <a href="https://www.AI0571.com" style="color:#6366F1;text-decoration:none;">AI0571.com</a> 自动发送 · 你在 AI0571 订阅了每日日报<br/>
      <a href="${unsub}" style="color:#6366F1;text-decoration:none;">退订此邮件</a>
    </td></tr>
  </table></body></html>`;
}

/* ---------- 发送日报 ---------- */
async function sendDailyDigest(env, onlyTo) {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'missing RESEND_API_KEY' };

  let data;
  try {
    const r = await fetch('https://www.AI0571.com/data.json', { cache: 'no-store' });
    data = await r.json();
  } catch (e) {
    return { ok: false, error: 'fetch data.json failed: ' + String(e) };
  }

  let emails = onlyTo ? [onlyTo] : await listSubscribers(env);
  emails = emails.filter(validEmail);
  if (!emails.length) return { ok: true, sent: 0, note: 'no subscribers' };

  const subject = `AI0571 每日 AI 日报 · ${new Date().toLocaleDateString('zh-CN')}`;
  const from = 'AI日报 <noreply@ai0571.com>';
  let sent = 0, failed = 0;

  for (const email of emails) {
    const html = buildDigestHTML(data, email);
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to: [email], subject, html }),
      });
      if (resp.ok) sent++; else { failed++; console.error('resend fail', email, await resp.text()); }
    } catch (e) {
      failed++; console.error('send error', email, e);
    }
  }
  return { ok: true, sent, failed, total: emails.length };
}

/* ---------- Cron 入口 ---------- */
export default {
  async scheduled(event, env, ctx) {
    const c = event.cron || '';
    // 工作日早晨（UTC 00:00 = 北京 08:00）发送日报；其余 cron 触发抓取
    if (/1-5$/.test(c)) {
      ctx.waitUntil(sendDailyDigest(env));
    } else {
      ctx.waitUntil(triggerGithub(env));
    }
  }
};

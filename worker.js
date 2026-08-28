/**
 * AI0571 统一 Worker（定时更新触发 + 邮件订阅/日报）
 * ===================================================
 * 职责：
 *  1) 每10分钟触发 GitHub Actions 重新抓取资讯
 *  2) 工作日 UTC 00:00（北京 08:00）发送 AI 日报邮件
 *  3) POST /api/subscribe       -> 收集订阅邮箱（写入 KV）
 *  4) GET  /api/unsubscribe     -> 退订（从 KV 删除）
 *  5) GET  /api/send-test       -> 手动触发一次发送（调试用，?to=邮箱 仅发一人）
 *
 * 部署（详见《邮件订阅-部署手册.md》）：
 *  - Route：www.AI0571.com/api/* -> 本 Worker（同域，无需 CORS）
 *  - KV：绑定 SUBS（订阅者邮箱命名空间）
 *  - Secrets：GH_PAT（原有）、RESEND_API_KEY（Resend 密钥）
 *  - Cron Triggers：每10分钟抓取 + 工作日早8点发送
 */

const CAT = { HOT: '热门', MODEL: '大模型', FUNDING: '融资', INDUSTRY: '行业', MEDPHARMA: '医药AI', MEDDEVICE: '设备AI' };
const CATCOLOR = { HOT: '#F472B6', MODEL: '#8B5CF6', FUNDING: '#10B981', INDUSTRY: '#3B82F6', MEDPHARMA: '#EC4899', MEDDEVICE: '#14B8A6' };

/* ---------- 原有：触发 GitHub Actions 抓取 ---------- */
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

/* ---------- 工具 ---------- */
function cors(resp) {
  resp.headers.set('Access-Control-Allow-Origin', 'https://www.AI0571.com');
  resp.headers.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  resp.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return resp;
}
function json(data, status = 200) {
  return cors(new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  }));
}
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------- 订阅 / 退订（KV） ---------- */
async function addSubscriber(env, email) {
  email = (email || '').trim().toLowerCase();
  if (!validEmail(email)) return { ok: false, error: '邮箱格式不正确' };
  const exist = await env.SUBS.get(email);
  if (exist) return { ok: true, duplicate: true, message: '您已订阅，无需重复' };
  await env.SUBS.put(email, JSON.stringify({ email, ts: Date.now() }));
  return { ok: true, message: '订阅成功' };
}
async function removeSubscriber(env, email) {
  email = (email || '').trim().toLowerCase();
  if (!validEmail(email)) return false;
  await env.SUBS.delete(email);
  return true;
}
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

  // 逐封发送，使每封退订链接带本人邮箱（合规/BCC 不可个性化）
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

/* ---------- 路由 ---------- */
export default {
  async scheduled(event, env, ctx) {
    const c = event.cron || '';
    // 工作日早晨（UTC 00:00 = 北京 08:00）发送日报；其余 cron 触发抓取
    if (/1-5$/.test(c)) {
      ctx.waitUntil(sendDailyDigest(env));
    } else {
      ctx.waitUntil(triggerGithub(env));
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    // 订阅
    if (url.pathname === '/api/subscribe' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const r = await addSubscriber(env, body.email);
        return json(r, r.ok ? 200 : 400);
      } catch (e) {
        return json({ ok: false, error: 'bad request' }, 400);
      }
    }

    // 退订（邮箱参数）
    if (url.pathname === '/api/unsubscribe') {
      const email = url.searchParams.get('email');
      const ok = await removeSubscriber(env, email);
      const html = `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;padding:60px 20px;color:#333;">
        <h2>${ok ? '已退订 ✓' : '退订失败'}</h2>
        <p>${ok ? esc(email) + ' 已成功退订每日 AI 日报。' : '邮箱无效或不存在。'}</p>
        <p><a href="https://www.AI0571.com" style="color:#6366F1;">返回 AI0571</a></p>
      </body>`;
      return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // 手动触发发送（调试）
    if (url.pathname === '/api/send-test') {
      const to = url.searchParams.get('to');
      const r = await sendDailyDigest(env, to || undefined);
      return json(r);
    }

    // 原有：手动触发抓取
    if (url.pathname === '/trigger') {
      const r = await triggerGithub(env);
      return new Response(`GitHub trigger -> ${r.status} ${r.body}`.slice(0, 200), { status: 200 });
    }
    if (url.pathname === '/') {
      return new Response('AI0571 Worker 运行中。/api/subscribe 订阅 · /api/send-test 调试发送 · /trigger 触发抓取。', { status: 200 });
    }
    return new Response('Not Found', { status: 404 });
  },
};

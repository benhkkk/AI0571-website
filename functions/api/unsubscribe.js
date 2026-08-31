// Pages Function: 退订（两步确认）
//   GET  /api/unsubscribe?email=xxx -> 显示确认页（不执行删除）
//   POST /api/unsubscribe           -> 真正从 KV(SUBS) 删除
//
// 为什么改成两步：邮件客户端/安全扫描器会自动 GET 访问邮件里的链接，
// 若 GET 直接删除，用户会在毫不知情的情况下被退订。改为 POST 确认可避免该问题。
import { validEmail, maskEmail } from '../_lib/auth.js';

const page = (title, body, ok = true) => `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<body style="font-family:-apple-system,Segoe UI,Roboto,'PingFang SC','Microsoft YaHei',sans-serif;text-align:center;padding:60px 20px;color:#333;background:#f7f8fa;margin:0;">
  <div style="max-width:420px;margin:0 auto;background:#fff;border-radius:16px;padding:36px 28px;box-shadow:0 6px 24px rgba(0,0,0,.06);">
    <h2 style="margin:0 0 12px;color:${ok ? '#10B981' : '#EF4444'};">${title}</h2>
    ${body}
    <p style="margin-top:24px;"><a href="https://www.AI0571.com" style="color:#6366F1;text-decoration:none;">返回 AI0571</a></p>
  </div>
</body>`;

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
  if (!validEmail(email)) {
    return new Response(page('链接无效', '<p>退订链接缺少有效的邮箱参数。</p>', false),
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  let exists = false;
  try {
    exists = (await env.SUBS.get(email)) !== null;
  } catch (_) { /* ignore */ }

  if (!exists) {
    return new Response(page('未找到订阅', `<p>邮箱 ${maskEmail(email)} 不在订阅列表中，可能已退订。</p>`, false),
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const body = `
    <p style="color:#555;line-height:1.7;">确认退订邮箱 <b>${maskEmail(email)}</b> 吗？<br/>退订后将不再收到 AI0571 每日 AI 日报。</p>
    <form method="POST" action="/api/unsubscribe" style="margin-top:24px;">
      <input type="hidden" name="email" value="${email.replace(/"/g, '&quot;')}" />
      <button type="submit" style="background:#EF4444;color:#fff;border:0;border-radius:999px;padding:12px 32px;font-size:15px;font-weight:700;cursor:pointer;">确认退订</button>
    </form>`;
  return new Response(page('退订确认', body),
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function onRequestPost({ request, env }) {
  let email = '';
  const ct = String(request.headers.get('content-type') || '');
  try {
    if (ct.includes('application/json')) {
      const j = await request.json();
      email = String(j.email || '');
    } else {
      const form = await request.formData();
      email = String(form.get('email') || '');
    }
  } catch (_) { /* ignore */ }

  email = email.trim().toLowerCase();
  if (!validEmail(email)) {
    return new Response(page('退订失败', '<p>邮箱无效。</p>', false),
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  let ok = false;
  try {
    const exists = await env.SUBS.get(email);
    if (exists !== null) {
      await env.SUBS.delete(email);
      ok = true;
    }
  } catch (_) { /* ignore */ }

  return new Response(
    page(ok ? '已退订 ✓' : '退订失败',
      ok ? `<p>${maskEmail(email)} 已成功退订每日 AI 日报。</p>`
         : `<p>邮箱 ${maskEmail(email)} 无效或不存在。</p>`, ok),
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

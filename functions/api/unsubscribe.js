// Pages Function: GET /api/unsubscribe?email=xxx -> 从 KV(SUBS) 删除订阅
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const ok = valid ? await env.SUBS.delete(email) : false;
  const html = `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;padding:60px 20px;color:#333;">
    <h2>${ok ? '已退订 ✓' : '退订失败'}</h2>
    <p>${ok ? email + ' 已成功退订每日 AI 日报。' : '邮箱无效或不存在。'}</p>
    <p><a href="https://www.AI0571.com" style="color:#6366F1;">返回 AI0571</a></p>
  </body>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

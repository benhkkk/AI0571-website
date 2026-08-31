// Pages Function: GET /api/check-subscription?email=xxx -> 查询邮箱是否在订阅列表
// 绑定：Pages 项目 Settings -> Functions -> KV "SUBS"
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: '邮箱格式不正确' }, 400);
    }
    const v = await env.SUBS.get(email);
    if (v) {
      const data = JSON.parse(v);
      return json({ ok: true, subscribed: true, email, ts: data.ts });
    }
    return json({ ok: true, subscribed: false, email });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
}

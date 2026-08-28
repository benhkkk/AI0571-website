// Pages Function: POST /api/subscribe -> 写入订阅邮箱到 KV(SUBS)
// 同域调用，无需 CORS。绑定：Pages 项目 Settings -> Functions -> KV binding "SUBS"
export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ ok: false, error: '邮箱格式不正确' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    const exist = await env.SUBS.get(email);
    if (exist) {
      return new Response(JSON.stringify({ ok: true, duplicate: true, message: '您已订阅，无需重复' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    await env.SUBS.put(email, JSON.stringify({ email, ts: Date.now() }));
    return new Response(JSON.stringify({ ok: true, message: '订阅成功' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'bad request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

// Pages Function: GET /api/check-subscription?email=xxx&token=管理员令牌 -> 查询邮箱是否在订阅列表
// ⚠️ 需鉴权：否则可被用来批量枚举「某人是否订阅了本站」，属于隐私泄露。
import { requireAdmin, json, validEmail } from '../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  try {
    const url = new URL(request.url);
    const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
    if (!validEmail(email)) {
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

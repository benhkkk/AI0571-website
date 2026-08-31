// Pages Function: POST /api/subscribe -> 写入订阅邮箱到 KV(SUBS)
// 同域调用，无需 CORS。绑定：Pages 项目 Settings -> Functions -> KV binding "SUBS"
//
// 该端点必须保持公开（访客要能自助订阅），因此额外加：
//   1) 按 IP 的滑动窗口限流（1 小时内最多 10 次），防刷库 / 订阅轰炸
//   2) 一次性邮箱域名黑名单，避免垃圾订阅污染列表
import { json, validEmail } from '../_lib/auth.js';

const RATE_LIMIT = 10;          // 每 IP 每小时最多订阅次数
const RATE_WINDOW_MS = 3600e3;  // 限流窗口

// 常见一次性/临时邮箱域名（小写比对）
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'throwawaymail.com', 'yopmail.com', 'trashmail.com', 'sharklasers.com',
  'maildrop.cc', 'getnada.com', 'temp-mail.org', 'fakeinbox.com',
]);

async function rateLimited(env, request) {
  const ip = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')
    || 'unknown';
  const key = 'rl:sub:' + ip;
  const now = Date.now();
  let count = 0, first = now;
  try {
    const rec = await env.SUBS.get(key);
    if (rec) {
      const p = JSON.parse(rec);
      count = Number(p.count) || 0;
      first = Number(p.first) || now;
      if (now - first > RATE_WINDOW_MS) { count = 0; first = now; }  // 窗口过期重置
    }
  } catch (_) { /* 解析失败按 0 处理 */ }

  if (count >= RATE_LIMIT) return { limited: true, retryAfter: Math.ceil((RATE_WINDOW_MS - (now - first)) / 1000) };

  try {
    await env.SUBS.put(key, JSON.stringify({ count: count + 1, first }), { expirationTtl: 3700 });
  } catch (_) { /* 限流写失败不阻断订阅 */ }
  return { limited: false };
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    if (!validEmail(email)) {
      return json({ ok: false, error: '邮箱格式不正确' }, 400);
    }

    const domain = email.slice(email.indexOf('@') + 1);
    if (DISPOSABLE.has(domain)) {
      return json({ ok: false, error: '请使用常用邮箱订阅（不支持临时邮箱）' }, 400);
    }

    const rl = await rateLimited(env, request);
    if (rl.limited) {
      return json({ ok: false, error: '操作过于频繁，请稍后再试', retryAfter: rl.retryAfter }, 429);
    }

    const exist = await env.SUBS.get(email);
    if (exist) {
      return json({ ok: true, duplicate: true, message: '您已订阅，无需重复' });
    }

    await env.SUBS.put(email, JSON.stringify({ email, ts: Date.now() }));
    return json({ ok: true, message: '订阅成功' });
  } catch (e) {
    return json({ ok: false, error: 'bad request' }, 400);
  }
}

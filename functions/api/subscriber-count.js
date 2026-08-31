// Pages Function: GET /api/subscriber-count -> 返回订阅者数量（邮箱脱敏）
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// 脱敏：保留首字符与域名，如 h***@qq.com
function mask(email) {
  const at = String(email).indexOf('@');
  if (at < 1) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  return local.slice(0, 1) + '***' + domain;
}

export async function onRequestGet({ request, env }) {
  try {
    const emails = [];
    let cursor;
    do {
      const opt = cursor ? { cursor } : {};
      const page = await env.SUBS.list(opt);
      for (const k of page.keys) {
        if (k.name === 'cron-log') continue;
        try {
          const v = JSON.parse(await env.SUBS.get(k.name));
          if (v && v.email) emails.push({ email: v.email, ts: v.ts });
        } catch (_) { /* skip */ }
      }
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);

    emails.sort((a, b) => (b.ts || 0) - (a.ts || 0));

    return json({
      ok: true,
      count: emails.length,
      subscribers: emails.map(e => ({
        masked: mask(e.email),
        subscribedAt: e.ts ? new Date(e.ts).toISOString() : null,
      })),
    });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
}

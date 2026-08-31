// Pages Function: GET /api/subscriber-count?token=xxx -> 返回订阅者数量（邮箱脱敏）
// ⚠️ 需鉴权：订阅者列表属于用户隐私，不应公开可查。
import { requireAdmin, json, maskEmail } from '../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  try {
    const emails = [];
    let cursor;
    do {
      const opt = cursor ? { cursor } : {};
      const page = await env.SUBS.list(opt);
      for (const k of page.keys) {
        // 跳过非订阅者 key：cron 日志(cron-log) 与限流记录(rl:*)
        if (k.name === 'cron-log' || k.name.startsWith('rl:')) continue;
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
        masked: maskEmail(e.email),
        subscribedAt: e.ts ? new Date(e.ts).toISOString() : null,
      })),
    });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
}

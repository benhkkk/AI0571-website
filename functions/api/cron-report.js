// Pages Function: GET /api/cron-report?payload=JSON[&token=xxx] -> Worker 通过 HTTP 上报 cron 执行状态
// 用途：当 Worker 侧 KV 绑定异常时，仍能通过 HTTP 把执行结果写进 KV，避免诊断盲区。
// 鉴权：采用宽松策略——未配置 ADMIN_TOKEN 时放行（最坏情况仅日志被污染），
//      一旦配置了 ADMIN_TOKEN，则 Worker 必须携带相同 token（需同步写入 Worker 的 Secrets）。
import { requireAdminIfConfigured, json } from '../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const auth = requireAdminIfConfigured(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  try {
    const url = new URL(request.url);
    const payload = String(url.searchParams.get('payload') || '').slice(0, 4000);
    if (!payload) return json({ ok: false, error: 'missing payload' }, 400);

    let entry;
    try {
      entry = JSON.parse(payload);
    } catch (_) {
      return json({ ok: false, error: 'invalid json' }, 400);
    }

    entry.reportedAt = Date.now();
    entry.reportedIso = new Date().toISOString();
    entry.via = 'http';

    await env.SUBS.put('cron-log', JSON.stringify(entry));
    return json({ ok: true, received: true });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
}

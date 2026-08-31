// Pages Function: GET /api/cron-report?payload=JSON -> Worker 通过 HTTP 上报 cron 执行状态
// 用途：当 Worker 侧 KV 绑定异常时，仍能通过 HTTP 把执行结果写进 KV，避免诊断盲区。
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestGet({ request, env }) {
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

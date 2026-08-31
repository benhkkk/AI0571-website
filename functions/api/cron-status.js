// Pages Function: GET /api/cron-status -> 读取 Worker 最近一次 cron 执行日志
// 绑定：Pages 项目 Settings -> Functions -> KV "SUBS"
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestGet({ request, env }) {
  try {
    const log = await env.SUBS.get('cron-log');
    if (!log) {
      return json({ ok: true, found: false, message: '暂无 cron 日志（Worker 可能尚未触发过）' });
    }
    const data = JSON.parse(log);
    return json({ ok: true, found: true, data });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
}

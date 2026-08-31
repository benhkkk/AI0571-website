// Pages Function: GET /api/cron-status[?token=xxx] -> 读取 Worker 最近一次 cron 执行日志
// 鉴权：宽松策略——未配置 ADMIN_TOKEN 时可直接查看（方便自查）；
//      配置了 ADMIN_TOKEN 后需携带 token。
import { requireAdminIfConfigured, json } from '../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const auth = requireAdminIfConfigured(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  try {
    const log = await env.SUBS.get('cron-log');
    if (!log) {
      return json({ ok: true, found: false, message: '暂无 cron 日志（Worker 可能尚未触发过）' });
    }
    const data = JSON.parse(log);
    // 附带北京时间，便于直接阅读
    const beijing = data.iso
      ? new Date(new Date(data.iso).getTime() + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 19)
      : null;
    return json({ ok: true, found: true, beijingTime: beijing, data });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
}

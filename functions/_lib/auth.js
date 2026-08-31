// 共享鉴权模块（以下划线开头的目录不会被 Pages Functions 路由暴露）
// 用法：在需要保护的函数里
//   import { requireAdmin } from '../_lib/auth.js';
//   const auth = requireAdmin(request, env);
//   if (!auth.ok) return json({ ok:false, error: auth.error }, auth.status);

/**
 * 校验管理员 Token。
 * Token 来源优先级：URL 参数 ?token= > 请求头 x-admin-token
 * 若未配置 env.ADMIN_TOKEN：
 *   - 默认拒绝（fail closed），避免端点裸奔
 */
export function requireAdmin(request, env) {
  const expected = env && env.ADMIN_TOKEN;
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: '未配置 ADMIN_TOKEN（Pages 项目 Settings → Functions → Environment variables 添加）',
    };
  }
  const url = new URL(request.url);
  const provided =
    (url.searchParams.get('token') || '') ||
    (request.headers.get('x-admin-token') || '');
  if (!provided || provided !== expected) {
    return { ok: false, status: 401, error: 'unauthorized：token 无效或缺失' };
  }
  return { ok: true };
}

/**
 * 宽松版：仅在配置了 ADMIN_TOKEN 时校验；未配置则放行。
 * 用于「被滥用损失很小」的端点（如 cron-report 日志上报）。
 */
export function requireAdminIfConfigured(request, env) {
  const expected = env && env.ADMIN_TOKEN;
  if (!expected) return { ok: true };
  const url = new URL(request.url);
  const provided =
    (url.searchParams.get('token') || '') ||
    (request.headers.get('x-admin-token') || '');
  if (!provided || provided !== expected) {
    return { ok: false, status: 401, error: 'unauthorized：token 无效或缺失' };
  }
  return { ok: true };
}

/** 通用 JSON 响应 */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** 邮箱格式校验 */
export function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));
}

/** 邮箱脱敏：保留首字符与域名，如 h***@qq.com */
export function maskEmail(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at < 1) return '***';
  return s.slice(0, 1) + '***' + s.slice(at);
}

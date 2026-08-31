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

/**
 * 判断 KV key 是否为「订阅者邮箱」。
 * 同一个 KV 命名空间里还存着系统数据，遍历订阅者时必须排除：
 *   cron-log            —— Worker 执行日志
 *   rl:*                —— 订阅限流记录
 *   digest-sent:*       —— 每日群发幂等标记
 * 新增系统 key 时务必在此登记，否则会被误当成订阅者群发。
 */
export function isSubscriberKey(name) {
  if (!name || typeof name !== 'string') return false;
  if (name === 'cron-log') return false;
  if (name.startsWith('rl:')) return false;
  if (name.startsWith('digest-sent:')) return false;
  return true;
}

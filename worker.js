/**
 * AI0571 定时任务 Worker（仅 Cron 触发，不处理 HTTP 请求）
 * ------------------------------------------------------------
 * v3 修复要点（针对 2026-09 日报静默故障）：
 *  1. 去掉「UTC 00:00~00:09」这种 10 分钟窄窗口。改为北京时间
 *     07:00~10:00 整整 3 小时的大窗口，每次 cron 命中都尝试，
 *     由 Pages 端 KV 幂等键 digest-sent:YYYY-MM-DD 保证当天只发一次。
 *  2. 发送通道双保险：
 *       通道A 直接发（需 Worker 绑定 SUBS + RESEND_API_KEY）
 *       通道B 调 Pages Function（只需 Worker 有 ADMIN_TOKEN）
 *     A 失败自动降级到 B，不会因为某一侧没绑定就完全静默。
 *  3. 每次 cron 都写心跳（cron-log）：优先写 KV，没绑 KV 就 HTTP
 *     上报 /api/cron-report。心跳里带齐 env 诊断（kvBound / resendKey /
 *     adminToken / ghPat），再也不会出现「Worker 到底跑没跑」的盲区。
 *     没有 ADMIN_TOKEN 时通过 URL 参数带的 token 会被拒绝 —— 所以请务必
 *     在 Worker Settings 里补上一个 ADMIN_TOKEN Secret。
 *  4. 触发 GitHub Actions 失败也能被看到（结果写进心跳）。
 *
 * 所需绑定（Worker Settings → Variables / KV Namespace Bindings）：
 *   SUBS            KV namespace (ai0571-subscribers)   —— 通道A / 心跳落盘
 *   RESEND_API_KEY  Secret                              —— 通道A
 *   ADMIN_TOKEN     Secret（与 Pages 侧同一个值）        —— 通道B / 心跳兜底
 *   GH_PAT          Secret（repo 权限 Actions:write）     —— 触发抓取
 */

const CAT = { HOT: '热门', MODEL: '大模型', FUNDING: '融资', INDUSTRY: '行业', MEDPHARMA: '医药AI', MEDDEVICE: '设备AI' };
const CATCOLOR = { HOT: '#F472B6', MODEL: '#8B5CF6', FUNDING: '#10B981', INDUSTRY: '#3B82F6', MEDPHARMA: '#EC4899', MEDDEVICE: '#14B8A6' };

const SITE = 'https://www.AI0571.com';
const BJ_OFFSET = 8 * 3600e3;

const CFG = {
  GH_OWNER: 'benhkkk',
  GH_REPO: 'AI0571-website',
  GH_WORKFLOW: 'daily-update.yml',
  // 北京时间早安窗口（含 DIGEST_START_HOUR，不含 DIGEST_END_HOUR）
  DIGEST_START_HOUR: 7,
  DIGEST_END_HOUR: 10,
};

/* -------------------- 基础工具 -------------------- */
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '')); }
function bjDate(ts) { return new Date((ts == null ? Date.now() : ts) + BJ_OFFSET); }
function bjStamp(ts) { return bjDate(ts).toISOString().replace('T', ' ').slice(0, 19); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    try { return AbortSignal.timeout(ms); } catch (_) { /* 某些运行时不支持 */ }
  }
  const c = new AbortController();
  setTimeout(() => { try { c.abort(); } catch (_) { /* noop */ } }, ms);
  return c.signal;
}
async function fetchText(url, init, ms = 20000) {
  const r = await fetch(url, Object.assign({ signal: timeoutSignal(ms) }, init || {}));
  const body = await r.text();
  return { ok: r.ok, status: r.status, body };
}

/* -------------------- 订阅者列表（KV）-------------------- */
async function listSubscribers(env) {
  if (!env.SUBS) throw new Error('Worker 未绑定 SUBS KV');
  const emails = [];
  let cursor;
  do {
    const opt = cursor ? { cursor } : {};
    const page = await env.SUBS.list(opt);
    for (const k of page.keys) {
      // 跳过系统 key：cron-log（心跳）/ digest-last（群发留痕）/ rl:*（限流）/ digest-sent:*（幂等）
      if (k.name === 'cron-log' || k.name === 'digest-last') continue;
      if (k.name.startsWith('rl:') || k.name.startsWith('digest-sent:')) continue;
      try {
        const v = JSON.parse(await env.SUBS.get(k.name));
        if (v && v.email) emails.push(v.email);
      } catch (_) { /* skip */ }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return emails;
}

/* -------------------- 邮件 HTML 模板 -------------------- */
function buildDigestHTML(data, email) {
  const news = (data.news || []).slice(0, 10);
  const dateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const unsub = `https://www.AI0571.com/api/unsubscribe?email=${encodeURIComponent(email || '')}`;
  const top = news[0] || {};

  const items = news.slice(1).map(n => {
    const c = CAT[n.c] || n.c;
    const col = CATCOLOR[n.c] || '#888';
    const time = (n.d || '').replace('T', ' ');
    const href = n.u || 'https://www.AI0571.com';
    return `<tr>
      <td style="padding:14px 18px;border-bottom:1px solid #eee;font-family:-apple-system,Segoe UI,Roboto,'PingFang SC','Microsoft YaHei',sans-serif;">
        <span style="display:inline-block;background:${col}1a;color:${col};font-size:12px;font-weight:700;padding:2px 9px;border-radius:999px;margin-right:8px;vertical-align:middle;">${esc(c)}</span>
        <a href="${esc(href)}" style="color:#111;font-size:15px;font-weight:600;text-decoration:none;vertical-align:middle;">${esc(n.t)}</a>
        <div style="color:#8a8a8a;font-size:12px;margin-top:5px;">${esc(time)}</div>
      </td>
    </tr>`;
  }).join('');

  const topTime = (top.d || '').replace('T', ' ');
  const topSummary = esc((top.s || '').slice(0, 140));
  const topHref = top.u || 'https://www.AI0571.com';

  return `<!doctype html>
<html lang="zh-CN"><body style="margin:0;background:#f4f5f7;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,'PingFang SC','Microsoft YaHei',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.06);">
    <tr><td style="background:linear-gradient(135deg,#6366F1,#8B5CF6);padding:26px 24px;color:#fff;">
      <div style="font-size:20px;font-weight:800;letter-spacing:.5px;">AI0571 · 每日 AI 日报</div>
      <div style="font-size:13px;opacity:.88;margin-top:6px;">${esc(dateStr)} · 全球 AI / 医药AI / 医疗设备AI 动态速览</div>
    </td></tr>
    ${top.t ? `<tr><td style="padding:20px 24px;">
      <div style="font-size:12px;color:#8B5CF6;font-weight:700;margin-bottom:7px;">今日头条</div>
      <a href="${esc(topHref)}" style="color:#111;font-size:18px;font-weight:800;text-decoration:none;line-height:1.4;">${esc(top.t)}</a>
      ${topSummary ? `<div style="color:#555;font-size:14px;line-height:1.65;margin-top:8px;">${topSummary}…</div>` : ''}
      <div style="color:#999;font-size:12px;margin-top:6px;">${esc(topTime)}</div>
    </td></tr>` : ''}
    <tr><td style="padding:0 0 6px;">
      <table width="100%" cellpadding="0" cellspacing="0">${items}</table>
    </td></tr>
    <tr><td style="padding:16px 24px;background:#fafafa;border-top:1px solid #eee;color:#999;font-size:12px;line-height:1.8;">
      由 <a href="https://www.AI0571.com" style="color:#6366F1;text-decoration:none;">AI0571.com</a> 自动发送 · 你在 AI0571 订阅了每日日报<br/>
      <a href="${unsub}" style="color:#6366F1;text-decoration:none;">退订此邮件</a>
    </td></tr>
  </table></body></html>`;
}

/* -------------------- 心跳：KV 优先，HTTP 兜底 -------------------- */
async function writeHeartbeat(env, entry) {
  const base = {
    ts: Date.now(),
    iso: new Date().toISOString(),
    beijing: bjStamp(),
    env: {
      kvBound: !!env.SUBS,
      hasResend: !!env.RESEND_API_KEY,
      hasAdminToken: !!env.ADMIN_TOKEN,
      hasGhPat: !!env.GH_PAT,
    },
    ...entry,
  };

  try {
    if (env.SUBS) {
      await env.SUBS.put('cron-log', JSON.stringify({ ...base, via: 'kv' }));
      return 'kv';
    }
  } catch (_) { /* 落到 HTTP 上报 */ }

  try {
    const payload = JSON.stringify(base).slice(0, 4000);
    const q = new URLSearchParams({ payload });
    if (env.ADMIN_TOKEN) q.set('token', env.ADMIN_TOKEN);
    const r = await fetchText(`${SITE}/api/cron-report?${q.toString()}`, { method: 'GET' }, 15000);
    if (r.ok) return 'http';
    return 'http-failed:' + r.status;
  } catch (e) {
    return 'http-error:' + String(e && e.message || e);
  }
}

/* -------------------- 通道A：Worker 直连 Resend -------------------- */
async function sendDailyDigestDirect(env) {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'missing RESEND_API_KEY' };

  let data;
  try {
    const r = await fetchText(`${SITE}/data.json`, {
      headers: { 'User-Agent': 'ai0571-worker' },
      cf: { cacheTtl: 0 },
    }, 20000);
    if (!r.ok) throw new Error('data.json HTTP ' + r.status);
    data = JSON.parse(r.body);
  } catch (e) {
    return { ok: false, error: 'fetch data.json failed: ' + String(e && e.message || e) };
  }

  const emails = (await listSubscribers(env)).filter(validEmail);
  if (!emails.length) return { ok: true, sent: 0, note: 'no subscribers' };

  const subject = `AI0571 每日 AI 日报 · ${new Date().toLocaleDateString('zh-CN')}`;
  const from = 'AI日报 <noreply@ai0571.com>';
  let sent = 0, failed = 0;
  const errors = [];

  for (const email of emails) {
    const html = buildDigestHTML(data, email);
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to: [email], subject, html }),
        signal: timeoutSignal(25000),
      });
      if (resp.ok) { sent++; } else {
        failed++;
        errors.push({ email: email.slice(0, 1) + '***' + email.slice(email.indexOf('@')), status: resp.status, body: (await resp.text()).slice(0, 200) });
      }
    } catch (e) {
      failed++;
      errors.push({ email: email.slice(0, 1) + '***' + email.slice(email.indexOf('@')), status: 0, body: String(e && e.message || e) });
    }
  }
  return { ok: sent > 0, sent, failed, total: emails.length, errors: errors.slice(0, 5) };
}

/* -------------------- 通道B：调 Pages Function 代为群发 -------------------- */
async function sendDailyDigestViaPages(env) {
  if (!env.ADMIN_TOKEN) return { ok: false, error: 'missing ADMIN_TOKEN' };
  const url = `${SITE}/api/send-digest?broadcast=1&via=worker&token=${encodeURIComponent(env.ADMIN_TOKEN)}`;
  try {
    const r = await fetchText(url, { method: 'GET', headers: { 'User-Agent': 'ai0571-worker' } }, 180000);
    let parsed = null;
    try { parsed = JSON.parse(r.body); } catch (_) { /* 非 JSON */ }
    return {
      ok: !!(r.ok && parsed && parsed.ok),
      httpStatus: r.status,
      skipped: !!(parsed && parsed.skipped),
      sent: parsed && parsed.sent,
      failed: parsed && parsed.failed,
      body: String(r.body || '').slice(0, 500),
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/** 尝试群发：先通道A，失败再降级通道B */
async function sendDigestWithFallback(env) {
  const attempts = [];
  const canDirect = !!(env.RESEND_API_KEY && env.SUBS);
  const canPages = !!env.ADMIN_TOKEN;

  if (canDirect) {
    const r = await sendDailyDigestDirect(env).catch(e => ({ ok: false, error: String(e && e.message || e) }));
    attempts.push({ channel: 'direct', ...r });
    if (r.ok) return { ok: true, channel: 'direct', attempts };
  }
  if (canPages) {
    const r = await sendDailyDigestViaPages(env).catch(e => ({ ok: false, error: String(e && e.message || e) }));
    attempts.push({ channel: 'pages', ...r });
    if (r.ok) return { ok: true, channel: 'pages', attempts };
  }
  return {
    ok: false,
    channel: 'none',
    error: !canDirect && !canPages
      ? 'Worker 既没有 SUBS+RESEND_API_KEY，也没有 ADMIN_TOKEN —— 无法发送，请到 Worker Settings 补齐绑定'
      : '所有可用通道均失败',
    attempts,
  };
}

/* -------------------- 触发 GitHub Actions 抓取 -------------------- */
async function triggerGithub(env) {
  const token = env.GH_PAT;
  if (!token) return { ok: false, status: 500, error: 'missing GH_PAT secret' };
  const owner = env.GH_OWNER || CFG.GH_OWNER;
  const repo = env.GH_REPO || CFG.GH_REPO;
  const wf = env.GH_WORKFLOW || CFG.GH_WORKFLOW;
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wf}/dispatches`;
  try {
    const r = await fetchText(url, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'ai0571-cron-trigger',
      },
      body: JSON.stringify({ ref: 'main' }),
    }, 25000);
    // 注意：204 只代表「运行被创建」，不代表运行成功。
    // 运行真正的结果请用 /api/health 或 GitHub Actions 页面查看。
    return { ok: r.status === 204, status: r.status, body: String(r.body || '').slice(0, 200) };
  } catch (e) {
    return { ok: false, status: 500, error: String(e && e.message || e) };
  }
}

/* -------------------- Cron 入口 -------------------- */
export default {
  async scheduled(event, env, ctx) {
    const start = Date.now();
    const cron = event.cron || '';
    const bj = bjDate();
    const dow = bj.getUTCDay();          // 北京时间 0=周日, 1..5=周一至周五
    const bjHour = bj.getUTCHours();
    const bjMin = bj.getUTCMinutes();
    const isWorkday = dow >= 1 && dow <= 5;
    // 宽窗口：北京时间 07:00 ~ 10:00 之间每次触发都尝试；由 KV 幂等键去重
    const inDigestWindow = isWorkday && bjHour >= CFG.DIGEST_START_HOUR && bjHour < CFG.DIGEST_END_HOUR;

    const timeInfo = { bj: bjStamp(), bjWeekday: dow, bjHour, bjMin, isWorkday, inDigestWindow };

    ctx.waitUntil((async () => {
      let digestResult = { attempted: false };

      if (inDigestWindow) {
        digestResult = { attempted: true, ...(await sendDigestWithFallback(env)) };
      }

      const ghResult = await triggerGithub(env);

      const via = await writeHeartbeat(env, {
        type: inDigestWindow ? 'sendDailyDigest' : 'cronTick',
        cron,
        ...timeInfo,
        digest: digestResult,
        github: ghResult,
        durationMs: Date.now() - start,
      });
      console.log(`[ai0571-worker] ${bjStamp()} via=${via} digestAttempted=${inDigestWindow} digestOk=${!!digestResult.ok} ghOk=${!!ghResult.ok}`);
    })());
  },
};

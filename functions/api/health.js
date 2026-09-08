// Pages Function: GET /api/health[?token=xxx][&ui=1]
// ------------------------------------------------------------
// 「日报链路 30 秒自检」端点：一个 URL 看全链路每一环是否活着。
//
// 检查项：
//   1. Pages Functions 是否部署（本端点能返回即活着）
//   2. ADMIN_TOKEN / RESEND_API_KEY / SUBS(KV) 是否绑定
//   3. 今天（北京日期）的群发幂等标记 digest-sent:YYYY-MM-DD 是否存在
//   4. 上次群发/上次尝试的结果（KV 键 digest-last）
//   5. Worker 心跳（cron-log）是否还在更新
//   6. data.json 资讯是否新鲜（多久没更新）
//   7. GitHub Actions 最近 10 次运行的结论（实时调 GitHub 公开 API，
//      无需登录即可看到 startup_failure 这类「整个调度死了」的故障）
//
// 鉴权：ADMIN_TOKEN 未配置时可直接访问；配置了则必须带 token。
// 输出：默认 JSON；加 &ui=1 返回一页中文「红绿灯」看板，方便非技术用户看。
// ------------------------------------------------------------
import { requireAdminIfConfigured, json, isSubscriberKey } from '../_lib/auth.js';

const GH_OWNER = 'benhkkk';
const GH_REPO = 'AI0571-website';
const GH_WORKFLOW = 'daily-update.yml';

const BJ_OFFSET = 8 * 3600e3;

function bjDate(ts) { return new Date((ts == null ? Date.now() : ts) + BJ_OFFSET); }
function bjStamp(ts) {
  return bjDate(ts).toISOString().replace('T', ' ').slice(0, 19);
}
function todayKey(ts) {
  return 'digest-sent:' + bjDate(ts).toISOString().slice(0, 10);
}
async function settle(promise) {
  try { return { ok: true, value: await promise }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

/** 统一的网络请求超时信号（避免自检端点被慢依赖拖死） */
function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    try { return AbortSignal.timeout(ms); } catch (_) { /* noop */ }
  }
  const c = new AbortController();
  setTimeout(() => { try { c.abort(); } catch (_) { /* noop */ } }, ms);
  return c.signal;
}

/** 订阅者数量（不返回任何邮箱，只报个数） */
async function countSubscribers(env) {
  if (!env.SUBS) return { ok: false, count: null, error: 'SUBS(KV) 未绑定' };
  try {
    let count = 0, cursor = null, guard = 0;
    do {
      const page = await env.SUBS.list(cursor ? { cursor } : {});
      count += page.keys.filter(k => isSubscriberKey(k.name)).length;
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor && ++guard < 20);
    return { ok: true, count };
  } catch (e) {
    return { ok: false, count: null, error: String(e && e.message || e) };
  }
}

/** 资讯新鲜度 */
async function checkData() {
  const r = await fetch('https://www.AI0571.com/data.json', {
    headers: { 'User-Agent': 'ai0571-health' },
    cf: { cacheTtl: 0, cacheEverything: false },
    signal: timeoutSignal(8000),
  });
  if (!r.ok) return { ok: false, status: r.status, error: 'data.json 不可访问' };
  const d = await r.json();
  const raw = d.updated || d.updatedAt || null;
  let updatedTs = null;
  if (raw) {
    const t = Date.parse(/Z$|[+-]\d\d:\d\d$/.test(raw) ? raw : raw + 'Z');
    if (!Number.isNaN(t)) updatedTs = t;
  }
  return {
    ok: true,
    updatedRaw: raw,
    updatedBeijing: updatedTs ? bjStamp(updatedTs) : null,
    staleHours: updatedTs ? +((Date.now() - updatedTs) / 3600e3).toFixed(1) : null,
    newsCount: (d.news || []).length,
  };
}

/** GitHub Actions 最近运行状况（公开 API，仓库是 public 所以无需鉴权） */
async function checkGithub() {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/runs?per_page=10`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'ai0571-health', 'Accept': 'application/vnd.github+json' },
    signal: timeoutSignal(8000),
  });
  if (!r.ok) return { ok: false, status: r.status, error: 'GitHub API 不可访问' };
  const d = await r.json();
  const runs = (d.workflow_runs || []).map(x => ({
    createdAt: x.created_at,
    createdBeijing: bjStamp(Date.parse(x.created_at)),
    event: x.event,
    status: x.status,
    conclusion: x.conclusion,
  }));
  const latest = runs[0] || null;
  const lastGood = runs.find(x => x.conclusion === 'success') || null;
  const failedRecent = runs.filter(x => x.conclusion && x.conclusion !== 'success' && x.conclusion !== 'skipped').length;
  return {
    ok: true,
    latest,
    lastSuccess: lastGood,
    failedInLast10: failedRecent,
    htmlUrl: `https://github.com/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW}`,
  };
}

/** 把各环结果汇总成中文结论 + 处置建议 */
function verdict({ rows }) {
  const problems = [];
  const warn = [];

  if (!rows.env.adminToken) warn.push({ item: 'ADMIN_TOKEN', fix: '本端点当前开放访问，建议在 Pages Settings 配上 ADMIN_TOKEN' });
  if (!rows.env.subscriptions) problems.push({ item: 'KV(SUBS) 未绑定', fix: 'Pages 项目 Settings → Functions → KV namespace binding：SUBS → ai0571-subscribers' });
  if (!rows.env.resendKey) problems.push({ item: 'RESEND_API_KEY 未配置', fix: 'Pages 项目 Settings → Environment variables 添加 Secret RESEND_API_KEY' });
  if (!rows.subscribers.ok) {
    problems.push({ item: '读取订阅者失败：' + rows.subscribers.error, fix: '检查 Pages 项目 Settings → Functions → KV 绑定 SUBS 是否指向 ai0571-subscribers' });
  } else if (rows.subscribers.count === 0) {
    problems.push({ item: '订阅者为 0', fix: '确认有人订阅；或 KV 绑定指向了别的命名空间' });
  }

  if (rows.github.ok) {
    const c = rows.github.latest && rows.github.latest.conclusion;
    if (c && c !== 'success') {
      problems.push({
        item: `GitHub Actions 最近一次运行 = ${c}`,
        fix: '打开 Actions 页面看是否 GitHub 已停用/受限（Settings → Actions → General）；' +
          '必要时联系 GitHub Support。Actions 不恢复则「抓取 + 日报」两条路都不会动。',
      });
    }
    if (rows.github.latest && rows.github.latest.createdAt) {
      const mins = (Date.now() - Date.parse(rows.github.latest.createdAt)) / 60000;
      if (mins > 120 && (!c || c === 'success')) {
        warn.push({ item: `最近一次 Actions 运行已是 ${Math.round(mins)} 分钟前`, fix: '检查 Actions 是否被停用（含配额/风控）' });
      }
    }
  } else {
    warn.push({ item: 'GitHub API 查询失败', fix: '可能是临时限流，稍后重试' });
  }

  if (rows.data.ok && rows.data.staleHours != null && rows.data.staleHours > 24) {
    problems.push({ item: `资讯已 ${rows.data.staleHours} 小时未更新`, fix: '多半是 Actions 抓取链路断了（见上一行）' });
  }

  if (rows.heartbeat.found) {
    const ageH = (Date.now() - rows.heartbeat.ts) / 3600e3;
    if (ageH > 26) {
      warn.push({ item: `Worker 心跳已 ${Math.round(ageH)} 小时未更新`, fix: 'Cloudflare Worker 可能未部署 / KV 与 ADMIN_TOKEN 都没绑，无法落心跳' });
    }
  } else {
    warn.push({
      item: 'Worker 无任何心跳日志（cron-log 为空）',
      fix: 'Worker 要么没跑，要么没绑 KV(SUBS) 且没有 ADMIN_TOKEN（HTTP 兜底上报需要同名 Secret）。' +
        '在 Worker Settings → Variables 添加 ADMIN_TOKEN 即可立刻有心跳。',
    });
  }

  const now = Date.now();
  const dow = bjDate(now).getUTCDay();     // 北京时间的星期
  const bjHour = bjDate(now).getUTCHours();
  const isWorkday = dow >= 1 && dow <= 5;
  const shouldHaveSent = isWorkday && bjHour >= 8 && bjHour <= 11;

  if (isWorkday && !rows.sentToday.sent) {
    if (shouldHaveSent) {
      problems.push({
        item: `今天（${todayKey(now).slice(12)}）还没发出日报`,
        fix: '看上面 Actions / Worker 心跳两行的结论；可临时手工补发（见 send-digest 端点）',
      });
    } else if (bjHour > 11) {
      warn.push({ item: '今天尚未发出日报', fix: '核对是否在节假日；否则按上面 Actions 结论处理' });
    }
  }

  const healthy = problems.length === 0;
  return { healthy, problems, warnings: warn, headline: healthy ? '全链路正常 ✅' : `发现 ${problems.length} 处问题 ❌` };
}

export async function onRequestGet({ request, env }) {
  const auth = requireAdminIfConfigured(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const url = new URL(request.url);
  const wantUI = url.searchParams.get('ui') === '1';

  const now = Date.now();
  const key = todayKey(now);

  const [ sentRaw, lastRaw, logRaw, subs, data, gh ] = await Promise.all([
    settle(env.SUBS ? env.SUBS.get(key) : Promise.resolve(null)),
    settle(env.SUBS ? env.SUBS.get('digest-last') : Promise.resolve(null)),
    settle(env.SUBS ? env.SUBS.get('cron-log') : Promise.resolve(null)),
    countSubscribers(env),
    settle(checkData()),
    settle(checkGithub()),
  ]);

  let sentInfo = { sent: false };
  if (sentRaw.ok && sentRaw.value) {
    try {
      const p = JSON.parse(sentRaw.value);
      sentInfo = { sent: true, sentAt: p.sentAt || null, sentBeijing: p.sentAt ? bjStamp(p.sentAt) : null, key };
    } catch (_) { sentInfo = { sent: true, key, raw: sentRaw.value }; }
  }

  let lastAttempt = { found: false };
  if (lastRaw.ok && lastRaw.value) {
    try { lastAttempt = { found: true, ...JSON.parse(lastRaw.value) }; }
    catch (_) { lastAttempt = { found: true, raw: lastRaw.value }; }
  }

  let heartbeat = { found: false };
  if (logRaw.ok && logRaw.value) {
    try {
      const e = JSON.parse(logRaw.value);
      heartbeat = {
        found: true,
        ts: e.ts || (e.iso ? Date.parse(e.iso) : null),
        beijing: e.iso ? bjStamp(Date.parse(e.iso)) : (e.ts ? bjStamp(e.ts) : null),
        type: e.type || null,
        via: e.via || 'kv',
        result: e.result || null,
      };
    } catch (_) { heartbeat = { found: true, raw: logRaw.value }; }
  }

  const report = {
    ok: true,
    now: { utc: new Date(now).toISOString(), beijing: bjStamp(now), weekday: '日一二三四五六'[bjDate(now).getUTCDay()] },
    env: {
      adminToken: !!env.ADMIN_TOKEN,
      resendKey: !!env.RESEND_API_KEY,
      subscriptions: !!env.SUBS,
    },
    todayKey: key,
    sentToday: sentInfo,
    lastDigestAttempt: lastAttempt,
    subscribers: subs,
    data: data.ok ? data.value : { ok: false, error: data.error },
    github: gh.ok ? gh.value : { ok: false, error: gh.error },
    heartbeat,
  };

  const v = verdict({
    rows: {
      env: report.env,
      subscribers: report.subscribers,
      github: report.github,
      data: report.data,
      heartbeat: report.heartbeat,
      sentToday: report.sentToday,
    },
  });
  report.verdict = v.headline;
  report.problems = v.problems;
  report.warnings = v.warnings;
  report.quickFix = {
    manualBroadcast: `https://www.AI0571.com/api/send-digest?broadcast=1&token=你的ADMIN_TOKEN`,
    dryRun: `https://www.AI0571.com/api/send-digest?broadcast=1&dry=1&token=你的ADMIN_TOKEN`,
    actionsPage: `https://github.com/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW}`,
  };

  if (wantUI) {
    return new Response(renderHTML(report), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  const res = json(report);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function chip(ok, text) {
  const bg = ok ? '#dcfce7' : '#fee2e2';
  const fg = ok ? '#166534' : '#991b1b';
  return `<span style="display:inline-block;background:${bg};color:${fg};padding:4px 10px;border-radius:999px;font-size:13px;font-weight:700;margin:2px 6px 2px 0;">${esc(text)}</span>`;
}

function renderHTML(r) {
  const rows = [
    ['①  站点 & Functions', !!r.ok],
    ['②  ADMIN_TOKEN', r.env.adminToken],
    ['③  RESEND_API_KEY', r.env.resendKey],
    ['④  KV(SUBS)', r.env.subscriptions],
    ['⑤  今日日报已发出', r.sentToday.sent],
    [`⑥  订阅者 ${r.subscribers.ok ? esc(r.subscribers.count) + ' 人' : '读取失败'}`, r.subscribers.ok && r.subscribers.count > 0],
    [`⑦  资讯新鲜度 ${r.data.ok && r.data.staleHours != null ? esc(r.data.staleHours) + ' 小时前' : '未知'}`, !!(r.data.ok && r.data.staleHours != null && r.data.staleHours < 24)],
    [`⑧  Worker 心跳 ${r.heartbeat.found ? esc(r.heartbeat.beijing || '') : '无'}`, !!(r.heartbeat.found)],
    [`⑨  GitHub Actions ${r.github.ok && r.github.latest ? esc(r.github.latest.conclusion) : '未知'}`, !!(r.github.ok && r.github.latest && r.github.latest.conclusion === 'success')],
  ];

  const problems = (r.problems || []).map(p =>
    `<li style="margin-bottom:8px;"><b style="color:#b91c1c;">${esc(p.item)}</b><br/><span style="color:#475569;">🔧 ${esc(p.fix)}</span></li>`).join('')
    || '<li style="color:#166534;">没有发现问题。</li>';
  const warns = (r.warnings || []).map(p =>
    `<li style="margin-bottom:6px;"><b style="color:#b45309;">${esc(p.item)}</b><br/><span style="color:#475569;">🔧 ${esc(p.fix)}</span></li>`).join('')
    || '<li style="color:#166534;">无。</li>';

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AI0571 日报链路自检</title></head>
<body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,'PingFang SC','Microsoft YaHei',sans-serif;">
<div style="max-width:820px;margin:0 auto;padding:20px 14px 40px;">
  <div style="background:linear-gradient(135deg,#6366F1,#8B5CF6);color:#fff;border-radius:16px;padding:22px 20px;">
    <div style="font-size:20px;font-weight:800;">AI0571 · 日报链路自检</div>
    <div style="font-size:13px;opacity:.9;margin-top:6px;">北京时间 ${esc(r.now.beijing)}（周${esc(r.now.weekday)}）</div>
    <div style="font-size:17px;font-weight:800;margin-top:12px;">${esc(r.verdict)}</div>
  </div>

  <div style="background:#fff;border-radius:16px;padding:18px 18px 6px;margin-top:14px;">
    <div style="font-size:14px;font-weight:800;color:#0f172a;margin-bottom:10px;">链路红绿灯</div>
    ${rows.map(([t, ok]) => `<div>${chip(ok, (ok ? '✅ ' : '❌ ') + t)}</div>`).join('')}
    <div style="height:10px;"></div>
  </div>

  <div style="background:#fff;border-radius:16px;padding:18px;margin-top:14px;">
    <div style="font-size:14px;font-weight:800;color:#0f172a;margin-bottom:10px;">需要处理的问题</div>
    <ul style="margin:0;padding-left:18px;color:#334155;font-size:14px;line-height:1.7;">${problems}</ul>
  </div>

  <div style="background:#fff;border-radius:16px;padding:18px;margin-top:14px;">
    <div style="font-size:14px;font-weight:800;color:#0f172a;margin-bottom:10px;">提示 / 次要</div>
    <ul style="margin:0;padding-left:18px;color:#334155;font-size:14px;line-height:1.7;">${warns}</ul>
  </div>

  <div style="background:#fff;border-radius:16px;padding:18px;margin-top:14px;font-size:13px;color:#475569;line-height:1.9;">
    <div style="font-weight:800;color:#0f172a;margin-bottom:8px;">明细</div>
    今日幂等键：<code>${esc(r.todayKey)}</code><br/>
    上次群发尝试：<code>${esc(r.lastDigestAttempt.found ? JSON.stringify(r.lastDigestAttempt) : '无记录')}</code><br/>
    资讯更新时间：${esc(r.data.ok ? (r.data.updatedBeijing || r.data.updatedRaw) : '读取失败')}<br/>
    Actions 最近一次：${esc(r.github.ok && r.github.latest ? `${r.github.latest.createdBeijing} · ${r.github.latest.event} · ${r.github.latest.conclusion}` : '未知')}<br/>
    Actions 最近一次成功：${esc(r.github.ok && r.github.lastSuccess ? r.github.lastSuccess.createdBeijing : '未知')}<br/>
    <div style="margin-top:10px;"><a style="color:#6366F1;" href="${esc(r.github.ok ? r.github.htmlUrl : '#')}">打开 GitHub Actions 页面 →</a></div>
  </div>
</div></body></html>`;
}

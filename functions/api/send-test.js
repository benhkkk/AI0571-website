// Pages Function: GET /api/send-test?to=邮箱&token=管理员令牌 -> 立即发一封日报邮件（调试用）
// 绑定：Pages 项目 Settings -> Functions -> KV "SUBS" + Secret "RESEND_API_KEY" + "ADMIN_TOKEN"
//
// ⚠️ 必须鉴权：无保护的发信端点等于「开放邮件中继」，任何人都能用 ai0571.com
//    域名对外发信，会导致域名进黑名单、Resend 额度被刷光。
import { requireAdmin, json, validEmail } from '../_lib/auth.js';

const CAT = { HOT: '热门', MODEL: '大模型', FUNDING: '融资', INDUSTRY: '行业', MEDPHARMA: '医药AI', MEDDEVICE: '设备AI' };
const CATCOLOR = { HOT: '#F472B6', MODEL: '#8B5CF6', FUNDING: '#10B981', INDUSTRY: '#3B82F6', MEDPHARMA: '#EC4899', MEDDEVICE: '#14B8A6' };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function buildDigestHTML(data, email) {
  const news = (data.news || []).slice(0, 10);
  const dateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const unsub = `https://www.AI0571.com/api/unsubscribe?email=${encodeURIComponent(email || '')}`;
  const top = news[0] || {};

  const items = news.slice(1).map(n => {
    const c = CAT[n.c] || n.c;
    const col = CATCOLOR[n.c] || '#888';
    const time = (n.d || '').replace('T', ' ');
    // 无原文链接时降级为站点首页，避免出现 href="#"
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

export async function onRequestGet({ request, env }) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const url = new URL(request.url);
  const to = String(url.searchParams.get('to') || '').trim();
  if (!env.RESEND_API_KEY) return json({ ok: false, error: 'missing RESEND_API_KEY (在 Pages 项目 Settings 配置)' }, 500);
  if (!validEmail(to)) return json({ ok: false, error: '请提供 ?to=有效邮箱' }, 400);

  let data;
  try {
    const r = await fetch('https://www.AI0571.com/data.json', { cache: 'no-store' });
    data = await r.json();
  } catch (e) {
    return json({ ok: false, error: 'fetch data.json failed: ' + String(e) }, 500);
  }

  const subject = `AI0571 每日 AI 日报 · ${new Date().toLocaleDateString('zh-CN')}`;
  const html = buildDigestHTML(data, to);

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: 'AI日报 <noreply@ai0571.com>', to: [to], subject, html }),
    });
    const txt = await resp.text();
    return json({ ok: resp.ok, status: resp.status, res: txt.slice(0, 400) });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

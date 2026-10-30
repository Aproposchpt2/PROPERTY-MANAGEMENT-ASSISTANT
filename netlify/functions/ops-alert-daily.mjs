// Scheduled daily at 14:05 UTC: settles open agent runs, then emails a summary if
// any script from today's daily runs (backend 13:17, agent 13:25) failed or errored.
// Recipient: OPS_ALERT_EMAIL, else OWNER_NOTIFICATION_EMAIL. Sent with Resend.
import { db, listScripts, refreshOpenRuns } from './lib/ops-core.mjs';

const PANEL = 'https://pma.stellaruc.com/admin/testing';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default async () => {
  await refreshOpenRuns({ force: true });
  const since = new Date(Date.now() - 2 * 3600e3).toISOString();
  const { data: runs, error } = await db().from('ops_test_runs').select('*').gte('started_at', since).order('started_at', { ascending: false });
  if (error) { console.error('[ops-alert-daily]', error.message); return; }

  const scripts = Object.fromEntries((await listScripts()).map((s) => [s.id, s]));
  const latest = {};
  for (const r of runs || []) if (!latest[r.script_id]) latest[r.script_id] = r;
  const rows = Object.values(latest).map((r) => ({ run: r, script: scripts[r.script_id] })).filter((x) => x.script);
  const bad = rows.filter((x) => ['fail', 'error'].includes(x.run.status));
  const warn = rows.filter((x) => x.run.status === 'warn');
  const open = rows.filter((x) => ['queued', 'running'].includes(x.run.status));
  const passed = rows.filter((x) => x.run.status === 'pass').length;
  console.log('[ops-alert-daily]', JSON.stringify({ total: rows.length, passed, failed: bad.length, warned: warn.length, open: open.length }));
  if (!bad.length) return;

  const env = process.env;
  const to = env.OPS_ALERT_EMAIL || env.OWNER_NOTIFICATION_EMAIL;
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL || !to) { console.error('[ops-alert-daily] email not configured'); return; }

  const line = (x) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee"><b>${esc(x.script.name)}</b><br><span style="color:#777">${esc(x.script.product)} · ${esc(x.script.layer)}</span></td><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(x.run.status.toUpperCase())}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(x.run.summary)}</td></tr>`;
  const table = (list) => `<table style="border-collapse:collapse;font:14px Arial,sans-serif;width:100%">${list.map(line).join('')}</table>`;
  const html = `<div style="font:14px Arial,sans-serif;color:#222">
    <p><b>${bad.length} of ${rows.length}</b> simulation test scripts failed in today's daily run (${passed} passed${warn.length ? `, ${warn.length} warning` : ''}${open.length ? `, ${open.length} still running` : ''}).</p>
    ${table(bad)}
    ${warn.length ? `<p style="margin-top:18px"><b>Warnings</b></p>${table(warn)}` : ''}
    <p style="margin-top:18px"><a href="${PANEL}">Open the testing panel</a></p></div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: to.split(',').map((s) => s.trim()).filter(Boolean), subject: `Simulation tests: ${bad.length} failing`, html }),
  });
  console.log('[ops-alert-daily] email status', res.status);
};

export const config = { schedule: '5 14 * * *' };

'use strict';

// Push notifications to managers' phones (PMA mobile app) through Expo's push service.
// Kinds: newCase, emergency, approval. Recipients are active OWNER/ADMIN users of the tenant
// plus MANAGER users with access to the property (same rule as lib/pma-auth.js), filtered by
// each device's preferences. Best effort: never throws, so filing a case or a quote is never
// held up by a push failure. Staff texts continue alongside, unchanged.

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const KINDS = ['newCase', 'emergency', 'approval'];
const TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;
const CHUNK = 100;

let fetchOverride = null; // test hook

function makeDb(env) {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Devices that should get a push of this kind for this property.
async function recipients({ db, tenantId, propertyId, kind }) {
  const { data: tokens, error } = await db.from('pma_push_tokens')
    .select('id, token, tenant_user_id, prefs')
    .eq('tenant_id', tenantId).eq('enabled', true);
  if (error) throw error;
  const wanted = (tokens || []).filter(t => !t.prefs || t.prefs[kind] !== false);
  if (!wanted.length) return [];
  const ids = [...new Set(wanted.map(t => t.tenant_user_id))];
  const { data: users, error: uErr } = await db.from('tenant_users')
    .select('id, role').eq('tenant_id', tenantId).eq('status', 'ACTIVE').in('id', ids);
  if (uErr) throw uErr;
  const role = new Map((users || []).map(u => [u.id, u.role]));
  const managers = ids.filter(id => role.get(id) === 'MANAGER');
  let access = new Set();
  if (managers.length) {
    const { data: rows, error: aErr } = await db.from('pma_staff_property_access')
      .select('tenant_user_id').eq('property_id', propertyId).in('tenant_user_id', managers);
    if (aErr) throw aErr;
    access = new Set((rows || []).map(r => r.tenant_user_id));
  }
  return wanted.filter(t => {
    const r = role.get(t.tenant_user_id);
    return r === 'OWNER' || r === 'ADMIN' || (r === 'MANAGER' && access.has(t.tenant_user_id));
  });
}

// POST messages to Expo in chunks. Returns { sent, failed, dead: [tokenRowId] }.
async function sendToExpo(messages, env) {
  const doFetch = fetchOverride || fetch;
  const headers = { accept: 'application/json', 'content-type': 'application/json' };
  if (env.EXPO_ACCESS_TOKEN) headers.authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
  let sent = 0, failed = 0;
  const dead = [];
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    try {
      const res = await doFetch(EXPO_PUSH_URL, {
        method: 'POST', headers,
        body: JSON.stringify(chunk.map(({ rowId, ...m }) => m)),
        signal: AbortSignal.timeout(5000),
      });
      const body = await res.json().catch(() => null);
      const tickets = (body && Array.isArray(body.data)) ? body.data : [];
      if (!res.ok || tickets.length !== chunk.length) { failed += chunk.length; continue; }
      tickets.forEach((t, j) => {
        if (t && t.status === 'ok') { sent++; return; }
        failed++;
        if (t && t.details && t.details.error === 'DeviceNotRegistered') dead.push(chunk[j].rowId);
      });
    } catch (err) {
      failed += chunk.length;
      console.error(JSON.stringify({ event: 'pma_push_send_failed', error: err?.message }));
    }
  }
  return { sent, failed, dead };
}

// Send one notification of `kind` to every eligible manager device.
// Returns { state, sent, failed } with state DISABLED, NO_RECIPIENTS, SENT, PARTIAL or FAILED.
async function notifyManagers({ env, kind, title, body, data = {}, db = null, tenantId, propertyId }) {
  if (env.PMA_PUSH_ENABLED !== 'true') return { state: 'DISABLED', sent: 0, failed: 0 };
  if (!KINDS.includes(kind)) return { state: 'FAILED', sent: 0, failed: 0 };
  const t = tenantId || env.PMA_TENANT_ID;
  const p = propertyId || env.PMA_PROPERTY_ID;
  try {
    const client = db || makeDb(env);
    const list = await recipients({ db: client, tenantId: t, propertyId: p, kind });
    if (!list.length) return { state: 'NO_RECIPIENTS', sent: 0, failed: 0 };
    const messages = list.filter(r => TOKEN_RE.test(r.token)).map(r => ({
      rowId: r.id,
      to: r.token,
      title: String(title).slice(0, 120),
      body: String(body).slice(0, 240),
      data: { ...data, kind },
      sound: 'default',
      priority: 'high',
      channelId: kind === 'emergency' ? 'emergency' : 'cases',
    }));
    const result = await sendToExpo(messages, env);
    if (result.dead.length) {
      await client.from('pma_push_tokens')
        .update({ enabled: false, last_error: 'DeviceNotRegistered', updated_at: new Date().toISOString() })
        .in('id', result.dead)
        .then(() => {}, () => {});
    }
    console.log(JSON.stringify({ event: 'pma_push_sent', kind, sent: result.sent, failed: result.failed, disabled: result.dead.length }));
    const state = result.failed === 0 ? 'SENT' : result.sent > 0 ? 'PARTIAL' : 'FAILED';
    return { state, sent: result.sent, failed: result.failed };
  } catch (err) {
    console.error(JSON.stringify({ event: 'pma_push_failed', kind, error: err?.message }));
    return { state: 'FAILED', sent: 0, failed: 0 };
  }
}

// A case was just filed (by phone or in the app). Replays of the same case push nothing.
function pushNewCase({ result, args, env }) {
  if (!result || !result.success || result.replayed) return Promise.resolve({ state: 'SKIPPED', sent: 0, failed: 0 });
  const urgent = !!result.urgentReviewRequired;
  const unit = args && args.reportedUnit ? `Unit ${args.reportedUnit}` : '';
  const where = [args && args.reportedAddress, unit].filter(Boolean).join(' · ');
  return notifyManagers({
    env,
    kind: urgent ? 'emergency' : 'newCase',
    title: urgent ? `EMERGENCY: case #${result.caseNumber}` : `New case #${result.caseNumber}`,
    body: urgent
      ? `${where}${where ? ' — ' : ''}${String((args && args.description) || '').slice(0, 120)}`
      : `${where || 'New maintenance request'}. Tap to review.`,
    data: { requestId: result.requestId || null, caseNumber: result.caseNumber || null },
  });
}

// A provider's quote is over the pre-approved limit and waits for a manager.
function pushApprovalNeeded({ env, requestId, caseNumber, amount }) {
  const money = Number.isFinite(Number(amount)) ? `$${Number(amount).toFixed(2)}` : 'A quote';
  return notifyManagers({
    env,
    kind: 'approval',
    title: `Cost approval needed: case #${caseNumber}`,
    body: `${money} is over the pre-approved limit. Tap to approve or decline.`,
    data: { requestId: requestId || null, caseNumber: caseNumber || null },
  });
}

// ── Device registration (called by /api/manager/push-token after verifyManager) ──

const DEFAULT_PREFS = { newCase: true, emergency: true, approval: true };

function cleanPrefs(input, base = DEFAULT_PREFS) {
  const out = { ...DEFAULT_PREFS, ...base };
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const k of KINDS) if (typeof input[k] === 'boolean') out[k] = input[k];
  }
  return out;
}

// Register or refresh this device for the signed-in manager. A token already registered by
// someone else (a shared phone) moves to the current user. Keeps saved preferences unless
// new ones are given. Returns { status, body }.
async function registerDevice({ db, env, auth, token, platform, prefs }) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token) || token.length > 200) return { status: 400, body: { error: 'Invalid push token' } };
  if (platform !== 'ios' && platform !== 'android') return { status: 400, body: { error: 'platform must be ios or android' } };
  const { data: existing, error: selErr } = await db.from('pma_push_tokens')
    .select('id, user_id, prefs').eq('token', token).maybeSingle();
  if (selErr) throw selErr;
  const sameUser = existing && existing.user_id === auth.authUserId;
  const merged = cleanPrefs(prefs, sameUser ? existing.prefs || {} : DEFAULT_PREFS);
  const row = {
    tenant_id: env.PMA_TENANT_ID, tenant_user_id: auth.tenantUserId, user_id: auth.authUserId,
    token, platform, prefs: merged, enabled: true, last_error: null, updated_at: new Date().toISOString(),
  };
  const { error } = await db.from('pma_push_tokens').upsert(row, { onConflict: 'token' });
  if (error) throw error;
  return { status: 200, body: { success: true, prefs: merged, enabled: env.PMA_PUSH_ENABLED === 'true' } };
}

// Remove this device for the signed-in manager (on sign-out). Only their own rows.
async function removeDevice({ db, auth, token }) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return { status: 400, body: { error: 'Invalid push token' } };
  const { error } = await db.from('pma_push_tokens').delete().eq('token', token).eq('user_id', auth.authUserId);
  if (error) throw error;
  return { status: 200, body: { success: true } };
}

// Send a test notification to the signed-in manager's own devices only.
async function sendTestPush({ db, env, auth }) {
  if (env.PMA_PUSH_ENABLED !== 'true') return { status: 200, body: { success: false, state: 'DISABLED' } };
  const { data, error } = await db.from('pma_push_tokens')
    .select('id, token').eq('user_id', auth.authUserId).eq('tenant_id', env.PMA_TENANT_ID).eq('enabled', true);
  if (error) throw error;
  const rows = (data || []).filter(r => TOKEN_RE.test(r.token));
  if (!rows.length) return { status: 200, body: { success: false, state: 'NO_DEVICES' } };
  const result = await sendToExpo(rows.map(r => ({
    rowId: r.id, to: r.token, title: 'PMA test notification', body: 'Case alerts will appear like this.',
    data: { kind: 'test' }, sound: 'default', priority: 'high', channelId: 'cases',
  })), env);
  return { status: 200, body: { success: result.sent > 0, state: result.sent > 0 ? 'SENT' : 'FAILED', sent: result.sent } };
}

module.exports = {
  notifyManagers, pushNewCase, pushApprovalNeeded, recipients, sendToExpo, KINDS, TOKEN_RE,
  registerDevice, removeDevice, sendTestPush, cleanPrefs, DEFAULT_PREFS,
  _test: { setFetch: (f) => { fetchOverride = f; } },
};

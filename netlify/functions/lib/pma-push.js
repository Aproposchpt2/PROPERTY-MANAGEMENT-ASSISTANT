'use strict';

// Push notifications to managers: phones through Expo's push service, and browsers (the web app
// at /app, installed to the home screen) through standard Web Push with VAPID keys.
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

// Devices that should get a push of this kind for this property: phone tokens by default, or
// browser subscriptions with table 'pma_web_push_subscriptions'.
async function recipients({ db, tenantId, propertyId, kind, table = 'pma_push_tokens' }) {
  const columns = table === 'pma_web_push_subscriptions'
    ? 'id, endpoint, p256dh, auth, tenant_user_id, prefs'
    : 'id, token, tenant_user_id, prefs';
  const { data: tokens, error } = await db.from(table)
    .select(columns)
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

// ── Web push (managers using the web app at /app) ───────────────────────────────

let webPushOverride = null; // test hook

function webPushConfigured(env) {
  return !!(env.PMA_WEB_PUSH_PUBLIC_KEY && env.PMA_WEB_PUSH_PRIVATE_KEY && env.PMA_WEB_PUSH_SUBJECT);
}

// Send one payload to browser subscriptions. Returns { sent, failed, dead: [rowId] }.
// 404/410 from the browser's push service mean the subscription is gone.
async function sendToWeb(rows, payload, env, urgency = 'normal') {
  if (!rows.length || !webPushConfigured(env)) return { sent: 0, failed: 0, dead: [] };
  const webpush = webPushOverride || require('web-push');
  const options = {
    TTL: 3600,
    urgency,
    timeout: 5000,
    vapidDetails: {
      subject: env.PMA_WEB_PUSH_SUBJECT,
      publicKey: env.PMA_WEB_PUSH_PUBLIC_KEY,
      privateKey: env.PMA_WEB_PUSH_PRIVATE_KEY,
    },
  };
  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(rows.map(r => webpush.sendNotification(
    { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, body, options,
  )));
  let sent = 0, failed = 0;
  const dead = [];
  results.forEach((res, i) => {
    if (res.status === 'fulfilled') { sent++; return; }
    failed++;
    const code = res.reason && res.reason.statusCode;
    if (code === 404 || code === 410) dead.push(rows[i].id);
  });
  return { sent, failed, dead };
}

async function disableRows(client, table, ids, reason) {
  if (!ids.length) return;
  await client.from(table)
    .update({ enabled: false, last_error: reason, updated_at: new Date().toISOString() })
    .in('id', ids)
    .then(() => {}, () => {});
}

// Send one notification of `kind` to every eligible manager device: phones (Expo) and
// browsers (web push). Returns { state, sent, failed } with state DISABLED, NO_RECIPIENTS,
// SENT, PARTIAL or FAILED.
async function notifyManagers({ env, kind, title, body, data = {}, db = null, tenantId, propertyId }) {
  if (env.PMA_PUSH_ENABLED !== 'true') return { state: 'DISABLED', sent: 0, failed: 0 };
  if (!KINDS.includes(kind)) return { state: 'FAILED', sent: 0, failed: 0 };
  const t = tenantId || env.PMA_TENANT_ID;
  const p = propertyId || env.PMA_PROPERTY_ID;
  try {
    const client = db || makeDb(env);
    const phones = await recipients({ db: client, tenantId: t, propertyId: p, kind });
    // Browser subscriptions are optional: a missing table or failed lookup never blocks phones.
    let browsers = [];
    if (webPushConfigured(env)) {
      browsers = await recipients({ db: client, tenantId: t, propertyId: p, kind, table: 'pma_web_push_subscriptions' })
        .catch((err) => { console.error(JSON.stringify({ event: 'pma_web_push_lookup_failed', error: err?.message })); return []; });
    }
    if (!phones.length && !browsers.length) return { state: 'NO_RECIPIENTS', sent: 0, failed: 0 };
    const cleanTitle = String(title).slice(0, 120);
    const cleanBody = String(body).slice(0, 240);
    const messages = phones.filter(r => TOKEN_RE.test(r.token)).map(r => ({
      rowId: r.id,
      to: r.token,
      title: cleanTitle,
      body: cleanBody,
      data: { ...data, kind },
      sound: 'default',
      priority: 'high',
      channelId: kind === 'emergency' ? 'emergency' : 'cases',
    }));
    const [native, web] = await Promise.all([
      messages.length ? sendToExpo(messages, env) : { sent: 0, failed: 0, dead: [] },
      sendToWeb(browsers, { title: cleanTitle, body: cleanBody, data: { ...data, kind } }, env, kind === 'emergency' ? 'high' : 'normal'),
    ]);
    await Promise.all([
      disableRows(client, 'pma_push_tokens', native.dead, 'DeviceNotRegistered'),
      disableRows(client, 'pma_web_push_subscriptions', web.dead, 'SubscriptionGone'),
    ]);
    const sent = native.sent + web.sent;
    const failed = native.failed + web.failed;
    console.log(JSON.stringify({ event: 'pma_push_sent', kind, sent, failed, phones: native.sent, browsers: web.sent, disabled: native.dead.length + web.dead.length }));
    const state = failed === 0 ? 'SENT' : sent > 0 ? 'PARTIAL' : 'FAILED';
    return { state, sent, failed };
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

// ── Browser registration (called by /api/manager/web-push after verifyManager) ──

const B64URL_RE = /^[A-Za-z0-9_-]+=*$/;

// Accept a browser PushSubscription ({ endpoint, keys: { p256dh, auth } }) for the signed-in
// manager. Same rules as phones: keeps own prefs, moves a shared browser to the new user.
async function registerWebSubscription({ db, env, auth, subscription, prefs }) {
  const s = subscription && typeof subscription === 'object' ? subscription : {};
  const keys = s.keys && typeof s.keys === 'object' ? s.keys : {};
  let endpointOk = false;
  try { endpointOk = typeof s.endpoint === 'string' && s.endpoint.length <= 1000 && new URL(s.endpoint).protocol === 'https:'; } catch { endpointOk = false; }
  if (!endpointOk) return { status: 400, body: { error: 'Invalid push subscription' } };
  if (typeof keys.p256dh !== 'string' || !B64URL_RE.test(keys.p256dh) || keys.p256dh.length < 20 || keys.p256dh.length > 200
    || typeof keys.auth !== 'string' || !B64URL_RE.test(keys.auth) || keys.auth.length < 8 || keys.auth.length > 100) {
    return { status: 400, body: { error: 'Invalid push subscription keys' } };
  }
  const { data: existing, error: selErr } = await db.from('pma_web_push_subscriptions')
    .select('id, user_id, prefs').eq('endpoint', s.endpoint).maybeSingle();
  if (selErr) throw selErr;
  const sameUser = existing && existing.user_id === auth.authUserId;
  const merged = cleanPrefs(prefs, sameUser ? existing.prefs || {} : DEFAULT_PREFS);
  const row = {
    tenant_id: env.PMA_TENANT_ID, tenant_user_id: auth.tenantUserId, user_id: auth.authUserId,
    endpoint: s.endpoint, p256dh: keys.p256dh, auth: keys.auth,
    prefs: merged, enabled: true, last_error: null, updated_at: new Date().toISOString(),
  };
  const { error } = await db.from('pma_web_push_subscriptions').upsert(row, { onConflict: 'endpoint' });
  if (error) throw error;
  return { status: 200, body: { success: true, prefs: merged, enabled: env.PMA_PUSH_ENABLED === 'true' && webPushConfigured(env) } };
}

async function removeWebSubscription({ db, auth, endpoint }) {
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || endpoint.length > 1000) {
    return { status: 400, body: { error: 'Invalid push subscription' } };
  }
  const { error } = await db.from('pma_web_push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', auth.authUserId);
  if (error) throw error;
  return { status: 200, body: { success: true } };
}

// Send a test notification to the signed-in manager's own phones and browsers only.
async function sendTestPush({ db, env, auth }) {
  if (env.PMA_PUSH_ENABLED !== 'true') return { status: 200, body: { success: false, state: 'DISABLED' } };
  const { data, error } = await db.from('pma_push_tokens')
    .select('id, token').eq('user_id', auth.authUserId).eq('tenant_id', env.PMA_TENANT_ID).eq('enabled', true);
  if (error) throw error;
  const rows = (data || []).filter(r => TOKEN_RE.test(r.token));
  let browsers = [];
  if (webPushConfigured(env)) {
    const { data: subs, error: wErr } = await db.from('pma_web_push_subscriptions')
      .select('id, endpoint, p256dh, auth').eq('user_id', auth.authUserId).eq('tenant_id', env.PMA_TENANT_ID).eq('enabled', true);
    if (wErr) throw wErr;
    browsers = subs || [];
  }
  if (!rows.length && !browsers.length) return { status: 200, body: { success: false, state: 'NO_DEVICES' } };
  const title = 'PMA test notification';
  const body = 'Case alerts will appear like this.';
  const [native, web] = await Promise.all([
    rows.length ? sendToExpo(rows.map(r => ({
      rowId: r.id, to: r.token, title, body, data: { kind: 'test' }, sound: 'default', priority: 'high', channelId: 'cases',
    })), env) : { sent: 0, failed: 0, dead: [] },
    sendToWeb(browsers, { title, body, data: { kind: 'test' } }, env),
  ]);
  await disableRows(db, 'pma_web_push_subscriptions', web.dead, 'SubscriptionGone');
  const sent = native.sent + web.sent;
  return { status: 200, body: { success: sent > 0, state: sent > 0 ? 'SENT' : 'FAILED', sent } };
}

module.exports = {
  notifyManagers, pushNewCase, pushApprovalNeeded, recipients, sendToExpo, sendToWeb, KINDS, TOKEN_RE,
  registerDevice, removeDevice, registerWebSubscription, removeWebSubscription, sendTestPush,
  cleanPrefs, DEFAULT_PREFS, webPushConfigured,
  _test: { setFetch: (f) => { fetchOverride = f; }, setWebPush: (w) => { webPushOverride = w; } },
};

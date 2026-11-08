'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const push = require('../netlify/functions/lib/pma-push');

// In-memory stand-in for the supabase-js query builder: select/eq/in/maybeSingle/upsert/update/delete.
function memoryDb(tables) {
  const log = [];
  function from(name) {
    const rows = tables[name] || (tables[name] = []);
    const filters = [];
    let op = 'select', payload = null, upsertKey = null;
    const match = (r) => filters.every(([k, v, kind]) => (kind === 'in' ? v.includes(r[k]) : r[k] === v));
    const run = () => {
      log.push([name, op, filters.map(f => f.slice(0, 2)), payload]);
      if (op === 'select') return { data: rows.filter(match), error: null };
      if (op === 'update') { rows.filter(match).forEach(r => Object.assign(r, payload)); return { error: null }; }
      if (op === 'delete') { for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i])) rows.splice(i, 1); return { error: null }; }
      if (op === 'upsert') {
        const hit = rows.find(r => r[upsertKey] === payload[upsertKey]);
        if (hit) Object.assign(hit, payload); else rows.push({ id: `row_${rows.length + 1}`, ...payload });
        return { error: null };
      }
      return { error: null };
    };
    const q = {
      select: () => { op = op === 'select' ? 'select' : op; return q; },
      eq: (k, v) => { filters.push([k, v, 'eq']); return q; },
      in: (k, v) => { filters.push([k, v, 'in']); return q; },
      update: (p) => { op = 'update'; payload = p; return q; },
      delete: () => { op = 'delete'; return q; },
      upsert: (p, o) => { op = 'upsert'; payload = p; upsertKey = o.onConflict; return Promise.resolve(run()); },
      maybeSingle: () => { const r = run(); return Promise.resolve({ data: r.data[0] || null, error: null }); },
      then: (ok, bad) => Promise.resolve(run()).then(ok, bad),
    };
    return q;
  }
  return { db: { from }, log, tables };
}

const tok = (s) => `ExponentPushToken[${s}]`;
const env = { PMA_PUSH_ENABLED: 'true', PMA_TENANT_ID: 't1', PMA_PROPERTY_ID: 'p1' };

function world() {
  return memoryDb({
    pma_push_tokens: [
      { id: 'k_owner', tenant_id: 't1', tenant_user_id: 'tu_owner', user_id: 'u_owner', token: tok('owner'), enabled: true, prefs: { newCase: true, emergency: true, approval: true } },
      { id: 'k_mgr', tenant_id: 't1', tenant_user_id: 'tu_mgr', user_id: 'u_mgr', token: tok('mgr'), enabled: true, prefs: { newCase: false, emergency: true, approval: true } },
      { id: 'k_mgr_other', tenant_id: 't1', tenant_user_id: 'tu_mgr2', user_id: 'u_mgr2', token: tok('mgr2'), enabled: true, prefs: {} },
      { id: 'k_inactive', tenant_id: 't1', tenant_user_id: 'tu_gone', user_id: 'u_gone', token: tok('gone'), enabled: true, prefs: {} },
      { id: 'k_off', tenant_id: 't1', tenant_user_id: 'tu_owner', user_id: 'u_owner', token: tok('off'), enabled: false, prefs: {} },
      { id: 'k_tenant2', tenant_id: 't2', tenant_user_id: 'tu_x', user_id: 'u_x', token: tok('x'), enabled: true, prefs: {} },
    ],
    tenant_users: [
      { id: 'tu_owner', tenant_id: 't1', role: 'OWNER', status: 'ACTIVE' },
      { id: 'tu_mgr', tenant_id: 't1', role: 'MANAGER', status: 'ACTIVE' },
      { id: 'tu_mgr2', tenant_id: 't1', role: 'MANAGER', status: 'ACTIVE' },
      { id: 'tu_gone', tenant_id: 't1', role: 'ADMIN', status: 'SUSPENDED' },
    ],
    pma_staff_property_access: [
      { tenant_user_id: 'tu_mgr', property_id: 'p1' },
      { tenant_user_id: 'tu_mgr2', property_id: 'p_other' },
    ],
  });
}

let sentBatches = [];
function expoReplies(fn) {
  push._test.setFetch(async (url, init) => {
    const msgs = JSON.parse(init.body);
    sentBatches.push({ url, headers: init.headers, msgs });
    return { ok: true, json: async () => ({ data: msgs.map(fn) }) };
  });
}
const allOk = () => ({ status: 'ok', id: 'tkt' });

test('recipients: owners/admins always, managers only with property access, by preference', async () => {
  const { db } = world();
  const ids = async (kind) => (await push.recipients({ db, tenantId: 't1', propertyId: 'p1', kind })).map(r => r.id).sort();
  assert.deepEqual(await ids('newCase'), ['k_owner']);            // manager turned new cases off
  assert.deepEqual(await ids('emergency'), ['k_mgr', 'k_owner']); // mgr2 has no access to p1; suspended admin excluded
  assert.deepEqual(await ids('approval'), ['k_mgr', 'k_owner']);
});

test('notifyManagers is off unless PMA_PUSH_ENABLED=true', async () => {
  sentBatches = [];
  const { db } = world();
  const r = await push.notifyManagers({ env: {}, db, kind: 'newCase', title: 't', body: 'b' });
  assert.equal(r.state, 'DISABLED');
  assert.equal(sentBatches.length, 0);
});

test('emergency push goes to the emergency channel with case data', async () => {
  sentBatches = []; expoReplies(allOk);
  const { db } = world();
  const r = await push.notifyManagers({ env: { ...env, EXPO_ACCESS_TOKEN: 'xat' }, db, kind: 'emergency', title: 'EMERGENCY', body: 'Gas', data: { requestId: 'r1' } });
  assert.deepEqual(r, { state: 'SENT', sent: 2, failed: 0 });
  const [batch] = sentBatches;
  assert.equal(batch.url, 'https://exp.host/--/api/v2/push/send');
  assert.equal(batch.headers.authorization, 'Bearer xat');
  assert.equal(batch.msgs[0].channelId, 'emergency');
  assert.equal(batch.msgs[0].priority, 'high');
  assert.deepEqual(batch.msgs[0].data, { requestId: 'r1', kind: 'emergency' });
  assert.equal(batch.msgs[0].rowId, undefined); // internal id never sent to Expo
});

test('DeviceNotRegistered disables that token', async () => {
  sentBatches = [];
  expoReplies((m) => (m.to === tok('mgr') ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' }));
  const w = world();
  const r = await push.notifyManagers({ env, db: w.db, kind: 'approval', title: 't', body: 'b' });
  assert.equal(r.state, 'PARTIAL');
  const row = w.tables.pma_push_tokens.find(t => t.id === 'k_mgr');
  assert.equal(row.enabled, false);
  assert.equal(row.last_error, 'DeviceNotRegistered');
});

test('Expo outage is reported, not thrown', async () => {
  push._test.setFetch(async () => { throw new Error('timeout'); });
  const r = await push.notifyManagers({ env, db: world().db, kind: 'approval', title: 't', body: 'b' });
  assert.equal(r.state, 'FAILED');
  const r2 = await push.notifyManagers({ env, db: { from: () => { throw new Error('db down'); } }, kind: 'approval', title: 't', body: 'b' });
  assert.equal(r2.state, 'FAILED');
});

test('pushNewCase: emergency vs new case wording; replays push nothing', async () => {
  sentBatches = []; expoReplies(allOk);
  const prev = process.env.PMA_PUSH_ENABLED;
  const args = { reportedAddress: '1200 Desert Palm Dr', reportedUnit: '14B', description: 'Gas smell in kitchen' };
  // pushNewCase builds its own client; give it ours through a stubbed supabase-js.
  const path = require.resolve('@supabase/supabase-js');
  const saved = require.cache[path];
  const w = world();
  require.cache[path] = { id: path, filename: path, loaded: true, exports: { createClient: () => w.db } };
  try {
    const e = await push.pushNewCase({ result: { success: true, caseNumber: 'PMA-9', requestId: 'r9', urgentReviewRequired: true }, args, env });
    assert.equal(e.state, 'SENT');
    assert.match(sentBatches[0].msgs[0].title, /^EMERGENCY: case #PMA-9/);
    assert.match(sentBatches[0].msgs[0].body, /Unit 14B — Gas smell/);
    const n = await push.pushNewCase({ result: { success: true, caseNumber: 'PMA-10', requestId: 'r10' }, args, env });
    assert.equal(n.sent, 1); // only the owner wants new-case pushes
    assert.equal(sentBatches[1].msgs[0].title, 'New case #PMA-10');
    assert.equal(sentBatches[1].msgs[0].channelId, 'cases');
    assert.equal((await push.pushNewCase({ result: { success: true, replayed: true, caseNumber: 'PMA-10' }, args, env })).state, 'SKIPPED');
    assert.equal((await push.pushNewCase({ result: { success: false }, args, env })).state, 'SKIPPED');
  } finally {
    if (saved) require.cache[path] = saved; else delete require.cache[path];
    process.env.PMA_PUSH_ENABLED = prev;
  }
});

test('registerDevice validates, keeps own prefs, and moves a shared token to the new user', async () => {
  const w = world();
  const owner = { authUserId: 'u_owner', tenantUserId: 'tu_owner' };
  assert.equal((await push.registerDevice({ db: w.db, env, auth: owner, token: 'nope', platform: 'ios' })).status, 400);
  assert.equal((await push.registerDevice({ db: w.db, env, auth: owner, token: tok('n'), platform: 'web' })).status, 400);
  const a = await push.registerDevice({ db: w.db, env, auth: owner, token: tok('new'), platform: 'ios', prefs: { approval: false, junk: 1 } });
  assert.equal(a.status, 200);
  assert.deepEqual(a.body.prefs, { newCase: true, emergency: true, approval: false });
  // Re-register without prefs: saved prefs kept.
  const b = await push.registerDevice({ db: w.db, env, auth: owner, token: tok('new'), platform: 'ios' });
  assert.deepEqual(b.body.prefs, { newCase: true, emergency: true, approval: false });
  // Same phone, different manager: token moves and prefs reset to defaults.
  const mgr = { authUserId: 'u_mgr', tenantUserId: 'tu_mgr' };
  const c = await push.registerDevice({ db: w.db, env, auth: mgr, token: tok('new'), platform: 'ios' });
  assert.deepEqual(c.body.prefs, push.DEFAULT_PREFS);
  const row = w.tables.pma_push_tokens.find(t => t.token === tok('new'));
  assert.equal(row.user_id, 'u_mgr');
  assert.equal(row.tenant_user_id, 'tu_mgr');
  assert.equal(w.tables.pma_push_tokens.filter(t => t.token === tok('new')).length, 1);
});

test('removeDevice only removes the caller\'s own token', async () => {
  const w = world();
  await push.removeDevice({ db: w.db, auth: { authUserId: 'u_mgr' }, token: tok('owner') });
  assert.ok(w.tables.pma_push_tokens.some(t => t.token === tok('owner')));
  await push.removeDevice({ db: w.db, auth: { authUserId: 'u_owner' }, token: tok('owner') });
  assert.ok(!w.tables.pma_push_tokens.some(t => t.token === tok('owner')));
});

test('sendTestPush reaches only the caller\'s enabled devices', async () => {
  sentBatches = []; expoReplies(allOk);
  const w = world();
  const r = await push.sendTestPush({ db: w.db, env, auth: { authUserId: 'u_owner' } });
  assert.equal(r.body.state, 'SENT');
  assert.deepEqual(sentBatches[0].msgs.map(m => m.to), [tok('owner')]);
  assert.equal((await push.sendTestPush({ db: w.db, env, auth: { authUserId: 'u_nobody' } })).body.state, 'NO_DEVICES');
  assert.equal((await push.sendTestPush({ db: w.db, env: {}, auth: { authUserId: 'u_owner' } })).body.state, 'DISABLED');
});

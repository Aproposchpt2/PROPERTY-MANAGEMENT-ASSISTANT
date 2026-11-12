'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const sent = [];
const failWith = {};
function stub(file, exportsObj) {
  const p = path.join(__dirname, '../netlify/functions/lib', file);
  require.cache[require.resolve(p)] = { id: p, filename: p, loaded: true, exports: exportsObj };
}
stub('pma-sms.js', {
  sendResidentUpdate: async (a) => { sent.push(['sms', a]); if (failWith.sms) throw failWith.sms; return { sid: 'SM1' }; },
});
stub('pma-email.js', {
  sendResidentUpdate: async (a) => { sent.push(['email', a]); if (failWith.email) throw failWith.email; return { id: 'RE1' }; },
});

const { notifyResident, addApprovalFields } = require('../netlify/functions/lib/pma-resident-notify');

// Minimal chainable fake of the supabase-js query builder.
function fakeDb({ row = null, rows = [], fail = false } = {}) {
  const log = { filters: [], inserts: [] };
  const builder = () => {
    const q = {
      select: () => q,
      eq: (k, v) => { log.filters.push([k, v]); return q; },
      in: (k, v) => { log.filters.push([k, v]); return Promise.resolve(fail ? { data: null, error: { message: 'x' } } : { data: rows, error: null }); },
      maybeSingle: () => Promise.resolve(fail ? { data: null, error: { message: 'x' } } : { data: row, error: null }),
      insert: (r) => { log.inserts.push(r); return Promise.resolve({ error: null }); },
    };
    return q;
  };
  return { db: { from: (t) => { log.table = t; return builder(); } }, log };
}

const env = { PMA_SMS_ENABLED: 'true', PMA_EMAIL_ENABLED: 'true' };
const base = { tenantId: 't1', propertyId: 'p1', requestId: 'r1', actorUserId: 'u1', env };
const row = (pref, lang = 'en') => ({ case_number: 'PMA-7', status: 'Scheduled', intake_details: { contactPreference: pref, language: lang } });
const reset = () => { sent.length = 0; delete failWith.sms; delete failWith.email; };

test('texts the update to a resident who chose text, and records it', async () => {
  reset();
  const { db, log } = fakeDb({ row: row({ method: 'sms', destination: '+17025550100', consent: true }) });
  const r = await notifyResident({ ...base, db, update: '  Plumber booked for 9am.  ' });
  assert.deepEqual(r, { sent: true, state: 'SENT', method: 'sms' });
  assert.equal(sent[0][1].to, '+17025550100');
  assert.equal(sent[0][1].update, 'Plumber booked for 9am.');
  assert.equal(sent[0][1].caseNumber, 'PMA-7');
  assert.equal(sent[0][1].status, 'Scheduled');
  assert.deepEqual(log.filters.slice(0, 3), [['tenant_id', 't1'], ['property_id', 'p1'], ['id', 'r1']]);
  assert.equal(log.inserts[0].event_type, 'resident_update_sent');
  assert.equal(log.inserts[0].actor_user_id, 'u1');
});

test('emails in Spanish when the resident chose email and Spanish', async () => {
  reset();
  const { db } = fakeDb({ row: row({ method: 'email', destination: 'r@example.com', consent: true }, 'es') });
  const r = await notifyResident({ ...base, db, update: 'Listo' });
  assert.equal(r.state, 'SENT');
  assert.equal(sent[0][0], 'email');
  assert.equal(sent[0][1].language, 'es');
});

test('sends nothing without a consented text or email preference', async () => {
  reset();
  for (const pref of [undefined, { method: 'phone', destination: '+17025550100', consent: true },
    { method: 'sms', destination: '+17025550100', consent: false }, { method: 'sms', consent: true }]) {
    const { db } = fakeDb({ row: row(pref) });
    assert.equal((await notifyResident({ ...base, db, update: 'x' })).state, 'NO_PREFERENCE');
  }
  assert.equal(sent.length, 0);
});

test('respects disabled channels, empty updates and missing cases', async () => {
  reset();
  const { db } = fakeDb({ row: row({ method: 'sms', destination: '+17025550100', consent: true }) });
  assert.equal((await notifyResident({ ...base, env: { PMA_SMS_ENABLED: 'false' }, db, update: 'x' })).state, 'DISABLED');
  assert.equal((await notifyResident({ ...base, db, update: '   ' })).state, 'NO_UPDATE');
  assert.equal((await notifyResident({ ...base, db: fakeDb({ row: null }).db, update: 'x' })).state, 'NOT_FOUND');
  assert.equal((await notifyResident({ ...base, db: fakeDb({ fail: true }).db, update: 'x' })).state, 'FAILED');
  assert.equal(sent.length, 0);
});

test('records opt-outs and failures without throwing', async () => {
  reset();
  failWith.sms = Object.assign(new Error('OPTED_OUT'), { code: 21610 });
  const a = fakeDb({ row: row({ method: 'sms', destination: '+17025550100', consent: true }) });
  assert.equal((await notifyResident({ ...base, db: a.db, update: 'x' })).state, 'OPTED_OUT');
  assert.match(a.log.inserts[0].body, /opted out/);
  failWith.sms = new Error('boom');
  const b = fakeDb({ row: row({ method: 'sms', destination: '+17025550100', consent: true }) });
  assert.deepEqual(await notifyResident({ ...base, db: b.db, update: 'x' }), { sent: false, state: 'FAILED', method: 'sms' });
});

test('addApprovalFields merges amount and state; failures leave cases unchanged', async () => {
  const cases = [{ id: 'a' }, { id: 'b' }];
  const { db, log } = fakeDb({ rows: [{ id: 'a', nte_amount: '450.00', approval_state: 'PENDING' }] });
  await addApprovalFields({ db, tenantId: 't1', propertyId: 'p1', cases });
  assert.deepEqual(cases[0], { id: 'a', nteAmount: 450, approvalState: 'PENDING' });
  assert.deepEqual(cases[1], { id: 'b' });
  assert.deepEqual(log.filters, [['tenant_id', 't1'], ['property_id', 'p1'], ['id', ['a', 'b']]]);
  const c2 = [{ id: 'a' }];
  await addApprovalFields({ db: fakeDb({ fail: true }).db, tenantId: 't1', propertyId: 'p1', cases: c2 });
  assert.deepEqual(c2, [{ id: 'a' }]);
  await addApprovalFields({ db: { from: () => { throw new Error('no'); } }, tenantId: 't1', propertyId: 'p1', cases: c2 });
  await addApprovalFields({ db, tenantId: 't1', propertyId: 'p1', cases: [] });
});

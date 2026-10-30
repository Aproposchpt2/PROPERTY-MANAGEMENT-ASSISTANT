'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { handler, _test } = require('../netlify/functions/pma-intake');

const TENANT = '5885a020-d363-4c27-910a-c035eda132f5';
const headers = { origin: 'https://pma.stellaruc.com', host: 'pma.stellaruc.com' };
const valid = {
  name: 'Ana Ruiz', businessName: 'Desert Ridge Apartments', phone: '(702) 555-0142',
  email: 'Ana@Example.com', smsConsent: true, clientToken: 'abc12345-token',
};
const post = (body, h = headers) => handler({ httpMethod: 'POST', headers: h, body: JSON.stringify(body) });

// Minimal fake of the supabase-js calls the intake makes.
function fakeDb({ existingLead = null, failOn = null } = {}) {
  const calls = { upserts: [], rpcs: [] };
  const err = (step) => (failOn === step ? { message: `${step} failed` } : null);
  const query = (table) => {
    const q = {
      upsert(row, opts) { calls.upserts.push({ table, row, opts }); return Promise.resolve({ error: err('upsert') }); },
      select() { return q; },
      eq() { return q; },
      single() { return Promise.resolve({ data: { id: 'int-1' }, error: err('fetch') }); },
      maybeSingle() { return Promise.resolve({ data: existingLead, error: err('lookup') }); },
    };
    return q;
  };
  return {
    calls,
    from: query,
    rpc(name, args) {
      calls.rpcs.push({ name, args });
      if (name === 'ai4cc_create_lead_from_interaction') return Promise.resolve({ data: { lead: { id: 'lead-1' } }, error: err('create') });
      return Promise.resolve({ data: null, error: err('activity') });
    },
  };
}

let sent;
beforeEach(() => {
  sent = [];
  process.env.RESEND_API_KEY = 're_test';
  process.env.RESEND_FROM_EMAIL = 'Stellar <noreply@stellaruc.com>';
  delete process.env.PMA_INTAKE_TO_EMAIL;
  delete process.env.OWNER_NOTIFICATION_EMAIL;
  global.fetch = async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 200 }; };
});

test('valid submission creates a pipeline lead, logs activity and emails the owner', async () => {
  const db = fakeDb(); _test.setClient(db);
  const res = await post(valid);
  assert.equal(res.statusCode, 200);

  const up = db.calls.upserts[0];
  assert.equal(up.table, 'ai4cc_interactions');
  assert.equal(up.row.tenant_id, TENANT);
  assert.equal(up.row.external_id, 'abc12345-token');
  assert.equal(up.row.metadata.source, 'pma_stellaruc_intake');
  assert.equal(up.row.metadata.sms_consent.granted, true);
  assert.equal(up.opts.onConflict, 'tenant_id,channel,external_id');

  const [create, activity] = db.calls.rpcs;
  assert.equal(create.name, 'ai4cc_create_lead_from_interaction');
  assert.equal(create.args.p_tenant_id, TENANT);
  assert.equal(create.args.p_interaction_id, 'int-1');
  assert.equal(create.args.p_email, 'ana@example.com');
  assert.equal(create.args.p_phone, '+17025550142');
  assert.equal(create.args.p_company_name, 'Desert Ridge Apartments');
  assert.equal(create.args.p_service_interest, 'Property Management Assistant');
  assert.equal(create.args.p_pipeline_stage, 'new');
  assert.equal(activity.name, 'ai4cc_record_lead_activity');
  assert.equal(activity.args.p_lead_id, 'lead-1');

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.to, ['jmitchell@aproposgroupllc.com']);
  assert.equal(sent[0].body.reply_to, 'ana@example.com');
});

test('a retried submission does not create a second lead or email', async () => {
  const db = fakeDb({ existingLead: { id: 'lead-1' } }); _test.setClient(db);
  assert.equal((await post(valid)).statusCode, 200);
  assert.equal(db.calls.rpcs.length, 0);
  assert.equal(sent.length, 0);
});

test('fails honestly when the lead cannot be saved', async () => {
  for (const step of ['upsert', 'fetch', 'lookup', 'create', 'activity']) {
    _test.setClient(fakeDb({ failOn: step }));
    assert.equal((await post(valid)).statusCode, 500, step);
  }
});

test('email failure does not fail a saved lead', async () => {
  _test.setClient(fakeDb());
  global.fetch = async () => ({ ok: false, status: 422 });
  assert.equal((await post(valid)).statusCode, 200);
  delete process.env.RESEND_API_KEY;
  _test.setClient(fakeDb());
  assert.equal((await post(valid)).statusCode, 200);
});

test('rejects cross-origin, non-POST and invalid input without touching the database', async () => {
  const db = fakeDb(); _test.setClient(db);
  assert.equal((await post(valid, { origin: 'https://evil.example', host: 'pma.stellaruc.com' })).statusCode, 403);
  assert.equal((await handler({ httpMethod: 'GET', headers })).statusCode, 405);
  assert.equal((await post({ ...valid, name: ' ' })).statusCode, 400);
  assert.equal((await post({ ...valid, businessName: '' })).statusCode, 400);
  assert.equal((await post({ ...valid, phone: 'call me' })).statusCode, 400);
  assert.equal((await post({ ...valid, email: 'nope' })).statusCode, 400);
  assert.equal((await post({ ...valid, clientToken: 'x' })).statusCode, 400);
  assert.equal((await post({ ...valid, website: 'spam.example' })).statusCode, 200);
  assert.equal(db.calls.upserts.length, 0);
  assert.equal(sent.length, 0);
});

test('phone normalization matches stellaruc.com intake', () => {
  assert.equal(_test.normalizePhone('702-555-0142'), '+17025550142');
  assert.equal(_test.normalizePhone('1 702 555 0142'), '+17025550142');
  assert.equal(_test.normalizePhone('+44 20 7946 0958'), '+442079460958');
  assert.equal(_test.normalizePhone('abc'), null);
});

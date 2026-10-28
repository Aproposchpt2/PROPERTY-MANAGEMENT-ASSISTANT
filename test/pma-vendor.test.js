'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ---- stubs ----------------------------------------------------------------
const stubEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service_role_key_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  PMA_TENANT_ID: '5885a020-d363-4c27-910a-c035eda132f5',
  PMA_PROPERTY_ID: 'f9871623-c3f5-4e4e-b04e-3135d17fcdef',
  PMA_VENDOR_TOOL_KEY: 'test_vendor_tool_key_32chars_xxxxxx',
  PMA_VENDOR_FROM: '+17027102622',
  PMA_BASE_URL: 'https://pma.stellaruc.com',
  TWILIO_ACCOUNT_SID: 'ACxxx',
  TWILIO_AUTH_TOKEN: 'tokxxx',
};

function makeRpcResult(data) {
  return { data, error: null };
}

function stubSupabase(rpcFn) {
  require.cache[require.resolve('@supabase/supabase-js')] = {
    id: require.resolve('@supabase/supabase-js'),
    filename: require.resolve('@supabase/supabase-js'),
    loaded: true,
    exports: {
      createClient: () => ({ rpc: rpcFn }),
    },
  };
}

function stubSms() {
  const smsPath = require.resolve('../netlify/functions/lib/pma-sms');
  require.cache[smsPath] = {
    id: smsPath, filename: smsPath, loaded: true,
    exports: {
      sendVendorApprovalRequest: async () => ({ sid: 'SMS_SID' }),
      sendVendorSms: async () => ({ sid: 'SMS_SID' }),
    },
  };
}

function clearStubs() {
  delete require.cache[require.resolve('@supabase/supabase-js')];
  delete require.cache[require.resolve('../netlify/functions/lib/pma-sms')];
  delete require.cache[require.resolve('../netlify/functions/pma-vendor')];
}

function makeEvent(overrides = {}) {
  return {
    httpMethod: 'POST',
    path: '/api/tools/pma-vendor',
    headers: { 'x-pma-tool-key': stubEnv.PMA_VENDOR_TOOL_KEY },
    body: JSON.stringify({ caller_phone: '+17025550001', action: 'list_work_orders' }),
    queryStringParameters: {},
    ...overrides,
  };
}

// ---- tests -----------------------------------------------------------------

test('401 missing key', async () => {
  clearStubs(); stubSupabase(async () => makeRpcResult({})); stubSms();
  const mod = require('../netlify/functions/pma-vendor');
  const ev = makeEvent({ headers: {} });
  const res = await mod.handler(ev, {}, () => {}, { env: stubEnv });
  // We call with process.env — patch it
  const savedEnv = Object.assign({}, process.env);
  Object.assign(process.env, stubEnv);
  const res2 = await require('../netlify/functions/pma-vendor').handler(ev);
  Object.assign(process.env, savedEnv);
  assert.equal(res2.statusCode, 401);
  clearStubs();
});

test('401 wrong key', async () => {
  clearStubs(); stubSupabase(async () => makeRpcResult({})); stubSms();
  const savedEnv = Object.assign({}, process.env);
  Object.assign(process.env, stubEnv);
  const mod = require('../netlify/functions/pma-vendor');
  const ev = makeEvent({ headers: { 'x-pma-tool-key': 'wrong_key_xxxxxxxxxxxxxxxxxxxxxxxxx' } });
  const res = await mod.handler(ev);
  Object.assign(process.env, savedEnv);
  assert.equal(res.statusCode, 401);
  clearStubs();
});

test('405 GET not allowed', async () => {
  clearStubs(); stubSupabase(async () => makeRpcResult({})); stubSms();
  const savedEnv = Object.assign({}, process.env);
  Object.assign(process.env, stubEnv);
  const mod = require('../netlify/functions/pma-vendor');
  const ev = makeEvent({ httpMethod: 'GET' });
  const res = await mod.handler(ev);
  Object.assign(process.env, savedEnv);
  assert.equal(res.statusCode, 405);
  clearStubs();
});

test('400 missing caller_phone', async () => {
  clearStubs(); stubSupabase(async () => makeRpcResult({})); stubSms();
  const savedEnv = Object.assign({}, process.env);
  Object.assign(process.env, stubEnv);
  const mod = require('../netlify/functions/pma-vendor');
  const ev = makeEvent({ body: JSON.stringify({ action: 'list_work_orders' }) });
  const res = await mod.handler(ev);
  Object.assign(process.env, savedEnv);
  assert.equal(res.statusCode, 400);
  clearStubs();
});

test('UNKNOWN_VENDOR when lookup returns success:false', async () => {
  clearStubs();
  stubSupabase(async (name) => {
    if (name === 'pma_vendor_lookup_v1') return makeRpcResult({ success: false, state: 'UNKNOWN_VENDOR' });
    return makeRpcResult({});
  });
  stubSms();
  const savedEnv = Object.assign({}, process.env);
  Object.assign(process.env, stubEnv);
  const mod = require('../netlify/functions/pma-vendor');
  const ev = makeEvent();
  const res = await mod.handler(ev);
  Object.assign(process.env, savedEnv);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.state, 'UNKNOWN_VENDOR');
  clearStubs();
});

test('list_work_orders returns rpc data', async () => {
  clearStubs();
  const fakeOrders = { success: true, workOrders: [] };
  stubSupabase(async (name) => {
    if (name === 'pma_vendor_lookup_v1') return makeRpcResult({ success: true, vendorId: 'v1' });
    if (name === 'pma_vendor_work_orders_v1') return makeRpcResult(fakeOrders);
    return makeRpcResult({});
  });
  stubSms();
  const savedEnv = Object.assign({}, process.env);
  Object.assign(process.env, stubEnv);
  const mod = require('../netlify/functions/pma-vendor');
  const ev = makeEvent();
  const res = await mod.handler(ev);
  Object.assign(process.env, savedEnv);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), fakeOrders);
  clearStubs();
});

test('accept action 200', async () => {
  clearStubs();
  stubSupabase(async (name) => {
    if (name === 'pma_vendor_lookup_v1') return makeRpcResult({ success: true, vendorId: 'v1' });
    if (name === 'pma_vendor_accept_v1') return makeRpcResult({ success: true });
    return makeRpcResult({});
  });
  stubSms();
  const savedEnv = Object.assign({}, process.env);
  Object.assign(process.env, stubEnv);
  const mod = require('../netlify/functions/pma-vendor');
  const ev = makeEvent({ body: JSON.stringify({ caller_phone: '+17025550001', action: 'accept', case_number: 'PMA-001' }) });
  const res = await mod.handler(ev);
  Object.assign(process.env, savedEnv);
  assert.equal(res.statusCode, 200);
  clearStubs();
});

test('accept 400 missing case_number', async () => {
  clearStubs();
  stubSupabase(async (name) => {
    if (name === 'pma_vendor_lookup_v1') return makeRpcResult({ success: true, vendorId: 'v1' });
    return makeRpcResult({});
  });
  stubSms();
  const savedEnv = Object.assign({}, process.env);
  Object.assign(process.env, stubEnv);
  const mod = require('../netlify/functions/pma-vendor');
  const ev = makeEvent({ body: JSON.stringify({ caller_phone: '+17025550001', action: 'accept' }) });
  const res = await mod.handler(ev);
  Object.assign(process.env, savedEnv);
  assert.equal(res.statusCode, 400);
  clearStubs();
});

test('request_nte 400 bad amount', async () => {
  clearStubs();
  stubSupabase(async (name) => {
    if (name === 'pma_vendor_lookup_v1') return makeRpcResult({ success: true, vendorId: 'v1' });
    return makeRpcResult({});
  });
  stubSms();
  const savedEnv = Object.assign({}, process.env);
  Object.assign(process.env, stubEnv);
  const mod = require('../netlify/functions/pma-vendor');
  const ev = makeEvent({ body: JSON.stringify({ caller_phone: '+17025550001', action: 'request_nte', case_number: 'PMA-001', amount: -5 }) });
  const res = await mod.handler(ev);
  Object.assign(process.env, savedEnv);
  assert.equal(res.statusCode, 400);
  clearStubs();
});

test('request_nte auto-approved returns 200 with APPROVED state', async () => {
  clearStubs();
  stubSupabase(async (name) => {
    if (name === 'pma_vendor_lookup_v1') return makeRpcResult({ success: true, vendorId: 'v1' });
    if (name === 'pma_vendor_request_nte_v1') return makeRpcResult({ success: true, approvalState: 'APPROVED', approvers: [] });
    return makeRpcResult({});
  });
  stubSms();
  const savedEnv = Object.assign({}, process.env);
  Object.assign(process.env, stubEnv);
  const mod = require('../netlify/functions/pma-vendor');
  const ev = makeEvent({ body: JSON.stringify({ caller_phone: '+17025550001', action: 'request_nte', case_number: 'PMA-001', amount: 100 }) });
  const res = await mod.handler(ev);
  Object.assign(process.env, savedEnv);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.approvalState, 'APPROVED');
  clearStubs();
});

test('request_nte pending (real RPC shape) texts approver and hides contacts', async () => {
  clearStubs();
  const inserts = [];
  stubSupabase(async (name, args) => {
    if (name === 'pma_vendor_lookup_v1') return makeRpcResult({ success: true, vendorId: 'v1' });
    if (name === 'pma_vendor_request_nte_v1') return makeRpcResult({ success: true, approved: false, amount: 450,
      requestId: 'r1', caseNumber: 'PMA-001',
      approvers: [{ tenantUserId: 'u1', email: 'm@example.com', phone: '+17025550002' }, { tenantUserId: 'u2', email: 'x@example.com', phone: null }] });
    if (name === 'pma_approval_insert_v1') { inserts.push(args); return makeRpcResult({ success: true, shortCode: 'ABC123' }); }
    return makeRpcResult({});
  });
  stubSms();
  const savedEnv = Object.assign({}, process.env);
  Object.assign(process.env, stubEnv);
  const mod = require('../netlify/functions/pma-vendor');
  const ev = makeEvent({ body: JSON.stringify({ caller_phone: '+17025550001', action: 'request_nte', case_number: 'PMA-001', amount: 450 }) });
  const res = await mod.handler(ev);
  Object.assign(process.env, savedEnv);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.approvalState, 'PENDING');
  assert.equal(body.approvers, undefined);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].request_id, 'r1');
  assert.equal(inserts[0].approver_user_id, 'u1');
  clearStubs();
});

test('unknown action returns 400', async () => {
  clearStubs();
  stubSupabase(async (name) => {
    if (name === 'pma_vendor_lookup_v1') return makeRpcResult({ success: true, vendorId: 'v1' });
    return makeRpcResult({});
  });
  stubSms();
  const savedEnv = Object.assign({}, process.env);
  Object.assign(process.env, stubEnv);
  const mod = require('../netlify/functions/pma-vendor');
  const ev = makeEvent({ body: JSON.stringify({ caller_phone: '+17025550001', action: 'does_not_exist' }) });
  const res = await mod.handler(ev);
  Object.assign(process.env, savedEnv);
  assert.equal(res.statusCode, 400);
  clearStubs();
});

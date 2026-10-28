'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const stubEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service_role_key_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  PMA_TENANT_ID: '5885a020-d363-4c27-910a-c035eda132f5',
  PMA_PROPERTY_ID: 'f9871623-c3f5-4e4e-b04e-3135d17fcdef',
  PMA_VENDOR_FROM: '+17027102622',
  TWILIO_ACCOUNT_SID: 'ACxxx',
  TWILIO_AUTH_TOKEN: 'tokxxx',
};

function makeRpcResult(data) { return { data, error: null }; }

function stubDeps(rpcFn, verifyOk = true) {
  require.cache[require.resolve('@supabase/supabase-js')] = {
    id: require.resolve('@supabase/supabase-js'),
    filename: require.resolve('@supabase/supabase-js'),
    loaded: true,
    exports: { createClient: () => ({ rpc: rpcFn }) },
  };
  require.cache[require.resolve('twilio')] = {
    id: require.resolve('twilio'),
    filename: require.resolve('twilio'),
    loaded: true,
    exports: Object.assign(
      function twilio() { return {}; },
      { validateRequest: () => verifyOk }
    ),
  };
  const smsPath = require.resolve('../netlify/functions/lib/pma-sms');
  require.cache[smsPath] = {
    id: smsPath, filename: smsPath, loaded: true,
    exports: { sendVendorSms: async () => ({ sid: 'SID' }) },
  };
}

function clearStubs() {
  delete require.cache[require.resolve('@supabase/supabase-js')];
  delete require.cache[require.resolve('twilio')];
  delete require.cache[require.resolve('../netlify/functions/lib/pma-sms')];
  delete require.cache[require.resolve('../netlify/functions/pma-vendor-inbound')];
}

function makeEvent(body = 'From=%2B17025550001&Body=HELPME', overrides = {}) {
  return {
    httpMethod: 'POST',
    path: '/api/sms/vendor-inbound',
    headers: {
      'x-twilio-signature': 'sig',
      'x-forwarded-proto': 'https',
      host: 'pma.stellaruc.com',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
    queryStringParameters: {},
    ...overrides,
  };
}

test('403 when Twilio signature invalid', async () => {
  clearStubs(); stubDeps(async () => makeRpcResult({}), false);
  const savedEnv = Object.assign({}, process.env);
  Object.assign(process.env, stubEnv);
  const mod = require('../netlify/functions/pma-vendor-inbound');
  const res = await mod.handler(makeEvent());
  Object.assign(process.env, savedEnv);
  assert.equal(res.statusCode, 403);
  clearStubs();
});

test('405 GET not allowed', async () => {
  clearStubs(); stubDeps(async () => makeRpcResult({}), true);
  const savedEnv = Object.assign({}, process.env);
  Object.assign(process.env, stubEnv);
  const mod = require('../netlify/functions/pma-vendor-inbound');
  const res = await mod.handler(makeEvent('', { httpMethod: 'GET' }));
  Object.assign(process.env, savedEnv);
  assert.equal(res.statusCode, 405);
  clearStubs();
});

test('HELP returns twiml 200', async () => {
  clearStubs(); stubDeps(async () => makeRpcResult({}), true);
  const savedEnv = Object.assign({}, process.env);
  Object.assign(process.env, stubEnv);
  const mod = require('../netlify/functions/pma-vendor-inbound');
  const res = await mod.handler(makeEvent('From=%2B17025550001&Body=HELP'));
  Object.assign(process.env, savedEnv);
  assert.equal(res.statusCode, 200);
  assert.ok(res.headers['content-type'].includes('xml'));
  assert.ok(res.body.includes('Message'));
  clearStubs();
});

test('unrecognized body gets default reply', async () => {
  clearStubs(); stubDeps(async () => makeRpcResult({}), true);
  const savedEnv = Object.assign({}, process.env);
  Object.assign(process.env, stubEnv);
  const mod = require('../netlify/functions/pma-vendor-inbound');
  const res = await mod.handler(makeEvent('From=%2B17025550001&Body=RANDOM'));
  Object.assign(process.env, savedEnv);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('Unrecognized'));
  clearStubs();
});

test('YES<CODE> approval success returns confirmation TwiML', async () => {
  clearStubs();
  stubDeps(async (name, args) => {
    if (name === 'pma_approval_respond_v1') return makeRpcResult({ success: true, response: 'APPROVED', caseNumber: 'PMA-001', amount: 250, vendorPhone: null });
    return makeRpcResult({});
  }, true);
  const savedEnv = Object.assign({}, process.env);
  Object.assign(process.env, stubEnv);
  const mod = require('../netlify/functions/pma-vendor-inbound');
  const res = await mod.handler(makeEvent('From=%2B17025550001&Body=YESABC123'));
  Object.assign(process.env, savedEnv);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('approved'));
  clearStubs();
});

test('NO<CODE> decline returns confirmation TwiML', async () => {
  clearStubs();
  stubDeps(async () => makeRpcResult({ success: true, response: 'DECLINED', caseNumber: 'PMA-001', amount: 250, vendorPhone: null }), true);
  const savedEnv = Object.assign({}, process.env);
  Object.assign(process.env, stubEnv);
  const mod = require('../netlify/functions/pma-vendor-inbound');
  const res = await mod.handler(makeEvent('From=%2B17025550001&Body=NOABC123'));
  Object.assign(process.env, savedEnv);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('declined'));
  clearStubs();
});

test('expired short_code returns expired message', async () => {
  clearStubs();
  stubDeps(async () => makeRpcResult({ success: false, state: 'EXPIRED' }), true);
  const savedEnv = Object.assign({}, process.env);
  Object.assign(process.env, stubEnv);
  const mod = require('../netlify/functions/pma-vendor-inbound');
  const res = await mod.handler(makeEvent('From=%2B17025550001&Body=YESABC123'));
  Object.assign(process.env, savedEnv);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.toLowerCase().includes('expir'));
  clearStubs();
});

test('empty body returns empty TwiML', async () => {
  clearStubs(); stubDeps(async () => makeRpcResult({}), true);
  const savedEnv = Object.assign({}, process.env);
  Object.assign(process.env, stubEnv);
  const mod = require('../netlify/functions/pma-vendor-inbound');
  const res = await mod.handler(makeEvent(''));
  Object.assign(process.env, savedEnv);
  assert.equal(res.statusCode, 200);
  clearStubs();
});

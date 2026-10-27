'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { signControl, verifyControl, verifyWebhook, incoming, sessionConfig, createService, GREETING } = require('../netlify/functions/lib/carol-sip-server');

const env = {
  PMA_SIP_ENABLED: 'true', PMA_RUNTIME_MODE: 'production-validation', PMA_BASE_URL: 'https://pma.stellaruc.com',
  SUPABASE_URL: 'https://vqrqyanqsiqzsmlhytaz.supabase.co', OPENAI_API_KEY: 'test',
  OPENAI_WEBHOOK_SECRET: `whsec_${Buffer.alloc(32, 1).toString('base64')}`,
  PMA_SIP_CONTROL_SECRET: 'control-secret-with-at-least-thirty-two-chars',
  PMA_SIP_TRUNK_SECRET: 'trunk-secret-with-at-least-thirty-two-characters', PMA_SIP_DID: '+17252010584',
  PMA_TEST_CALLER: '+17023087429', PMA_TENANT_ID: '5885a020-d363-4c27-910a-c035eda132f5',
  PMA_PROPERTY_ID: '40000000-0000-4000-8000-000000000001',
};
const call = '9fcd2f8d-4e8c-4c53-a0f7-3e74c3b0c111@twilio.com';
const sip = 'call_test_1';
const session = '10000000-0000-4000-8000-000000000001';
function sipEvent() { return { type: 'realtime.call.incoming', data: { call_id: sip, sip_headers: [
  { name: 'From', value: `<sip:${env.PMA_TEST_CALLER}@twilio.invalid>` }, { name: 'X-Stellar-Trunk-Token', value: env.PMA_SIP_TRUNK_SECRET },
  { name: 'Diversion', value: `<sip:${env.PMA_SIP_DID}@twilio.com>` }, { name: 'Call-ID', value: call },
] } }; }

test('control envelope is signed, scoped and expiring', () => {
  const body = JSON.stringify({ call_sid: call, sip_call_id: sip, session_id: session });
  const signature = signControl(body, env.PMA_SIP_CONTROL_SECRET);
  assert.equal(verifyControl(body, signature, env.PMA_SIP_CONTROL_SECRET).session_id, session);
  assert.throws(() => verifyControl(body, `${signature}0`, env.PMA_SIP_CONTROL_SECRET));
  assert.throws(() => verifyControl(body, signControl(body, env.PMA_SIP_CONTROL_SECRET, 1000), env.PMA_SIP_CONTROL_SECRET));
});

test('OpenAI webhook signature is verified', () => {
  const body = Buffer.from(JSON.stringify(sipEvent())); const id = 'wh_test'; const ts = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(env.OPENAI_WEBHOOK_SECRET.replace('whsec_', ''), 'base64');
  const signature = crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  assert.equal(verifyWebhook(body, { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${signature}` }, env.OPENAI_WEBHOOK_SECRET).type, 'realtime.call.incoming');
  assert.throws(() => verifyWebhook(body, { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': 'v1,bad' }, env.OPENAI_WEBHOOK_SECRET));
});

test('SIP admission requires the dedicated DID, caller and trunk token', () => {
  assert.equal(incoming(sipEvent(), env).call_sid, call);
  for (const key of ['PMA_SIP_DID', 'PMA_TEST_CALLER', 'PMA_SIP_TRUNK_SECRET']) assert.throws(() => incoming(sipEvent(), { ...env, [key]: 'wrong' }));
});

test('session contains Carol greeting, one create authority and barge-in', () => {
  const config = sessionConfig(env);
  assert.equal(config.model, 'gpt-realtime-2');
  assert.ok(config.instructions.includes(GREETING));
  assert.deepEqual(config.tools.map((x) => x.name), ['create_incident', 'end_call']);
  assert.equal(config.audio.input.turn_detection.interrupt_response, true);
});

test('runtime is pinned to the standalone PMA site and production database', () => {
  const store = {}; const service = createService({ env, store }); assert.equal(service.enabled(), true);
  for (const changes of [{ PMA_BASE_URL: 'https://other.invalid' }, { SUPABASE_URL: 'https://hvzauakkhlivzeqatfqm.supabase.co' }, { PMA_RUNTIME_MODE: 'production' }, { PMA_SIP_ENABLED: 'false' }]) {
    assert.equal(createService({ env: { ...env, ...changes }, store }).enabled(), false);
  }
});

test('disabled runtime fails closed before accepting a call', async () => {
  const service = createService({ env: { ...env, PMA_SIP_ENABLED: 'false' }, store: {} });
  const result = await service.handle(Buffer.from('{}'), {});
  assert.equal(result.statusCode, 503);
});

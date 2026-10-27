'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

// Stub the Supabase-backed store so no network or DB is touched.
const storePath = path.join(__dirname, '../netlify/functions/lib/cedar-store.js');
const calls = [];
require.cache[require.resolve(storePath)] = {
  id: storePath,
  filename: storePath,
  loaded: true,
  exports: {
    createStore: () => ({
      start: async (a) => { calls.push(['start', a]); return { session_id: 'sess_1' }; },
      createIncident: async (a) => { calls.push(['createIncident', a]); return { success: true, state: 'CREATED', incident_number: 'INC-1' }; },
      recordPreference: async (a) => { calls.push(['recordPreference', a]); return { success: true, state: 'RECORDED' }; },
      close: async (a) => { calls.push(['close', a]); return { success: true, state: 'CLOSED' }; },
    }),
  },
};

const { handler } = require('../netlify/functions/cedar-elevenlabs.js');

const KEY = 'k'.repeat(48);
const SECRET = 's'.repeat(32);
process.env.PMA_ELEVENLABS_TOOL_KEY = KEY;
process.env.ELEVENLABS_WEBHOOK_SECRET = SECRET;

const post = (body, headers = {}) => handler({ httpMethod: 'POST', headers, body: JSON.stringify(body), isBase64Encoded: false });

const incidentBody = {
  tool_name: 'create_incident',
  call_sid: 'CA7b66a46003a7f8ae13e3726b47967a1f',
  conversation_id: 'conv_123',
  caller_id: '+17025550100',
  reportedName: 'Test Caller',
  reportedAddress: '1 Test St',
  reportedUnit: '2-25',
  description: 'I smelled gas so I left.',
};

test('flat ElevenLabs tool body with valid key creates incident', async () => {
  calls.length = 0;
  const res = await post(incidentBody, { 'X-PMA-Tool-Key': KEY });
  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.success, true);
  assert.equal(out.incident_number, 'INC-1');
  const start = calls.find((c) => c[0] === 'start')[1];
  assert.deepEqual(start, { call_sid: incidentBody.call_sid, caller_number: '+17025550100' });
  const inc = calls.find((c) => c[0] === 'createIncident')[1];
  assert.equal(inc.session_id, 'sess_1');
  assert.deepEqual(inc.args, { reportedName: 'Test Caller', reportedAddress: '1 Test St', reportedUnit: '2-25', description: 'I smelled gas so I left.' });
});

test('missing or wrong key is rejected with 401', async () => {
  assert.equal((await post(incidentBody)).statusCode, 401);
  assert.equal((await post(incidentBody, { 'x-pma-tool-key': 'x'.repeat(48) })).statusCode, 401);
});

test('close_session with empty parameters routes correctly', async () => {
  calls.length = 0;
  const res = await post({ tool_name: 'close_session', call_sid: 'CA1', conversation_id: 'conv_1', caller_id: '+17025550100' }, { 'x-pma-tool-key': KEY });
  assert.equal(JSON.parse(res.body).state, 'CLOSED');
  assert.ok(calls.some((c) => c[0] === 'close'));
});

test('falls back to conversation_id when call_sid absent', async () => {
  calls.length = 0;
  await post({ ...incidentBody, call_sid: undefined }, { 'x-pma-tool-key': KEY });
  assert.equal(calls.find((c) => c[0] === 'start')[1].call_sid, 'conv_123');
});

test('missing tool_name returns a non-success tool result', async () => {
  const { tool_name, ...rest } = incidentBody;
  const res = await post(rest, { 'x-pma-tool-key': KEY });
  assert.equal(JSON.parse(res.body).success, false);
});

test('legacy signed envelope still works', async () => {
  const body = JSON.stringify({ tool_name: 'close_session', tool_call_id: 'tc_1', parameters: {}, dynamic_variables: { call_sid: 'CA2', session_id: 'sess_9' } });
  const ts = Math.floor(Date.now() / 1000);
  const mac = crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
  const res = await handler({ httpMethod: 'POST', headers: { 'elevenlabs-signature': `t=${ts},v0=${mac}` }, body, isBase64Encoded: false });
  const out = JSON.parse(res.body);
  assert.equal(out.tool_call_id, 'tc_1');
  assert.equal(JSON.parse(out.result).state, 'CLOSED');
});

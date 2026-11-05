'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { traced, peekIdentity, summarizeResponse, applyFault, FAULT_KEYS, FAULTS } = require('../netlify/functions/lib/call-trace.js');

const body = { tool_name: 'create_incident', call_sid: 'CAabc', conversation_id: 'conv_1', caller_id: '+17025550100', reportedName: 'Pat', destination: 'pat@example.com' };
const event = (b = body) => ({ httpMethod: 'POST', headers: {}, body: JSON.stringify(b), isBase64Encoded: false });
const ok = { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ success: true, state: 'CONFIRMED', caseNumber: 'PMA-1' }) };

function fakeLab(drill = null) {
  const rows = []; const hits = [];
  return { rows, hits, activeDrill: async () => drill, write: async (r) => { rows.push(r); }, hit: async (id) => { hits.push(id); } };
}

test('peekIdentity reads identity and masks the destination', () => {
  const id = peekIdentity(JSON.stringify(body));
  assert.equal(id.call_sid, 'CAabc');
  assert.equal(id.caller_id, '+17025550100');
  assert.equal(id.request_summary.reportedName, 'Pat');
  assert.equal(id.request_summary.destination, 'pa***@example.com');
  assert.equal(id.request_summary.call_sid, undefined);
});

test('no drill: real handler runs and one finished trace row is written', async () => {
  const lab = fakeLab();
  let ran = 0;
  const h = traced(async () => { ran++; return ok; }, { lab });
  const res = await h(event());
  assert.equal(ran, 1);
  assert.equal(res.statusCode, 200);
  assert.equal(lab.rows.length, 1);
  assert.equal(lab.rows[0].phase, 'finished');
  assert.equal(lab.rows[0].outcome_state, 'CONFIRMED');
  assert.equal(lab.rows[0].success, true);
  assert.equal(lab.rows[0].fault_key, null);
});

test('handler errors set on ctx are recorded', async () => {
  const lab = fakeLab();
  const h = traced(async (_e, ctx) => { ctx.error = 'close_session: PMA_RPC_P0001'; return { statusCode: 200, headers: {}, body: JSON.stringify({ success: false, state: 'UNKNOWN' }) }; }, { lab });
  await h(event());
  assert.equal(lab.rows[0].error, 'close_session: PMA_RPC_P0001');
  assert.equal(lab.rows[0].success, false);
});

test('armed drill replaces the real handler and counts a hit', async () => {
  const lab = fakeLab({ id: 'd1', fault_key: 'tool_auth', tool_scope: 'create_incident' });
  let ran = 0;
  const h = traced(async () => { ran++; return ok; }, { lab });
  const res = await h(event());
  assert.equal(ran, 0);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(lab.hits, ['d1']);
  assert.equal(lab.rows[0].fault_key, 'tool_auth');
});

test('no lab configured: handler runs untouched', async () => {
  const h = traced(async () => ok, { lab: null });
  assert.equal((await h(event())).statusCode, 200);
});

test('fault responses look like the real failures', async () => {
  const run = async () => ok;
  assert.equal((await applyFault('tool_500', run)).statusCode, 500);
  const db = await applyFault('db_unavailable', run);
  assert.equal(db.statusCode, 200);
  assert.equal(JSON.parse(db.body).state, 'DATABASE_UNAVAILABLE');
  const html = await applyFault('bad_json', run);
  assert.match(html.headers['content-type'], /text\/html/);
  assert.equal(summarizeResponse(html).state, undefined);
});

test('every fault has a full answer key', () => {
  for (const k of FAULT_KEYS) for (const f of ['label', 'layer', 'symptom', 'evidence', 'cause', 'remedy']) assert.ok(FAULTS[k][f], `${k}.${f}`);
});

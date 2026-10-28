'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

// Stub @supabase/supabase-js so no network is touched.
let rpcOverride = null;
const sbPath = require.resolve('@supabase/supabase-js');
require.cache[sbPath] = {
  id: sbPath, filename: sbPath, loaded: true,
  exports: {
    createClient: () => ({
      rpc: async (name, args) => {
        if (rpcOverride) return rpcOverride(name, args);
        return { data: { success: true, caseNumber: 'PMA-001', status: 'New', isEmergency: false }, error: null };
      },
    }),
  },
};

process.env.SUPABASE_URL = 'https://vqrqyanqsiqzsmlhytaz.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';

const { handler } = require('../netlify/functions/pma-portal-api.js');

function makeEvent(method, qs = {}, headers = {}) {
  return {
    httpMethod: method,
    path: '/api/portal/case',
    queryStringParameters: qs,
    body: null,
    headers: { 'x-forwarded-for': '1.2.3.4', ...headers },
  };
}

const VALID_TOKEN = 'validtoken_abc123_xyz';

test('405 on non-GET method', async () => {
  const res = await handler(makeEvent('POST', { t: VALID_TOKEN }));
  assert.equal(res.statusCode, 405);
});

test('400 when token is missing', async () => {
  const res = await handler(makeEvent('GET', {}));
  assert.equal(res.statusCode, 400);
});

test('400 when token is too short', async () => {
  const res = await handler(makeEvent('GET', { t: 'ab' }));
  assert.equal(res.statusCode, 400);
});

test('returns 404 when RPC returns NOT_FOUND', async () => {
  rpcOverride = () => ({ data: { success: false, state: 'NOT_FOUND' }, error: null });
  const res = await handler(makeEvent('GET', { t: VALID_TOKEN }));
  assert.equal(res.statusCode, 404);
  const d = JSON.parse(res.body);
  assert.equal(d.success, false);
  rpcOverride = null;
});

test('returns 404 when RPC returns null', async () => {
  rpcOverride = () => ({ data: null, error: null });
  const res = await handler(makeEvent('GET', { t: VALID_TOKEN }));
  assert.equal(res.statusCode, 404);
  rpcOverride = null;
});

test('200 with case data on valid token', async () => {
  const caseData = { success: true, caseNumber: 'PMA-E3C6954CFA', status: 'Scheduled', isEmergency: false, language: 'en' };
  rpcOverride = () => ({ data: caseData, error: null });
  const res = await handler(makeEvent('GET', { t: VALID_TOKEN }));
  assert.equal(res.statusCode, 200);
  const d = JSON.parse(res.body);
  assert.equal(d.caseNumber, 'PMA-E3C6954CFA');
  rpcOverride = null;
});

test('hashes token with SHA-256 before calling RPC', async () => {
  const expectedHash = crypto.createHash('sha256').update(VALID_TOKEN).digest('hex');
  let capturedHash;
  rpcOverride = (name, args) => { capturedHash = args.token_hash; return { data: { success: true }, error: null }; };
  await handler(makeEvent('GET', { t: VALID_TOKEN }));
  assert.equal(capturedHash, expectedHash);
  rpcOverride = null;
});

test('calls pma_portal_case_view_v1 RPC', async () => {
  let calledWith;
  rpcOverride = (name) => { calledWith = name; return { data: { success: true }, error: null }; };
  await handler(makeEvent('GET', { t: VALID_TOKEN }));
  assert.equal(calledWith, 'pma_portal_case_view_v1');
  rpcOverride = null;
});

test('500 on RPC error', async () => {
  rpcOverride = () => ({ data: null, error: { message: 'db error' } });
  const res = await handler(makeEvent('GET', { t: VALID_TOKEN }));
  assert.equal(res.statusCode, 500);
  rpcOverride = null;
});

test('503 when Supabase env missing', async () => {
  const savedUrl = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  const res = await handler(makeEvent('GET', { t: VALID_TOKEN }));
  assert.equal(res.statusCode, 503);
  process.env.SUPABASE_URL = savedUrl;
});

test('no-store cache-control header set', async () => {
  rpcOverride = () => ({ data: { success: true }, error: null });
  const res = await handler(makeEvent('GET', { t: VALID_TOKEN }));
  assert.match(res.headers['cache-control'], /no-store/);
  rpcOverride = null;
});

test('rate limit triggers 429 after 30 requests from same IP', async () => {
  rpcOverride = () => ({ data: { success: true }, error: null });
  const ip = '99.99.99.99';
  // Send 30 to exhaust the window (each handler call increments the counter)
  // Use a fresh module instance to avoid state from previous tests.
  // We can't easily reset the in-process Map, so we just verify the handler
  // eventually returns 429 for a fresh IP hammered enough times.
  let got429 = false;
  for (let i = 0; i < 35; i++) {
    const ev = makeEvent('GET', { t: VALID_TOKEN }, { 'x-forwarded-for': ip });
    const res = await handler(ev);
    if (res.statusCode === 429) { got429 = true; break; }
  }
  assert.ok(got429, 'Expected 429 after exceeding rate limit');
  rpcOverride = null;
});

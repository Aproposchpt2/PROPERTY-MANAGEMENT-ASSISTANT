'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Stub pma-auth so no Supabase is touched.
const authPath = path.join(__dirname, '../netlify/functions/lib/pma-auth.js');
let authOverride = null;
require.cache[require.resolve(authPath)] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    verifyManager: async () => authOverride || {
      authUserId: 'auth_user_1',
      tenantUserId: 'tu_1',
      role: 'OWNER',
      allowedPropertyIds: ['prop_1'],
    },
  },
};

// Stub @supabase/supabase-js so no network is touched.
let rpcOverride = null;
const sbPath = require.resolve('@supabase/supabase-js');
require.cache[sbPath] = {
  id: sbPath, filename: sbPath, loaded: true,
  exports: {
    createClient: () => ({
      rpc: async (name, args) => {
        if (rpcOverride) return rpcOverride(name, args);
        return { data: { success: true, cases: [], vendors: [] }, error: null };
      },
    }),
  },
};

process.env.SUPABASE_URL = 'https://vqrqyanqsiqzsmlhytaz.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
process.env.PMA_TENANT_ID = 'tenant_1';
process.env.PMA_PROPERTY_ID = 'prop_1';

const { handler } = require('../netlify/functions/pma-manager-api.js');

function makeEvent(method, path, body = null, qs = {}) {
  return {
    httpMethod: method,
    path,
    queryStringParameters: qs,
    body: body ? JSON.stringify(body) : null,
    headers: { authorization: 'Bearer test_token' },
  };
}

test('405 on unsupported method', async () => {
  const res = await handler(makeEvent('DELETE', '/api/manager/cases'));
  assert.equal(res.statusCode, 405);
});

test('401 when verifyManager rejects', async () => {
  authOverride = { statusCode: 401, error: 'Unauthorized' };
  const res = await handler(makeEvent('GET', '/api/manager/cases'));
  assert.equal(res.statusCode, 401);
  authOverride = null;
});

test('403 when property not in allowed list', async () => {
  authOverride = { authUserId: 'u1', tenantUserId: 'tu1', role: 'MANAGER', allowedPropertyIds: ['other_prop'] };
  const res = await handler(makeEvent('GET', '/api/manager/cases'));
  assert.equal(res.statusCode, 403);
  authOverride = null;
});

test('GET /api/manager/cases returns case list', async () => {
  rpcOverride = (name) => {
    assert.equal(name, 'pma_mgr_case_list_v1');
    return { data: { success: true, cases: [{ id: 'c1', case_number: 'PMA-001', status: 'New' }] }, error: null };
  };
  const res = await handler(makeEvent('GET', '/api/manager/cases'));
  assert.equal(res.statusCode, 200);
  const d = JSON.parse(res.body);
  assert.equal(d.success, true);
  assert.equal(d.cases.length, 1);
  rpcOverride = null;
});

test('GET /api/manager/cases passes status_filter from query string', async () => {
  let captured;
  rpcOverride = (name, args) => { captured = args; return { data: { success: true, cases: [] }, error: null }; };
  await handler(makeEvent('GET', '/api/manager/cases', null, { status: 'New,Assigned' }));
  assert.deepEqual(captured.status_filter, ['New', 'Assigned']);
  rpcOverride = null;
});

test('GET /api/manager/cases/:id returns 404 when NOT_FOUND', async () => {
  rpcOverride = () => ({ data: { success: false, state: 'NOT_FOUND' }, error: null });
  const res = await handler(makeEvent('GET', '/api/manager/cases/nonexistent'));
  assert.equal(res.statusCode, 404);
  rpcOverride = null;
});

test('PATCH /api/manager/cases/:id updates case', async () => {
  let captured;
  rpcOverride = (name, args) => { captured = args; return { data: { success: true }, error: null }; };
  const res = await handler(makeEvent('PATCH', '/api/manager/cases/c1', { status: 'Scheduled', tenant_update: 'Vendor assigned' }));
  assert.equal(res.statusCode, 200);
  assert.equal(captured.request_id, 'c1');
  assert.equal(captured.patch.status, 'Scheduled');
  rpcOverride = null;
});

test('POST /api/manager/cases/:id/assign calls assignment RPC', async () => {
  let rpcName;
  rpcOverride = (name) => { rpcName = name; return { data: { success: true }, error: null }; };
  const res = await handler(makeEvent('POST', '/api/manager/cases/c1/assign', { vendorId: 'v1', scheduledStart: '2026-11-01T09:00', scheduledEnd: '2026-11-01T11:00' }));
  assert.equal(res.statusCode, 200);
  assert.equal(rpcName, 'pma_mgr_assignment_set_v1');
  rpcOverride = null;
});

test('GET /api/manager/vendors returns vendor list', async () => {
  rpcOverride = (name) => {
    assert.equal(name, 'pma_mgr_vendor_list_v1');
    return { data: { success: true, vendors: [{ id: 'v1', company_name: 'ABC Plumbing', trade: 'plumbing' }] }, error: null };
  };
  const res = await handler(makeEvent('GET', '/api/manager/vendors'));
  assert.equal(res.statusCode, 200);
  const d = JSON.parse(res.body);
  assert.equal(d.vendors.length, 1);
  rpcOverride = null;
});

test('POST /api/manager/vendors upserts vendor', async () => {
  let captured;
  rpcOverride = (name, args) => { captured = args; return { data: { success: true }, error: null }; };
  const res = await handler(makeEvent('POST', '/api/manager/vendors', { name: 'Test Co', trade: 'electrical', phone: '+17025551234' }));
  assert.equal(res.statusCode, 200);
  assert.equal(captured.name, 'Test Co');
  assert.equal(captured.trade, 'electrical');
  rpcOverride = null;
});

test('404 on unknown route', async () => {
  const res = await handler(makeEvent('GET', '/api/manager/unknown'));
  assert.equal(res.statusCode, 404);
});

test('400 on invalid JSON body', async () => {
  const ev = makeEvent('PATCH', '/api/manager/cases/c1');
  ev.body = '{invalid json}';
  const res = await handler(ev);
  assert.equal(res.statusCode, 400);
});

test('500 on RPC error', async () => {
  rpcOverride = () => ({ data: null, error: { code: '42501', message: 'permission denied' } });
  const res = await handler(makeEvent('GET', '/api/manager/cases'));
  assert.equal(res.statusCode, 500);
  rpcOverride = null;
});

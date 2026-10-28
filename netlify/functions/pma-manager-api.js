'use strict';

const { createClient } = require('@supabase/supabase-js');
const { verifyManager } = require('./lib/pma-auth');

const CORS = {
  'content-type': 'application/json',
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex',
};

function json(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function makeRpc(env) {
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return async (name, args) => {
    const { data, error } = await db.rpc(name, {
      t: env.PMA_TENANT_ID,
      p: env.PMA_PROPERTY_ID,
      ...args,
    });
    if (error) throw new Error(`RPC_${error.code || 'FAILED'}: ${error.message}`);
    return data;
  };
}

exports.handler = async function handler(event) {
  const env = process.env;
  if (!['GET', 'POST', 'PATCH', 'PUT'].includes(event.httpMethod)) {
    return json(405, { error: 'Method not allowed' });
  }
  const auth = await verifyManager(event, env);
  if (auth.statusCode) return json(auth.statusCode, { error: auth.error });
  const { authUserId, allowedPropertyIds } = auth;
  if (!allowedPropertyIds.includes(env.PMA_PROPERTY_ID)) {
    return json(403, { error: 'Property access denied' });
  }
  const segments = event.path.replace(/^\/api\/manager\/?/, '').split('/').filter(Boolean);
  const action = segments[0] || '';
  const id = segments[1] || '';
  const sub = segments[2] || '';
  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON' }); }
  }
  const rpc = makeRpc(env);
  try {
    // GET /api/manager/cases
    if (action === 'cases' && !id && event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const status_filter = params.status ? params.status.split(',') : null;
      const data = await rpc('pma_mgr_case_list_v1', { status_filter });
      return json(200, data);
    }
    // GET /api/manager/cases/:id
    if (action === 'cases' && id && !sub && event.httpMethod === 'GET') {
      const data = await rpc('pma_mgr_case_get_v1', { request_id: id });
      if (data && data.state === 'NOT_FOUND') return json(404, data);
      return json(200, data);
    }
    // PATCH /api/manager/cases/:id
    if (action === 'cases' && id && !sub && event.httpMethod === 'PATCH') {
      const data = await rpc('pma_mgr_case_update_v1', {
        request_id: id, actor_user_id: authUserId, patch: body,
      });
      if (data && data.state === 'NOT_FOUND') return json(404, data);
      return json(200, data);
    }
    // POST /api/manager/cases/:id/assign
    if (action === 'cases' && id && sub === 'assign' && event.httpMethod === 'POST') {
      const data = await rpc('pma_mgr_assignment_set_v1', {
        request_id: id,
        actor_user_id: authUserId,
        vendor_id: body.vendorId,
        scheduled_start: body.scheduledStart || null,
        scheduled_end: body.scheduledEnd || null,
        work_order_ref: body.workOrderRef || null,
      });
      if (data && (data.state === 'NOT_FOUND' || data.state === 'VENDOR_NOT_FOUND')) {
        return json(404, data);
      }
      return json(200, data);
    }
    // GET /api/manager/vendors
    if (action === 'vendors' && !id && event.httpMethod === 'GET') {
      const data = await rpc('pma_mgr_vendor_list_v1', {});
      return json(200, data);
    }
    // POST /api/manager/vendors
    if (action === 'vendors' && !id && event.httpMethod === 'POST') {
      const data = await rpc('pma_mgr_vendor_upsert_v1', {
        actor_user_id: authUserId,
        name: body.name,
        trade: body.trade,
        phone: body.phone,
        v_status: body.status || 'active',
      });
      return json(200, data);
    }
    // POST /api/manager/cases/:id/approve
    if (action === 'cases' && id && sub === 'approve' && event.httpMethod === 'POST') {
      const response = (body.response || '').toUpperCase();
      if (!['APPROVED', 'DECLINED'].includes(response)) return json(400, { error: 'response must be APPROVED or DECLINED' });
      const data = await rpc('pma_mgr_approve_case_v1', { request_id: id, actor_user_id: authUserId, response });
      if (data && data.state === 'NOT_FOUND') return json(404, data);
      return json(200, data);
    }
    // GET /api/manager/preauth
    if (action === 'preauth' && !id && event.httpMethod === 'GET') {
      const data = await rpc('pma_preauth_rules_list_v1', {});
      return json(200, data);
    }
    // POST /api/manager/preauth
    if (action === 'preauth' && !id && event.httpMethod === 'POST') {
      const data = await rpc('pma_preauth_rule_upsert_v1', {
        actor_user_id: authUserId,
        rule_id: body.ruleId || null,
        rule_property_id: body.propertyId || null,
        category: body.category || null,
        max_amount: body.maxAmount,
        allow_emergency: body.allowEmergency || false,
        active: body.active !== false,
      });
      return json(200, data);
    }
    return json(404, { error: 'Not found' });
  } catch (err) {
    console.error(JSON.stringify({ event: 'pma_mgr_api_error', path: event.path, error: err?.message }));
    return json(500, { error: 'Internal error' });
  }
};

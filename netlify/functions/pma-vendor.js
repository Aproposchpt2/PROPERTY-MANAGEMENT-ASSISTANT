'use strict';

const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { sendVendorApprovalRequest, sendVendorSms } = require('./lib/pma-sms');

const CORS = {
  'content-type': 'application/json',
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex',
};

function json(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function safeEqual(a, b) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifyToolKey(header, key) {
  if (typeof key !== 'string' || key.length < 32) return false;
  if (typeof header !== 'string' || !header) return false;
  return safeEqual(header, key);
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
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const key = event.headers && (event.headers['x-pma-tool-key'] || event.headers['X-Pma-Tool-Key']);
  if (!verifyToolKey(key, env.PMA_VENDOR_TOOL_KEY)) {
    return json(401, { error: 'Unauthorized' });
  }

  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON' }); }
  }

  const callerPhone = body.caller_phone || body.callerPhone || '';
  const action = body.action || '';
  if (!callerPhone) return json(400, { error: 'caller_phone required' });

  const rpc = makeRpc(env);

  try {
    const vendor = await rpc('pma_vendor_lookup_v1', { caller_phone: callerPhone });
    if (!vendor || !vendor.success) {
      return json(200, { success: false, state: 'UNKNOWN_VENDOR',
        message: 'Your number is not registered as a vendor. Please contact the property manager.' });
    }
    const vendorId = vendor.vendorId;

    if (action === 'list_work_orders') {
      const data = await rpc('pma_vendor_work_orders_v1', {
        vendor_id: vendorId, case_number: body.case_number || null });
      return json(200, data);
    }

    if (action === 'accept') {
      if (!body.case_number) return json(400, { error: 'case_number required' });
      const data = await rpc('pma_vendor_accept_v1', { vendor_id: vendorId, case_number: body.case_number });
      return json(200, data);
    }

    if (action === 'decline') {
      if (!body.case_number) return json(400, { error: 'case_number required' });
      const data = await rpc('pma_vendor_decline_v1', {
        vendor_id: vendorId, case_number: body.case_number, reason: body.reason || null });
      return json(200, data);
    }

    if (action === 'propose_window') {
      if (!body.case_number || !body.proposed_start || !body.proposed_end) {
        return json(400, { error: 'case_number, proposed_start, proposed_end required' });
      }
      const data = await rpc('pma_vendor_propose_window_v1', {
        vendor_id: vendorId, case_number: body.case_number,
        proposed_start: body.proposed_start, proposed_end: body.proposed_end });
      if (data && data.success && data.windowState === 'PROPOSED' && data.tenantPhone) {
        await sendVendorSms({
          to: data.tenantPhone,
          body: `Desert Ridge: Your maintenance case #${body.case_number} has a proposed service window. ` +
            `Your manager will confirm shortly.`,
          env,
        }).catch(() => {});
      }
      return json(200, data);
    }

    if (action === 'post_status') {
      if (!body.case_number || !body.new_status) return json(400, { error: 'case_number, new_status required' });
      const data = await rpc('pma_vendor_post_status_v1', {
        vendor_id: vendorId, case_number: body.case_number,
        new_status: body.new_status, note: body.note || null });
      return json(200, data);
    }

    if (action === 'request_nte') {
      if (!body.case_number || !body.amount) return json(400, { error: 'case_number, amount required' });
      const amount = parseFloat(body.amount);
      if (isNaN(amount) || amount <= 0) return json(400, { error: 'amount must be a positive number' });
      const data = await rpc('pma_vendor_request_nte_v1', {
        vendor_id: vendorId, case_number: body.case_number,
        amount, reason: body.reason || null });
      if (data && data.success && data.approvalState === 'PENDING' && data.approvers) {
        for (const approver of data.approvers) {
          if (!approver.notificationPhone || !approver.requestId) continue;
          const rawToken = crypto.randomBytes(32).toString('hex');
          const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
          const insertResult = await rpc('pma_approval_insert_v1', {
            request_id: approver.requestId,
            approver_user_id: approver.userId,
            amount,
            token_hash: tokenHash,
          });
          if (!insertResult || !insertResult.success) continue;
          const approveUrl = `${env.PMA_BASE_URL || 'https://pma.stellaruc.com'}/approve?t=${rawToken}`;
          const shortCode = insertResult.shortCode || '';
          await sendVendorApprovalRequest({
            to: approver.notificationPhone,
            approverName: approver.name || 'Manager',
            caseNumber: body.case_number,
            amount,
            approveUrl,
            shortCode,
            env,
          }).catch(() => {});
        }
      }
      return json(200, data);
    }

    return json(400, { error: `Unknown action: ${action}` });
  } catch (err) {
    console.error(JSON.stringify({ event: 'pma_vendor_error', action, error: err?.message }));
    return json(500, { error: 'Internal error' });
  }
};

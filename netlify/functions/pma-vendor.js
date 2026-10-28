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

const PROPERTY_TZ = 'America/Los_Angeles';

// Avery sends times like 2026-11-05T09:00:00 with no zone. Treat those as the
// property's local time; keep any value that already carries Z or an offset.
function localToIso(value, tz = PROPERTY_TZ) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const v = value.trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(v)) { const d = new Date(v); return isNaN(d) ? null : d.toISOString(); }
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const offsetAt = (ms) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - ms;
  };
  let ms = asUtc - offsetAt(asUtc);
  ms = asUtc - offsetAt(ms);
  return new Date(ms).toISOString();
}

// Add spoken local times so Avery never converts UTC herself.
function speakTimes(order, tz = PROPERTY_TZ) {
  const day = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(iso));
  const time = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const out = { ...order };
  if (order.scheduledStart) { out.scheduledDayLocal = day(order.scheduledStart); out.scheduledStartLocal = time(order.scheduledStart); }
  if (order.scheduledEnd) out.scheduledEndLocal = time(order.scheduledEnd);
  if (order.proposedStart) { out.proposedDayLocal = day(order.proposedStart); out.proposedStartLocal = time(order.proposedStart); }
  if (order.proposedEnd) out.proposedEndLocal = time(order.proposedEnd);
  return out;
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
      if (data && Array.isArray(data.workOrders)) data.workOrders = data.workOrders.map((o) => speakTimes(o));
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
      const proposedStart = localToIso(body.proposed_start);
      const proposedEnd = localToIso(body.proposed_end);
      if (!proposedStart || !proposedEnd) return json(400, { error: 'proposed_start and proposed_end must be dates like 2026-11-05T09:00:00' });
      if (new Date(proposedEnd) <= new Date(proposedStart)) return json(400, { error: 'proposed_end must be after proposed_start' });
      const data = await rpc('pma_vendor_propose_window_v1', {
        vendor_id: vendorId, case_number: body.case_number,
        proposed_start: proposedStart, proposed_end: proposedEnd });
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
      // The RPC returns { approved, requestId, approvers: [{ tenantUserId, email, phone }] }.
      let notified = 0;
      const isApproved = !!(data && (data.approved === true || data.approvalState === 'APPROVED'));
      if (data && data.success && !isApproved && Array.isArray(data.approvers)) {
        for (const approver of data.approvers) {
          const approverPhone = approver.phone || approver.notificationPhone;
          const approverId = approver.tenantUserId || approver.userId;
          const requestId = data.requestId || approver.requestId;
          if (!approverPhone || !approverId || !requestId) continue;
          const rawToken = crypto.randomBytes(32).toString('hex');
          const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
          const insertResult = await rpc('pma_approval_insert_v1', {
            request_id: requestId,
            approver_user_id: approverId,
            amount,
            token_hash: tokenHash,
          });
          if (!insertResult || !insertResult.success) continue;
          const approveUrl = `${env.PMA_BASE_URL || 'https://pma.stellaruc.com'}/approve?t=${rawToken}`;
          const shortCode = insertResult.shortCode || '';
          await sendVendorApprovalRequest({
            to: approverPhone,
            approverName: approver.name || 'Manager',
            caseNumber: body.case_number,
            amount,
            approveUrl,
            shortCode,
            env,
          }).then(() => { notified += 1; }).catch((e) => {
            console.error(JSON.stringify({ event: 'pma_nte_sms_failed', error: e && e.message }));
          });
        }
      }
      if (data && data.success) {
        // Plain fields for Avery; never expose approver contact details to the caller.
        return json(200, {
          success: true,
          caseNumber: data.caseNumber || body.case_number,
          amount: data.amount,
          approvalState: isApproved ? 'APPROVED' : 'PENDING',
          approvalChannel: data.approvalChannel || null,
          managerNotified: notified > 0,
        });
      }
      return json(200, data);
    }

    return json(400, { error: `Unknown action: ${action}` });
  } catch (err) {
    console.error(JSON.stringify({ event: 'pma_vendor_error', action, error: err?.message }));
    return json(500, { error: 'Internal error' });
  }
};

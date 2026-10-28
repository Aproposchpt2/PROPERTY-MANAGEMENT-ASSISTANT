'use strict';

const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { sendVendorSms } = require('./lib/pma-sms');

const HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex',
};

function json(statusCode, body) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(body) };
}

function makeDb(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

exports.handler = async function handler(event) {
  const env = process.env;
  const params = event.queryStringParameters || {};
  const rawToken = params.t || '';
  if (!rawToken || rawToken.length < 16) {
    return json(400, { error: 'Invalid or missing token' });
  }
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(503, { error: 'Unavailable' });
  }
  const db = makeDb(env);

  // GET — load approval details for the page
  if (event.httpMethod === 'GET') {
    const { data, error } = await db.rpc('pma_approval_load_v1', { token_hash: tokenHash });
    if (error) {
      console.error(JSON.stringify({ event: 'pma_approve_load_error', error: error?.message }));
      return json(500, { error: 'Internal error' });
    }
    if (!data || !data.success) {
      return json(404, { success: false, state: data?.state || 'NOT_FOUND' });
    }
    return json(200, data);
  }

  // POST — submit approval response
  if (event.httpMethod === 'POST') {
    let body = {};
    if (event.body) {
      try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON' }); }
    }
    const response = (body.response || '').toUpperCase();
    if (!['APPROVED', 'DECLINED'].includes(response)) {
      return json(400, { error: 'response must be APPROVED or DECLINED' });
    }
    const { data, error } = await db.rpc('pma_approval_respond_v1', { response, token_hash: tokenHash, short_code: null });
    if (error) {
      console.error(JSON.stringify({ event: 'pma_approve_respond_error', error: error?.message }));
      return json(500, { error: 'Internal error' });
    }
    if (!data || !data.success) {
      const state = data?.state || 'NOT_FOUND';
      return json(state === 'EXPIRED' ? 410 : 404, { success: false, state });
    }
    if (data.vendorPhone && response === 'APPROVED') {
      await sendVendorSms({
        to: data.vendorPhone,
        body: `PMA: Your NTE quote of $${Number(data.amount).toFixed(2)} for case #${data.caseNumber} was approved. Proceed with work.`,
        env,
      }).catch(() => {});
    }
    return json(200, { success: true, response: data.response, caseNumber: data.caseNumber, amount: data.amount });
  }

  return json(405, { error: 'Method not allowed' });
};

'use strict';

const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

// In-process IP rate limiter (best-effort; not global across Lambda instances).
const _rl = new Map();
const RL_MAX = 30, RL_WINDOW = 60_000;
function checkRate(ip) {
  const now = Date.now();
  const e = _rl.get(ip);
  if (!e || e.r <= now) { _rl.set(ip, { c: 1, r: now + RL_WINDOW }); return true; }
  if (e.c >= RL_MAX) return false;
  e.c++; return true;
}

const HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex',
};

exports.handler = async function handler(event) {
  const env = process.env;
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'GET only' }) };
  }
  const ip = (event.headers || {})['x-forwarded-for'] || 'unknown';
  if (!checkRate(ip.split(',')[0].trim())) {
    return { statusCode: 429, headers: HEADERS, body: JSON.stringify({ error: 'Too many requests' }) };
  }
  const params = event.queryStringParameters || {};
  const rawToken = params.t || '';
  if (!rawToken || rawToken.length < 4) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing token' }) };
  }
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 503, headers: HEADERS, body: JSON.stringify({ error: 'Unavailable' }) };
  }
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.rpc('pma_portal_case_view_v1', { token_hash: tokenHash });
  if (error) {
    console.error(JSON.stringify({ event: 'pma_portal_api_error', error: error?.message }));
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal error' }) };
  }
  if (!data || !data.success) {
    return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ success: false, state: 'NOT_FOUND' }) };
  }
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify(data) };
};

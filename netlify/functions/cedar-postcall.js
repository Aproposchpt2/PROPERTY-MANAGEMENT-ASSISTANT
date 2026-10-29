'use strict';

// ElevenLabs post-call webhook handler.
// Fires after each conversation ends; logs duration, credits, and estimated
// Twilio cost to pma_call_log for Command Center monitoring.
//
// ElevenLabs signs every post-call webhook with HMAC-SHA256.
// Header: ElevenLabs-Signature: t={unix_ts},v0={hex_hmac}
// Set ELEVENLABS_POSTCALL_SECRET in Netlify env vars to the signing secret
// configured in ElevenLabs workspace settings → Webhooks.

const crypto = require('node:crypto');
const { createStore } = require('./lib/cedar-store');

const TWILIO_INBOUND_US_PER_MIN = 0.0085;

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifySignature(rawBody, header, secret, now = Date.now()) {
  if (typeof secret !== 'string' || secret.length < 8) throw new Error('NO_POSTCALL_SECRET');
  if (typeof header !== 'string' || !header) throw new Error('MISSING_SIG');
  const parts = {};
  for (const seg of header.split(',')) {
    const eq = seg.indexOf('=');
    if (eq > 0) parts[seg.slice(0, eq).trim()] = seg.slice(eq + 1).trim();
  }
  const { t: ts, v0: mac } = parts;
  if (!ts || !mac || !/^\d{1,12}$/.test(ts) || Math.abs(now / 1000 - Number(ts)) > 300) {
    throw new Error('INVALID_SIG');
  }
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  if (!safeEqual(mac, expected)) throw new Error('INVALID_SIG');
  return JSON.parse(rawBody);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    const secret = process.env.ELEVENLABS_POSTCALL_SECRET || '';
    const sig = event.headers['elevenlabs-signature'] || event.headers['ElevenLabs-Signature'] || '';
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : (event.body || '');
    body = verifySignature(raw, sig, secret);
  } catch (err) {
    console.error('[cedar-postcall] auth failed:', err.message);
    return { statusCode: 401, body: JSON.stringify({ error: err.message }) };
  }

  try {
    const data = body?.data || body;
    const conversation_id = data?.conversation_id || null;
    const agent_id = data?.agent_id || null;
    const meta = data?.metadata || {};
    const analysis = data?.analysis || {};

    const call_duration_secs = Math.round(Number(meta.call_duration_secs || 0));
    const started_at = meta.start_time_unix_secs
      ? new Date(meta.start_time_unix_secs * 1000).toISOString()
      : null;
    const call_successful = analysis.call_successful || null;
    const termination_reason = analysis.termination_reason || null;

    // credits_used: ElevenLabs may include usage info; treat as optional
    const credits_used = data?.cost?.credits ?? data?.usage?.credits ?? null;
    const credits_int = credits_used !== null ? Math.round(Number(credits_used)) : null;

    const twilio_cost_usd = call_duration_secs > 0
      ? Math.round((call_duration_secs / 60) * TWILIO_INBOUND_US_PER_MIN * 10000) / 10000
      : null;

    if (!conversation_id) {
      console.warn('[cedar-postcall] missing conversation_id, skipping');
      return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true }) };
    }

    const store = createStore();
    await store.logCall({
      conversation_id,
      agent_id,
      call_duration_secs,
      credits_used: credits_int,
      twilio_cost_usd,
      termination_reason,
      call_successful,
      started_at,
    });

    console.log(`[cedar-postcall] logged conversation_id=${conversation_id} duration=${call_duration_secs}s twilio_cost=$${twilio_cost_usd}`);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    // Return 200 so ElevenLabs does not auto-disable the webhook on DB errors.
    // The actual failure is visible in Netlify function logs via the console.error below.
    console.error('[cedar-postcall] store error:', err.message);
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'LOG_FAILED', detail: err.message }) };
  }
};

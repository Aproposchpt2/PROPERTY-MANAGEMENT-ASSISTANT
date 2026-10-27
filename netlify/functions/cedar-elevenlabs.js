'use strict';

// ElevenLabs tool webhook handler for the Cedar agent.
// ElevenLabs fires this endpoint when the LLM calls create_incident,
// record_contact_preference, or close_session.
//
// Two entry paths are supported:
//   1. cedar-twilio.js path: session_id and call_sid arrive as dynamic variables
//      injected via TwiML <Parameter> tags.
//   2. ElevenLabs-native phone number path: session_id and call_sid are absent.
//      In this case, conversation_id from the payload is used as call_sid and
//      caller_id from dynamic variables is used as caller_number for lazy session init.
//
// In both cases, if session_id is missing, a session is created lazily via
// pma_voice_session_start_v1 (which is idempotent — safe to call multiple times
// for the same call_sid).

const crypto = require('node:crypto');
const { createStore } = require('./lib/cedar-store');

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifyElevenLabs(rawBody, header, secret, now = Date.now()) {
  // Header format: t={unix_timestamp},v0={hex_hmac}
  // HMAC-SHA256 over "{timestamp}.{raw_body}" using the webhook secret.
  if (typeof secret !== 'string' || secret.length < 16) throw new Error('INVALID_EL_SECRET');
  if (typeof header !== 'string' || !header) throw new Error('INVALID_EL_SIG');
  const parts = {};
  for (const seg of header.split(',')) {
    const eq = seg.indexOf('=');
    if (eq > 0) parts[seg.slice(0, eq).trim()] = seg.slice(eq + 1).trim();
  }
  const { t: ts, v0: mac } = parts;
  if (!ts || !mac || !/^\d{1,12}$/.test(ts) || Math.abs(now / 1000 - Number(ts)) > 300) {
    throw new Error('INVALID_EL_SIG');
  }
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  if (!safeEqual(mac, expected)) throw new Error('INVALID_EL_SIG');
  return JSON.parse(rawBody);
}

function toolResponse(toolCallId, result) {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' },
    body: JSON.stringify({ tool_call_id: toolCallId, result: JSON.stringify(result) }),
  };
}

function errorResponse(toolCallId, state, reply) {
  return toolResponse(toolCallId, { success: false, state, ...(reply ? { reply } : {}) });
}

// E.164 pattern required by pma_voice_session_start_v1.
const E164_RE = /^\+[1-9][0-9]{7,14}$/;
// Printable ASCII pattern required for call_sid.
const CALL_SID_RE = /^[!-~]{1,200}$/;

exports.handler = async function handler(event) {
  const env = process.env;
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'cache-control': 'private, no-store' }, body: JSON.stringify({ error: 'POST only' }) };
  }
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  let payload;
  try {
    payload = verifyElevenLabs(rawBody, headers['elevenlabs-signature'], env.ELEVENLABS_WEBHOOK_SECRET);
  } catch {
    return { statusCode: 401, headers: { 'cache-control': 'private, no-store' }, body: JSON.stringify({ error: 'Invalid signature' }) };
  }
  const { tool_name, tool_call_id, parameters = {} } = payload;
  if (!tool_call_id) {
    return { statusCode: 400, headers: { 'cache-control': 'private, no-store' }, body: JSON.stringify({ error: 'Missing tool_call_id' }) };
  }

  // Resolve call identity — works for both entry paths:
  //   cedar-twilio.js path: dynamic_variables has call_sid and session_id
  //   ElevenLabs-native path: payload.conversation_id is the call identifier;
  //                            dynamic_variables has caller_id (ElevenLabs injects it)
  const dyn = payload.dynamic_variables || {};
  const call_sid = dyn.call_sid || payload.conversation_id;
  const caller_number_raw = dyn.caller_number || dyn.caller_id || '';
  const prebuilt_session_id = dyn.session_id;

  if (!call_sid || !CALL_SID_RE.test(call_sid)) {
    return errorResponse(tool_call_id, 'MISSING_CONTEXT', 'The operation was not confirmed. Do not invent success or a number.');
  }

  let store;
  try {
    store = createStore(env);
  } catch {
    return errorResponse(tool_call_id, 'DATABASE_UNAVAILABLE', 'The operation was not confirmed. Do not invent success or a number.');
  }

  // Resolve session_id — lazy init if not pre-populated (ElevenLabs-native path).
  let session_id = prebuilt_session_id;
  if (!session_id) {
    const caller_number = E164_RE.test(caller_number_raw) ? caller_number_raw : '+10000000000';
    try {
      const binding = await store.start({ call_sid, caller_number });
      session_id = binding.session_id;
    } catch {
      return errorResponse(tool_call_id, 'DATABASE_UNAVAILABLE', 'The operation was not confirmed. Do not invent success or a number.');
    }
  }

  try {
    if (tool_name === 'create_incident') {
      const args = {
        reportedName: parameters.reportedName,
        reportedAddress: parameters.reportedAddress,
        reportedUnit: parameters.reportedUnit,
        description: parameters.description,
      };
      const result = await store.createIncident({ session_id, call_sid, args });
      return toolResponse(tool_call_id, result || { success: false, state: 'UNKNOWN', reply: 'The operation was not confirmed. Do not invent success or a number.' });
    }
    if (tool_name === 'record_contact_preference') {
      const args = {
        method: parameters.method,
        destination: parameters.destination,
        consent: parameters.consent,
      };
      const result = await store.recordPreference({ session_id, call_sid, args });
      return toolResponse(tool_call_id, result || { success: false, state: 'UNKNOWN' });
    }
    if (tool_name === 'close_session') {
      const result = await store.close({ session_id, call_sid });
      return toolResponse(tool_call_id, result || { success: true, state: 'CLOSED' });
    }
    return errorResponse(tool_call_id, 'UNSUPPORTED_TOOL');
  } catch (err) {
    console.error(JSON.stringify({ event: 'cedar_elevenlabs_tool_failed', tool: tool_name, error: err?.message }));
    return errorResponse(tool_call_id, 'UNKNOWN', 'The operation was not confirmed. Do not invent success or a number.');
  }
};

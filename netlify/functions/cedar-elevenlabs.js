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

// ElevenLabs server (webhook) tools do NOT sign requests — only post-call
// webhooks carry ElevenLabs-Signature. Tool calls authenticate with a static
// shared key sent as the x-pma-tool-key header (stored as a secret in
// ElevenLabs, PMA_ELEVENLABS_TOOL_KEY in Netlify).
function verifyToolKey(header, key) {
  if (typeof key !== 'string' || key.length < 32) return false;
  if (typeof header !== 'string' || !header) return false;
  return safeEqual(header, key);
}

// ElevenLabs webhook tools POST only the configured body schema (flat).
// Each Cedar tool sends tool_name as a constant plus call identity from
// system dynamic variables. Legacy envelope payloads ({tool_name,
// tool_call_id, parameters, dynamic_variables}) are still accepted.
const IDENTITY_FIELDS = new Set(['tool_name', 'call_sid', 'conversation_id', 'caller_id', 'session_id']);

function normalizePayload(payload) {
  if (payload && typeof payload === 'object' && payload.tool_call_id) {
    return { envelope: true, ...payload };
  }
  const body = payload && typeof payload === 'object' ? payload : {};
  const parameters = {};
  for (const [k, v] of Object.entries(body)) {
    if (!IDENTITY_FIELDS.has(k)) parameters[k] = v;
  }
  return {
    envelope: false,
    tool_name: body.tool_name,
    tool_call_id: `el_${crypto.randomUUID()}`,
    conversation_id: body.conversation_id,
    parameters,
    dynamic_variables: { call_sid: body.call_sid, caller_id: body.caller_id, session_id: body.session_id },
  };
}

function toolResponse(toolCallId, result, envelope = true) {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' },
    body: JSON.stringify(envelope ? { tool_call_id: toolCallId, result: JSON.stringify(result) } : result),
  };
}

function errorResponse(toolCallId, state, reply, envelope = true) {
  return toolResponse(toolCallId, { success: false, state, ...(reply ? { reply } : {}) }, envelope);
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
  if (verifyToolKey(headers['x-pma-tool-key'], env.PMA_ELEVENLABS_TOOL_KEY)) {
    try {
      payload = JSON.parse(rawBody || '{}');
    } catch {
      return { statusCode: 400, headers: { 'cache-control': 'private, no-store' }, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }
  } else {
    try {
      payload = verifyElevenLabs(rawBody, headers['elevenlabs-signature'], env.ELEVENLABS_WEBHOOK_SECRET);
    } catch {
      console.error(JSON.stringify({ event: 'cedar_elevenlabs_auth_failed', has_tool_key: Boolean(headers['x-pma-tool-key']), has_signature: Boolean(headers['elevenlabs-signature']) }));
      return { statusCode: 401, headers: { 'cache-control': 'private, no-store' }, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
  }
  payload = normalizePayload(payload);
  const { tool_name, tool_call_id, envelope, parameters = {} } = payload;
  const respond = (result) => toolResponse(tool_call_id, result, envelope);
  const fail = (state, reply) => errorResponse(tool_call_id, state, reply, envelope);
  if (!tool_name) {
    return fail('UNSUPPORTED_TOOL', 'The operation was not confirmed. Do not invent success or a number.');
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
    return fail('MISSING_CONTEXT', 'The operation was not confirmed. Do not invent success or a number.');
  }

  let store;
  try {
    store = createStore(env);
  } catch {
    return fail('DATABASE_UNAVAILABLE', 'The operation was not confirmed. Do not invent success or a number.');
  }

  // Resolve session_id — lazy init if not pre-populated (ElevenLabs-native path).
  let session_id = prebuilt_session_id;
  if (!session_id) {
    const caller_number = E164_RE.test(caller_number_raw) ? caller_number_raw : '+10000000000';
    try {
      const binding = await store.start({ call_sid, caller_number });
      session_id = binding.session_id;
    } catch {
      return fail('DATABASE_UNAVAILABLE', 'The operation was not confirmed. Do not invent success or a number.');
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
      return respond(result || { success: false, state: 'UNKNOWN', reply: 'The operation was not confirmed. Do not invent success or a number.' });
    }
    if (tool_name === 'record_contact_preference') {
      const args = {
        method: parameters.method,
        destination: parameters.destination,
        consent: parameters.consent,
      };
      const result = await store.recordPreference({ session_id, call_sid, args });
      return respond(result || { success: false, state: 'UNKNOWN' });
    }
    if (tool_name === 'close_session') {
      const result = await store.close({ session_id, call_sid });
      return respond(result || { success: true, state: 'CLOSED' });
    }
    return fail('UNSUPPORTED_TOOL');
  } catch (err) {
    console.error(JSON.stringify({ event: 'cedar_elevenlabs_tool_failed', tool: tool_name, error: err?.message }));
    return fail('UNKNOWN', 'The operation was not confirmed. Do not invent success or a number.');
  }
};

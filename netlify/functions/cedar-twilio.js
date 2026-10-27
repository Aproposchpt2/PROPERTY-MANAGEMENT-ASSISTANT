'use strict';

// Twilio voice webhook — connects incoming calls to the ElevenLabs Cedar agent.
// Flow: Twilio dials → this function → starts Supabase session → returns TwiML
//       with ElevenLabs stream URL and dynamic variables for the agent.

const crypto = require('node:crypto');
const { createStore } = require('./lib/cedar-store');

const DEFAULT_AGENT_ID = 'agent_4901m5gzk15hfajrapnvb520f9jt';

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifyTwilio(bodyStr, signature, url, authToken) {
  if (typeof authToken !== 'string' || authToken.length < 8) throw new Error('INVALID_TWILIO_TOKEN');
  if (typeof signature !== 'string' || !signature) throw new Error('INVALID_TWILIO_SIG');
  const params = new URLSearchParams(bodyStr);
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  let str = url;
  for (const [k, v] of sorted) str += k + v;
  const expected = crypto.createHmac('sha1', authToken).update(str).digest('base64');
  if (!safeEqual(signature, expected)) throw new Error('INVALID_TWILIO_SIG');
  return Object.fromEntries(params);
}

function esc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildTwiml(agentId, sessionId, callSid, callerNumber) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    '  <Connect>',
    `    <Stream url="wss://api.elevenlabs.io/v1/convai/twilio?agent_id=${esc(agentId)}">`,
    `      <Parameter name="session_id" value="${esc(sessionId)}"/>`,
    `      <Parameter name="call_sid" value="${esc(callSid)}"/>`,
    `      <Parameter name="caller_number" value="${esc(callerNumber)}"/>`,
    '    </Stream>',
    '  </Connect>',
    '</Response>',
  ].join('\n');
}

const REJECT_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>';
const TWIML_HEADERS = { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' };

exports.handler = async function handler(event) {
  const env = process.env;
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: TWIML_HEADERS, body: REJECT_TWIML };
  }
  if (
    env.PMA_CEDAR_ENABLED !== 'true' ||
    env.PMA_RUNTIME_MODE !== 'production-validation' ||
    env.PMA_BASE_URL !== 'https://pma.stellaruc.com'
  ) {
    return { statusCode: 503, headers: { 'cache-control': 'private, no-store' }, body: '' };
  }
  const bodyStr = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  let params;
  try {
    const publicUrl = `${env.PMA_BASE_URL}/api/intake/cedar-twilio`;
    params = verifyTwilio(bodyStr, headers['x-twilio-signature'], publicUrl, env.TWILIO_AUTH_TOKEN);
  } catch {
    console.error(JSON.stringify({ event: 'cedar_twilio_auth_failed' }));
    return { statusCode: 403, headers: { 'cache-control': 'private, no-store' }, body: '' };
  }
  const callSid = params.CallSid;
  const callerNumber = params.From;
  if (!callSid || !callerNumber) {
    return { statusCode: 200, headers: TWIML_HEADERS, body: REJECT_TWIML };
  }
  try {
    const store = createStore(env);
    const binding = await store.start({ call_sid: callSid, caller_number: callerNumber });
    if (binding?.duplicate) {
      console.info(JSON.stringify({ event: 'cedar_twilio_duplicate', call_sid: callSid }));
    }
    const agentId = env.ELEVENLABS_AGENT_ID || DEFAULT_AGENT_ID;
    const twiml = buildTwiml(agentId, binding.session_id, callSid, callerNumber);
    return { statusCode: 200, headers: TWIML_HEADERS, body: twiml };
  } catch (err) {
    console.error(JSON.stringify({ event: 'cedar_twilio_session_failed', error: err?.message }));
    return { statusCode: 200, headers: TWIML_HEADERS, body: REJECT_TWIML };
  }
};

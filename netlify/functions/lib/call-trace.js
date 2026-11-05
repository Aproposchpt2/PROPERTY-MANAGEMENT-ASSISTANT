'use strict';

// Call Trace Lab: records each tool request the PMA tool function handles
// (ops_call_trace) and applies staged fault drills (ops_fault_drills).
// A drill only fires for the one caller number it was armed for, only on the
// tool it targets, and only until it expires. Every lab step is best effort:
// if the lab tables are missing or slow, the real call carries on untouched.

const { createClient } = require('@supabase/supabase-js');

const LAB_TIMEOUT_MS = 1200;

// The answer key. Shown on the lab page only after a drill is revealed.
const FAULTS = {
  tool_auth: {
    label: 'Tool request rejected (HTTP 401)',
    layer: 'Netlify function',
    symptom: 'Ava says she could not complete the request. The tool result in ElevenLabs is an error with HTTP 401.',
    evidence: 'ElevenLabs tool result: is_error true, 401. Netlify function log: cedar_elevenlabs_auth_failed. Trace row: status 401. Supabase: no new rows.',
    cause: 'The x-pma-tool-key header ElevenLabs sends does not match PMA_ELEVENLABS_TOOL_KEY in Netlify (a rotated key that was changed on one side only).',
    remedy: 'Put the same key on both sides: the tool header in ElevenLabs and the Netlify env var, then redeploy the site.',
  },
  tool_500: {
    label: 'Function crashes (HTTP 500)',
    layer: 'Netlify function',
    symptom: 'Ava apologizes and cannot confirm the request.',
    evidence: 'ElevenLabs tool result: is_error true, HTTP 500. Trace row: status 500 with the error text. Supabase: no new rows.',
    cause: 'An unhandled exception in the function code, usually from a bad deploy.',
    remedy: 'Read the Netlify function log for the stack trace, then roll back to the last good deploy in Netlify and fix the code.',
  },
  function_timeout: {
    label: 'Function times out (15 second limit)',
    layer: 'Netlify function',
    symptom: 'A long silence after "give me a moment", then Ava says something went wrong.',
    evidence: 'Trace row: phase started with no finished row. ElevenLabs tool result: error after about 15 seconds. Netlify log: Task timed out.',
    cause: 'The function waited on something slow and Netlify stopped it at its 15 second timeout (set in netlify.toml).',
    remedy: 'Find the slow dependency (database, SMS, email) from the logs; fix it or add a timeout so the function answers in time.',
  },
  slow_backend: {
    label: 'Slow backend (8 second delay)',
    layer: 'Netlify function',
    symptom: 'The call works, but there is a long dead-air pause after "give me a moment".',
    evidence: 'ElevenLabs tool_latency_secs about 8 for this tool (normal is 1 to 3). Trace row: latency about 8000 ms, success true.',
    cause: 'A slow dependency behind the tool function.',
    remedy: 'Measure each step and fix the slow one; keep tool responses under about 3 seconds.',
  },
  db_unavailable: {
    label: 'Database write fails',
    layer: 'Supabase',
    symptom: 'Ava says she could not confirm the request and gives no case number.',
    evidence: 'Tool result: HTTP 200 but success false, state DATABASE_UNAVAILABLE (ElevenLabs shows is_error false, so it looks fine there). Supabase: no new request row.',
    cause: 'The function could not reach Supabase or the RPC failed (wrong key, wrong URL, a failing database function).',
    remedy: 'Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Netlify, then the Supabase logs for the RPC error.',
  },
  bad_json: {
    label: 'Malformed response (HTML instead of JSON)',
    layer: 'Netlify function',
    symptom: 'Ava behaves oddly or says she could not complete the request.',
    evidence: 'ElevenLabs tool result shows an HTML page instead of JSON. Trace row: status 200 but content type text/html.',
    cause: 'Something in front of the function returned a web page: a wrong URL, a redirect rule, or a proxy error page.',
    remedy: 'Check the tool URL in ElevenLabs and the redirect rules in netlify.toml; the tool must reach the function directly.',
  },
};
const FAULT_KEYS = Object.keys(FAULTS);
const TOOL_SCOPES = ['create_incident', 'record_contact_preference', 'get_case_status', 'close_session', 'any'];

function withTimeout(promise, ms = LAB_TIMEOUT_MS) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('LAB_TIMEOUT')), ms))]);
}

// Reads tool name and call identity from the raw body without trusting it.
function peekIdentity(rawBody) {
  let b = {};
  try { b = JSON.parse(rawBody || '{}') || {}; } catch { /* not JSON */ }
  const dyn = b.dynamic_variables || {};
  const params = b.parameters && typeof b.parameters === 'object' ? b.parameters : b;
  const pick = (...vals) => vals.find((v) => typeof v === 'string' && v) || null;
  const summary = {};
  for (const [k, v] of Object.entries(params)) {
    if (['tool_name', 'call_sid', 'conversation_id', 'caller_id', 'session_id', 'dynamic_variables', 'parameters'].includes(k)) continue;
    summary[k] = k === 'destination' && typeof v === 'string' ? mask(v) : (typeof v === 'string' ? v.slice(0, 300) : v);
  }
  return {
    tool_name: pick(b.tool_name),
    call_sid: pick(b.call_sid, b.system__call_sid, dyn.call_sid),
    conversation_id: pick(b.conversation_id, b.system__conversation_id),
    caller_id: pick(b.caller_id, b.system__caller_id, dyn.caller_id, dyn.caller_number),
    request_summary: summary,
  };
}

function mask(v) {
  if (v.includes('@')) { const [u, d] = v.split('@'); return `${u.slice(0, 2)}***@${d}`; }
  return v.length > 4 ? `***${v.slice(-4)}` : '***';
}

function summarizeResponse(res) {
  const out = { content_type: res.headers?.['content-type'] || null };
  try {
    const parsed = JSON.parse(res.body || '');
    const r = typeof parsed.result === 'string' ? JSON.parse(parsed.result) : parsed;
    out.success = typeof r.success === 'boolean' ? r.success : null;
    out.state = r.state || r.error || null;
    for (const k of ['caseNumber', 'notificationState', 'notificationSent', 'urgentReviewRequired', 'vendorAssigned']) if (k in r) out[k] = r[k];
  } catch {
    out.body_preview = String(res.body || '').slice(0, 160);
  }
  return out;
}

function createLab(env = process.env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  let db;
  const client = () => db || (db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }));

  async function activeDrill({ caller_id, tool_name }) {
    if (!caller_id || !tool_name) return null;
    try {
      const { data, error } = await withTimeout(client().from('ops_fault_drills')
        .select('id,fault_key,tool_scope').eq('caller_number', caller_id).is('disarmed_at', null)
        .gt('expires_at', new Date().toISOString()).order('armed_at', { ascending: false }).limit(5));
      if (error || !data) return null;
      return data.find((d) => d.tool_scope === 'any' || d.tool_scope === tool_name) || null;
    } catch { return null; }
  }

  async function write(row) {
    try {
      await withTimeout(client().from('ops_call_trace').insert(row));
    } catch (err) {
      console.error(JSON.stringify({ event: 'call_trace_write_failed', error: err?.message }));
    }
  }

  async function hit(drillId) {
    try { await withTimeout(client().rpc('ops_fault_drill_hit_v1', { drill_id: drillId })); } catch { /* best effort */ }
  }

  return { activeDrill, write, hit };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'private, no-store' };

// Produces the staged failure. run() is the real handler, used by slow_backend.
async function applyFault(key, run) {
  if (key === 'tool_auth') return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  if (key === 'tool_500') {
    console.error(JSON.stringify({ event: 'cedar_elevenlabs_unhandled', error: "TypeError: Cannot read properties of undefined (reading 'reportedAddress')" }));
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ errorType: 'TypeError', errorMessage: "Cannot read properties of undefined (reading 'reportedAddress')" }) };
  }
  if (key === 'function_timeout') { await sleep(20_000); return { statusCode: 504, headers: JSON_HEADERS, body: '{}' }; }
  if (key === 'slow_backend') { await sleep(8_000); return run(); }
  if (key === 'db_unavailable') {
    console.error(JSON.stringify({ event: 'cedar_elevenlabs_tool_failed', error: 'PMA_DATABASE_UNAVAILABLE' }));
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: false, state: 'DATABASE_UNAVAILABLE', reply: 'The operation was not confirmed. Do not invent success or a number.' }) };
  }
  if (key === 'bad_json') return { statusCode: 200, headers: { 'content-type': 'text/html', 'cache-control': 'private, no-store' }, body: '<html><head><title>502 Bad Gateway</title></head><body><h1>Bad Gateway</h1></body></html>' };
  return run();
}

// Wraps a tool handler: drill check, the call itself, then one trace row.
function traced(handle, opts = {}) {
  let lab = opts.lab;
  return async function tracedHandler(event) {
    if (lab === undefined) lab = createLab(opts.env || process.env);
    if (!lab || event.httpMethod !== 'POST') return handle(event, {});
    const t0 = Date.now();
    const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
    const id = peekIdentity(rawBody);
    const ctx = {};
    const drill = await lab.activeDrill(id);
    const base = { call_sid: id.call_sid, conversation_id: id.conversation_id, caller_id: id.caller_id, tool_name: id.tool_name, request_summary: id.request_summary, fault_id: drill?.id || null, fault_key: drill?.fault_key || null };
    let res;
    if (drill) {
      await lab.hit(drill.id);
      if (drill.fault_key === 'function_timeout') await lab.write({ ...base, phase: 'started' });
      res = await applyFault(drill.fault_key, () => handle(event, ctx));
    } else {
      res = await handle(event, ctx);
    }
    const response_summary = summarizeResponse(res);
    await lab.write({
      ...base,
      phase: 'finished',
      status_code: res.statusCode,
      latency_ms: Date.now() - t0,
      outcome_state: response_summary.state || null,
      success: typeof response_summary.success === 'boolean' ? response_summary.success : res.statusCode < 400,
      error: ctx.error || null,
      response_summary,
    });
    return res;
  };
}

module.exports = { FAULTS, FAULT_KEYS, TOOL_SCOPES, traced, applyFault, peekIdentity, summarizeResponse, createLab };

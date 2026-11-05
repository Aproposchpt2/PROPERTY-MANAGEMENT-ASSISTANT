// Call Trace Lab API (routed at /api/ops/trace/*). Read-only views of one phone
// call across every system it touched, plus staged fault drills for practice.
// Same sign-in as /admin/testing: a Supabase session whose email is in ops_admins.
//
//   GET  /api/ops/trace/status                 which data sources this site can reach
//   GET  /api/ops/trace/calls?cursor=          recent calls on the PMA line (ElevenLabs)
//   GET  /api/ops/trace/calls/:conversation_id  one call: Twilio, menu, ElevenLabs, function trace, Supabase, text messages
//   GET  /api/ops/trace/drills                 fault catalog, active and recent drills
//   POST /api/ops/trace/drills                 arm {fault_key|'mystery', tool_scope, caller_number, minutes, blind}
//   POST /api/ops/trace/drills/:id/reveal      show the answer for a drill
//   POST /api/ops/trace/drills/:id/disarm      stop a drill now

import { db } from './lib/ops-core.mjs';
import trace from './lib/call-trace.js';

const { FAULTS, FAULT_KEYS, TOOL_SCOPES } = trace;
const AGENTS = { agent_4901m5gzk15hfajrapnvb520f9jt: 'Ava, PMA line (725) 201-0584' };
const EL = 'https://api.elevenlabs.io/v1/convai';
const HEADERS = { 'content-type': 'application/json', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' };
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });
const E164 = /^\+[1-9][0-9]{7,14}$/;
const CONV = /^conv_[a-z0-9]{10,60}$/i;
const UUID = /^[0-9a-f-]{36}$/i;

let _admins = { at: 0, set: new Set() };
async function authenticate(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || '';
  if (!auth.startsWith('Bearer ')) return { status: 401, error: 'Sign in required' };
  const { data, error } = await db().auth.getUser(auth.slice(7));
  const email = data?.user?.email?.toLowerCase();
  if (error || !email) return { status: 401, error: 'Session expired. Sign in again.' };
  if (Date.now() - _admins.at > 60_000) {
    const r = await db().from('ops_admins').select('email');
    if (r.error) throw new Error(`ops_admins: ${r.error.message}`);
    _admins = { at: Date.now(), set: new Set((r.data || []).map((x) => String(x.email || '').trim().toLowerCase())) };
  }
  if (!_admins.set.has(email)) return { status: 403, error: 'This account is not on the testing admin list.' };
  return { email };
}

async function getJson(url, headers, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { headers, signal: ctl.signal });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
    if (!res.ok) return { error: `HTTP ${res.status}`, detail: body?.detail?.message || body?.message || body?.detail || null };
    return { data: body };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'Timed out' : e.message };
  } finally { clearTimeout(t); }
}

const elHeaders = () => ({ 'xi-api-key': process.env.ELEVENLABS_API_KEY || '' });
const twilioAuth = () => {
  const sid = process.env.TWILIO_ACCOUNT_SID; const tok = process.env.TWILIO_AUTH_TOKEN;
  return sid && tok ? { sid, header: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64') } } : null;
};

async function listCalls(cursor) {
  const out = [];
  let next = null;
  for (const agentId of Object.keys(AGENTS)) {
    const q = new URLSearchParams({ agent_id: agentId, page_size: '30' });
    if (cursor) q.set('cursor', cursor);
    const r = await getJson(`${EL}/conversations?${q}`, elHeaders());
    if (r.error) return { error: `ElevenLabs: ${r.error}${r.detail ? ` (${r.detail})` : ''}` };
    next = r.data.next_cursor || null;
    for (const c of r.data.conversations || []) {
      out.push({
        conversation_id: c.conversation_id, agent: AGENTS[agentId], started_at: c.start_time_unix_secs,
        duration_secs: c.call_duration_secs, status: c.status, termination_reason: c.termination_reason,
        call_successful: c.call_successful, title: c.call_summary_title || null, language: c.main_language,
        tools: c.tool_names || [], messages: c.message_count,
      });
    }
  }
  return { calls: out, next_cursor: next };
}

// Removes anything secret before the conversation leaves the server.
function cleanConversation(c) {
  const turns = (c.transcript || []).map((t) => ({
    role: t.role, at: t.time_in_call_secs, message: t.message, interrupted: !!t.interrupted,
    metrics: Object.fromEntries(Object.entries(t.conversation_turn_metrics?.metrics || {}).map(([k, v]) => [k, v?.elapsed_time ?? null])),
    tool_calls: (t.tool_calls || []).map((x) => ({
      request_id: x.request_id, tool_name: x.tool_name, type: x.type, params: x.params_as_json,
      url: x.tool_details?.url || null, method: x.tool_details?.method || null, body: x.tool_details?.body || null,
    })),
    tool_results: (t.tool_results || []).map((x) => ({
      request_id: x.request_id, tool_name: x.tool_name, latency_secs: x.tool_latency_secs, is_error: x.is_error,
      error_type: x.error_type || null, raw_error_message: x.raw_error_message || null, result: x.result_value,
    })),
  }));
  const m = c.metadata || {};
  return {
    conversation_id: c.conversation_id, agent_id: c.agent_id, agent: AGENTS[c.agent_id] || c.agent_name, status: c.status, version_id: c.version_id,
    started_at: m.start_time_unix_secs, accepted_at: m.accepted_time_unix_secs, duration_secs: m.call_duration_secs,
    termination_reason: m.termination_reason, error: m.error || null, warnings: m.warnings || [], language: m.main_language,
    phone_call: m.phone_call ? { ...m.phone_call } : null, cost_credits: m.cost, cost_usd: m.cost_fiat ?? null,
    llm: Object.keys(m.charging?.llm_usage?.initiated_generation?.model_usage || {})[0] || null,
    analysis: { call_successful: c.analysis?.call_successful, summary: c.analysis?.transcript_summary, title: c.analysis?.call_summary_title },
    dynamic_variables: Object.fromEntries(Object.entries(c.conversation_initiation_client_data?.dynamic_variables || {}).filter(([k]) => !k.startsWith('system__') || ['system__caller_id', 'system__called_number', 'system__call_sid'].includes(k))),
    turns,
  };
}

async function twilioFor(callSid) {
  const auth = twilioAuth();
  if (!auth) return { error: 'Twilio credentials are not set on this site' };
  if (!/^CA[0-9a-f]{32}$/i.test(callSid || '')) return { error: 'No Twilio CallSid on this conversation' };
  const base = `https://api.twilio.com/2010-04-01/Accounts/${auth.sid}/Calls/${callSid}`;
  const [call, events, notes] = await Promise.all([
    getJson(`${base}.json`, auth.header), getJson(`${base}/Events.json?PageSize=50`, auth.header), getJson(`${base}/Notifications.json?PageSize=50`, auth.header),
  ]);
  if (call.error) return { error: `Twilio call lookup: ${call.error}${call.detail ? ` (${call.detail})` : ''}` };
  const c = call.data;
  return {
    call: { sid: c.sid, from: c.from, to: c.to, status: c.status, direction: c.direction, start_time: c.start_time, end_time: c.end_time, duration: c.duration, price: c.price, answered_by: c.answered_by, parent_call_sid: c.parent_call_sid },
    events: events.error ? { error: events.error } : (events.data.events || []).map((e) => ({
      method: e.request?.method, url: e.request?.url, params: e.request?.parameters || {},
      response_code: e.response?.response_code, ms: e.response?.request_duration, content_type: e.response?.content_type,
      body: String(e.response?.response_body || '').slice(0, 1500), at: e.response?.date_created || e.request?.parameters?.timestamp || null,
    })),
    notifications: notes.error ? { error: notes.error } : (notes.data.notifications || []).map((n) => ({ code: n.error_code, level: n.log === '0' ? 'error' : 'warning', at: n.message_date, text: n.message_text, more_info: n.more_info, url: n.request_url })),
  };
}

// Text messages for a call: SIDs saved on the request rows, plus anything the
// account sent from the call's start until 15 minutes after it ended.
const SM_RE = /\b(SM|MM)[0-9a-f]{32}\b/gi;
async function messagesFor({ requestRows, startUnix, endUnix, caller }) {
  const auth = twilioAuth();
  if (!auth) return { error: 'Twilio credentials are not set on this site' };
  const saved = [...new Set((JSON.stringify(requestRows || []).match(SM_RE) || []))];
  const base = `https://api.twilio.com/2010-04-01/Accounts/${auth.sid}/Messages`;
  const day = new Date(startUnix * 1000).toISOString().slice(0, 10);
  const [list, ...direct] = await Promise.all([
    getJson(`${base}.json?DateSent=${day}&PageSize=100`, auth.header),
    ...saved.map((sid) => getJson(`${base}/${sid}.json`, auth.header)),
  ]);
  const from = startUnix * 1000; const to = (endUnix + 15 * 60) * 1000;
  const byId = new Map();
  for (const r of direct) if (r.data?.sid) byId.set(r.data.sid, r.data);
  for (const m of list.data?.messages || []) {
    const t = Date.parse(m.date_created);
    if (m.direction !== 'inbound' && t >= from && t <= to && !byId.has(m.sid)) byId.set(m.sid, m);
  }
  const out = [...byId.values()].map((m) => ({
    sid: m.sid, to: m.to, from: m.from, status: m.status, error_code: m.error_code, error_message: m.error_message,
    direction: m.direction, num_segments: m.num_segments, price: m.price, date_created: m.date_created, date_sent: m.date_sent, date_updated: m.date_updated,
    saved_on_case: saved.includes(m.sid), to_caller: Boolean(caller) && m.to === caller,
  })).sort((a, b) => Date.parse(a.date_created) - Date.parse(b.date_created));
  return { data: out, list_error: list.error || null };
}

async function rows(table, filter, { order = 'created_at', select = '*', limit = 50 } = {}) {
  try {
    let q = db().from(table).select(select);
    for (const [k, v] of Object.entries(filter)) q = Array.isArray(v) ? q.in(k, v) : q.eq(k, v);
    const { data, error } = await q.order(order, { ascending: true }).limit(limit);
    return error ? { error: error.message } : { data };
  } catch (e) { return { error: e.message }; }
}

async function traceCall(convId) {
  const r = await getJson(`${EL}/conversations/${convId}`, elHeaders(), 12000);
  if (r.error) return { status: 502, error: `ElevenLabs: ${r.error}` };
  const el = cleanConversation(r.data);
  const callSid = el.phone_call?.call_sid || null;
  const ids = [callSid, convId].filter(Boolean);
  const [twilio, menu, fnTrace, sessions, callLog] = await Promise.all([
    twilioFor(callSid),
    callSid ? rows('voice_language_choices', { call_sid: callSid }) : { data: [] },
    rows('ops_call_trace', { call_sid: ids }),
    rows('pma_voice_sessions', { call_sid: ids }, { order: 'started_at' }),
    rows('pma_call_log', { conversation_id: convId }),
  ]);
  const fnByConv = await rows('ops_call_trace', { conversation_id: convId });
  const traceRows = [...(fnTrace.data || []), ...(fnByConv.data || [])].filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const reqIds = (sessions.data || []).map((s) => s.request_id).filter(Boolean);
  const requests = reqIds.length ? await rows('pma_maintenance_requests', { id: reqIds }) : { data: [] };
  const sms = el.started_at ? await messagesFor({
    requestRows: requests.data, startUnix: el.started_at, endUnix: el.started_at + (el.duration_secs || 0), caller: el.phone_call?.external_number,
  }) : { data: [] };
  return {
    elevenlabs: el,
    twilio,
    sms,
    language_menu: menu,
    function_trace: fnTrace.error && fnByConv.error ? { error: fnTrace.error } : { data: traceRows },
    supabase: { pma_voice_sessions: sessions, pma_maintenance_requests: requests, pma_call_log: callLog },
  };
}

function drillView(d, catalog = true) {
  const hidden = d.blind && !d.revealed_at;
  const now = Date.now();
  const state = d.disarmed_at ? 'disarmed' : new Date(d.expires_at).getTime() <= now ? 'expired' : 'armed';
  return {
    id: d.id, tool_scope: d.tool_scope, caller_number: d.caller_number, armed_by: d.armed_by, armed_at: d.armed_at,
    expires_at: d.expires_at, disarmed_at: d.disarmed_at, revealed_at: d.revealed_at, hits: d.hits, last_hit_at: d.last_hit_at, state,
    blind: d.blind, fault_key: hidden ? null : d.fault_key, answer: hidden || !catalog ? null : FAULTS[d.fault_key],
  };
}

export const handler = async (event) => {
  if (!['GET', 'POST'].includes(event.httpMethod)) return json(405, { error: 'Method not allowed' });
  try {
    const who = await authenticate(event);
    if (who.error) return json(who.status, { error: who.error });
    const seg = String(event.path || '').replace(/^.*?\/api\/ops\/trace\/?/, '').replace(/^.*?\/ops-trace-api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    let body = {};
    if (event.body) { try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body); } catch { return json(400, { error: 'Invalid JSON' }); } }
    const GET = event.httpMethod === 'GET';

    if (GET && seg[0] === 'status') {
      const lab = await rows('ops_fault_drills', {}, { order: 'armed_at', limit: 1 });
      return json(200, {
        elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY), twilio: Boolean(twilioAuth()), supabase: true,
        lab_tables: !lab.error, lab_error: lab.error || null, email: who.email,
      });
    }

    if (GET && seg[0] === 'calls' && seg.length === 1) {
      const r = await listCalls(String(event.queryStringParameters?.cursor || '').slice(0, 500));
      return r.error ? json(502, r) : json(200, r);
    }

    if (GET && seg[0] === 'calls' && seg[1]) {
      if (!CONV.test(seg[1])) return json(400, { error: 'Bad conversation id' });
      const r = await traceCall(seg[1]);
      if (r.error) return json(r.status || 502, { error: r.error });
      if (!AGENTS[r.elevenlabs.agent_id]) return json(403, { error: 'That conversation is not on this site\'s agent.' });
      return json(200, r);
    }

    if (seg[0] === 'drills') {
      if (GET && seg.length === 1) {
        const r = await db().from('ops_fault_drills').select('*').order('armed_at', { ascending: false }).limit(30);
        if (r.error) return json(503, { error: `Drill table not ready: ${r.error.message}` });
        return json(200, {
          catalog: FAULT_KEYS.map((k) => ({ key: k, label: FAULTS[k].label, layer: FAULTS[k].layer })),
          tool_scopes: TOOL_SCOPES, drills: (r.data || []).map((d) => drillView(d)),
        });
      }
      if (!GET && seg.length === 1) {
        const scope = TOOL_SCOPES.includes(body.tool_scope) ? body.tool_scope : 'create_incident';
        const caller = String(body.caller_number || '').replace(/[^\d+]/g, '');
        const number = /^\d{10}$/.test(caller) ? `+1${caller}` : /^1\d{10}$/.test(caller) ? `+${caller}` : caller;
        if (!E164.test(number)) return json(400, { error: 'Enter the phone number you will call from, like 702 555 0100.' });
        const mystery = body.fault_key === 'mystery';
        const key = mystery ? FAULT_KEYS[Math.floor(Math.random() * FAULT_KEYS.length)] : body.fault_key;
        if (!FAULT_KEYS.includes(key)) return json(400, { error: 'Pick a fault.' });
        const minutes = Math.min(Math.max(parseInt(body.minutes, 10) || 30, 5), 120);
        const r = await db().from('ops_fault_drills').insert({
          fault_key: key, tool_scope: scope, caller_number: number, blind: mystery || body.blind === true,
          armed_by: who.email, expires_at: new Date(Date.now() + minutes * 60_000).toISOString(),
        }).select('*').single();
        if (r.error) return json(503, { error: `Could not arm the drill: ${r.error.message}` });
        return json(200, { drill: drillView(r.data) });
      }
      if (!GET && seg.length === 3 && UUID.test(seg[1]) && ['reveal', 'disarm'].includes(seg[2])) {
        const patch = seg[2] === 'reveal' ? { revealed_at: new Date().toISOString() } : { disarmed_at: new Date().toISOString() };
        const r = await db().from('ops_fault_drills').update(patch).eq('id', seg[1]).select('*').single();
        if (r.error) return json(404, { error: 'Drill not found' });
        return json(200, { drill: drillView(r.data) });
      }
    }
    return json(404, { error: 'Not found' });
  } catch (err) {
    console.error(JSON.stringify({ event: 'ops_trace_api_error', path: event.path, error: err?.message }));
    return json(500, { error: 'Server error. Try again.' });
  }
};

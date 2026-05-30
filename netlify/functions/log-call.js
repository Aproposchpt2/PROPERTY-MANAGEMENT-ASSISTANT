'use strict';

// POST /.netlify/functions/log-call
// Called by ElevenLabs Alex agent at end of every conversation.
// Writes to BOTH call_logs AND lead_manager_records.
//
// caller_phone is OPTIONAL — defaults to "Unknown".
// The dual-write must complete regardless of what Alex captured.
// Only auto-generated fields (timestamps, agent name) are guaranteed.

const { buildCorsHeaders, handleOptions } = require('./lib/flowdesk-cors');
const { getSupabaseAdmin } = require('./lib/flowdesk-supabase-admin');
const { json, error, parseJsonBody } = require('./lib/flowdesk-response-utils');

const TENANT_ID  = process.env.CLIENT_TENANT_ID || 'apropos-ai4-businesses';
const AGENT_NAME = 'Alex';

function clean(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : null;
}

exports.handler = async (event) => {
  const origin = event.headers && event.headers.origin;
  const corsHeaders = buildCorsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') return handleOptions(origin);
  if (event.httpMethod !== 'POST') {
    return error(405, 'METHOD_NOT_ALLOWED', 'Only POST is supported', corsHeaders);
  }

  const body = parseJsonBody(event);
  if (!body) {
    return error(400, 'INVALID_BODY', 'Request body must be valid JSON', corsHeaders);
  }

  // caller_phone is optional — never block on it
  const callerPhone        = clean(body.caller_phone, 30) || 'Unknown';
  const conversationId     = clean(body.conversation_id, 64)       || null;
  const callerName         = clean(body.caller_name, 120)           || null;
  const conversationSummary = clean(body.conversation_summary, 2000) || clean(body.summary, 2000) || null;
  const durationRaw        = body.duration || body.duration_seconds;
  const durationSecs       = Number.isFinite(Number(durationRaw)) ? Math.round(Number(durationRaw)) : null;
  const outcome            = clean(body.outcome, 80) || null;
  const callTimestamp      = new Date().toISOString();

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    return error(500, 'CONFIG_ERROR', 'Service configuration error', corsHeaders);
  }

  // Write to both tables in parallel — non-fatal if one fails
  const [callLogResult, leadResult] = await Promise.allSettled([

    // 1. call_logs
    supabase.from('call_logs').insert({
      caller_phone:     callerPhone,
      call_sid:         conversationId,
      call_status:      'completed',
      duration_seconds: durationSecs,
      outcome:          outcome,
      lead_created:     true,
      is_demo:          false,
      created_at:       callTimestamp,
    }).select('id, caller_phone, call_status, created_at').single(),

    // 2. lead_manager_records
    supabase.from('lead_manager_records').insert({
      tenant_id:             TENANT_ID,
      phone:                 callerPhone,
      contact_name:          callerName,
      call_sid:              conversationId,
      source:                'voice_agent',
      source_page:           'ElevenLabs Alex Voice Agent',
      channel:               'phone',
      lead_status:           'New / Needs Review',
      call_status:           'completed',
      call_duration_seconds: durationSecs,
      missed_call:           false,
      follow_up_needed:      true,
      callback_needed:       false,
      ai_processed:          false,
      ai_call_summary:       conversationSummary,
      campaign_source:       'voice_agent',
      campaign_medium:       'phone',
      campaign_name:         'FlowDesk Pro Contact Center',
      details:               conversationSummary || `Inbound call handled by ${AGENT_NAME}. Phone: ${callerPhone}.`,
      next_action:           'Review call record and follow up with caller.',
      created_at:            callTimestamp,
      updated_at:            callTimestamp,
      metadata: {
        conversation_id: conversationId,
        agent:           AGENT_NAME,
        platform:        'ElevenLabs',
        caller_phone_captured: callerPhone !== 'Unknown',
      },
    }).select('id, phone, lead_status, created_at').single(),

  ]);

  const callLog = callLogResult.status === 'fulfilled' ? callLogResult.value.data  : null;
  const leadRec = leadResult.status    === 'fulfilled' ? leadResult.value.data     : null;

  if (callLogResult.status === 'rejected') {
    console.error('LOG-CALL call_logs error:', callLogResult.reason?.message);
  }
  if (leadResult.status === 'rejected') {
    console.error('LOG-CALL lead_manager_records error:', leadResult.reason?.message);
  }

  const phoneCaptured = callerPhone !== 'Unknown';
  console.log(`LOG-CALL: phone=${phoneCaptured ? `***${callerPhone.slice(-4)}` : 'Unknown'} call_log_id=${callLog?.id} lead_id=${leadRec?.id}`);

  return json(200, {
    success:      true,
    call_log:     callLog,
    lead_record:  leadRec,
    phone_captured: phoneCaptured,
  }, corsHeaders);
};

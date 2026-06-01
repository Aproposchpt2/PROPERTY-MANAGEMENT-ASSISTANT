'use strict';

// POST /.netlify/functions/log-call
// Handles BOTH:
//   A) ElevenLabs native post-call webhook (fires automatically after every call)
//   B) Legacy in-conversation tool call from Alex (fallback)
//
// ElevenLabs post-call webhook payload:
// { type: "post_call_transcription", data: { conversation_id, agent_id, status,
//   transcript: [...], metadata: { call_duration_secs, phone_call: { caller_id } } } }

const crypto = require('crypto');
const { buildCorsHeaders, handleOptions } = require('./lib/flowdesk-cors');
const { getSupabaseAdmin } = require('./lib/flowdesk-supabase-admin');
const { json, error, parseJsonBody } = require('./lib/flowdesk-response-utils');

const TENANT_ID  = process.env.CLIENT_TENANT_ID || 'apropos-ai4-businesses';
const AGENT_NAME = 'Alex';

function verifyElevenLabsSignature(event) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) return true; // skip verification if secret not configured

  // ElevenLabs uses Standard Webhooks: webhook-id, webhook-timestamp, webhook-signature
  const msgId        = event.headers['webhook-id']        || event.headers['svix-id']        || '';
  const msgTimestamp = event.headers['webhook-timestamp'] || event.headers['svix-timestamp'] || '';
  const msgSignature = event.headers['webhook-signature'] || event.headers['svix-signature'] || '';

  if (!msgId || !msgTimestamp || !msgSignature) return false;

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  const signedContent = `${msgId}.${msgTimestamp}.${rawBody}`;
  const secretBytes  = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const computed     = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  const expected     = `v1,${computed}`;

  return msgSignature.split(' ').some(sig => sig === expected);
}

function clean(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : null;
}

function buildTranscriptSummary(transcript) {
  if (!Array.isArray(transcript) || transcript.length === 0) return null;
  return transcript
    .map(t => `${t.role === 'agent' ? 'Alex' : 'Caller'}: ${t.message}`)
    .join('\n')
    .slice(0, 2000);
}

exports.handler = async (event) => {
  const origin = event.headers && event.headers.origin;
  const corsHeaders = buildCorsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') return handleOptions(origin);
  if (event.httpMethod !== 'POST') {
    return error(405, 'METHOD_NOT_ALLOWED', 'Only POST is supported', corsHeaders);
  }

  // Verify ElevenLabs webhook signature if secret is configured
  if (!verifyElevenLabsSignature(event)) {
    console.error('LOG-CALL: invalid webhook signature');
    return error(401, 'UNAUTHORIZED', 'Invalid webhook signature', corsHeaders);
  }

  const body = parseJsonBody(event);
  if (!body) {
    return error(400, 'INVALID_BODY', 'Request body must be valid JSON', corsHeaders);
  }

  let callerPhone, conversationId, durationSecs, outcome, conversationSummary;

  // ── Detect payload type ───────────────────────────────────────
  if (body.type === 'post_call_transcription' && body.data) {
    // A) ElevenLabs native post-call webhook
    const d = body.data;
    conversationId     = clean(d.conversation_id, 64) || null;
    durationSecs       = d.metadata?.call_duration_secs ? Math.round(Number(d.metadata.call_duration_secs)) : null;
    callerPhone        = clean(d.metadata?.phone_call?.caller_id, 30) || 'Unknown';
    outcome            = clean(d.status, 80) || 'completed';
    conversationSummary = buildTranscriptSummary(d.transcript);

    console.log(`LOG-CALL [post_call_webhook]: phone=***${callerPhone.slice(-4)} conv=${conversationId} dur=${durationSecs}s`);
  } else {
    // B) Legacy in-conversation tool call
    callerPhone        = clean(body.caller_phone, 30) || 'Unknown';
    conversationId     = clean(body.conversation_id, 64) || null;
    const durationRaw  = body.duration || body.duration_seconds;
    durationSecs       = Number.isFinite(Number(durationRaw)) ? Math.round(Number(durationRaw)) : null;
    outcome            = clean(body.outcome, 80) || null;
    conversationSummary = clean(body.conversation_summary, 2000) || clean(body.summary, 2000) || null;

    console.log(`LOG-CALL [tool_call]: phone=***${callerPhone.slice(-4)} conv=${conversationId}`);
  }

  const callTimestamp = new Date().toISOString();

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    return error(500, 'CONFIG_ERROR', 'Service configuration error', corsHeaders);
  }

  // ── Write to both tables in parallel ─────────────────────────
  const [callLogResult, leadResult] = await Promise.allSettled([

    // 1. call_logs
    supabase.from('call_logs').insert({
      caller_phone:     callerPhone,
      call_sid:         conversationId,
      call_status:      'completed',
      duration_seconds: durationSecs,
      outcome:          outcome || 'completed',
      lead_created:     true,
      is_demo:          false,
      created_at:       callTimestamp,
    }).select('id, caller_phone, call_status, created_at').single(),

    // 2. lead_manager_records
    supabase.from('lead_manager_records').insert({
      tenant_id:             TENANT_ID,
      phone:                 callerPhone,
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
      transcript:            conversationSummary,
      campaign_source:       'voice_agent',
      campaign_medium:       'phone',
      campaign_name:         'FlowDesk Pro Contact Center',
      details:               conversationSummary || `Inbound call handled by ${AGENT_NAME}. Phone: ${callerPhone}.`,
      next_action:           'Review call record and follow up with caller.',
      created_at:            callTimestamp,
      updated_at:            callTimestamp,
      metadata: {
        conversation_id:       conversationId,
        agent:                 AGENT_NAME,
        platform:              'ElevenLabs',
        caller_phone_captured: callerPhone !== 'Unknown',
        webhook_type:          body.type === 'post_call_transcription' ? 'post_call' : 'tool_call',
      },
    }).select('id, phone, lead_status, created_at').single(),

  ]);

  const callLog = callLogResult.status === 'fulfilled' ? callLogResult.value.data : null;
  const leadRec = leadResult.status    === 'fulfilled' ? leadResult.value.data    : null;

  if (callLogResult.status === 'rejected') console.error('LOG-CALL call_logs error:', callLogResult.reason?.message);
  if (leadResult.status    === 'rejected') console.error('LOG-CALL lead_manager_records error:', leadResult.reason?.message);

  console.log(`LOG-CALL: call_log_id=${callLog?.id} lead_id=${leadRec?.id}`);

  return json(200, {
    success:     true,
    call_log:    callLog,
    lead_record: leadRec,
  }, corsHeaders);
};

'use strict';

// ElevenLabs-path counterpart to pma-sip-store.js.
//
// SECURITY NOTE — verbatim guard removed:
// pma-sip-store.js has a VERBATIM_DESCRIPTION_NOT_OBSERVED check that verifies
// the description string literally appeared in a captured caller transcript.
// ElevenLabs owns the conversation loop; no server-side transcript exists before
// the tool webhook fires. The DB RPC still validates description length (3–4000
// chars) and all four required fields. The verbatim-match layer is absent here.
// Do not re-introduce it without a mechanism to capture ElevenLabs transcripts
// before the create_incident webhook fires.
//
// SIP CALL ID: there is no SIP call ID on the ElevenLabs/Twilio path.
// The Twilio CallSid is passed as both call_sid and sip_call_id to satisfy
// the DB schema. Both unique constraints (tenant_id, call_sid) and
// (tenant_id, sip_call_id) are satisfied because the single CallSid value
// is unique per call.

const { createClient } = require('@supabase/supabase-js');

function createStore(env = process.env) {
  if (env.SUPABASE_URL !== 'https://vqrqyanqsiqzsmlhytaz.supabase.co' || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('PMA_DATABASE_UNAVAILABLE');
  }
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const scoped = { t: env.PMA_TENANT_ID, p: env.PMA_PROPERTY_ID };
  async function rpc(name, args) {
    const { data, error } = await db.rpc(name, { ...scoped, ...args });
    if (error) throw new Error(`PMA_RPC_${error.code || 'FAILED'}`);
    return data;
  }
  return {
    start: ({ call_sid, caller_number }) =>
      rpc('pma_voice_session_start_v1', { call_sid, sip_call_id: call_sid, caller_number }),
    createIncident: ({ session_id, call_sid, args }) =>
      rpc('pma_voice_incident_create_v1', { session_id, call_sid, sip_call_id: call_sid, incident: args }),
    recordPreference: ({ session_id, call_sid, args }) =>
      rpc('pma_voice_incident_preference_v1', {
        session_id,
        call_sid,
        sip_call_id: call_sid,
        method: args.method,
        destination: args.destination,
        consent: args.consent,
      }),
    close: ({ session_id, call_sid }) =>
      rpc('pma_voice_session_close_v1', { session_id, call_sid, sip_call_id: call_sid }),
    claimSms: ({ session_id, call_sid }) =>
      rpc('pma_voice_incident_sms_claim_v1', { session_id, call_sid, sip_call_id: call_sid }),
    recordSms: ({ session_id, call_sid, message_sid, outcome, error_code }) =>
      rpc('pma_voice_incident_sms_result_v1', { session_id, call_sid, sip_call_id: call_sid, message_sid, outcome, error_code }),
    claimEmail: ({ session_id, call_sid }) =>
      rpc('pma_voice_incident_email_claim_v1', { session_id, call_sid, sip_call_id: call_sid }),
    recordEmail: ({ session_id, call_sid, message_id, outcome, error_code }) =>
      rpc('pma_voice_incident_email_result_v1', { session_id, call_sid, sip_call_id: call_sid, message_id, outcome, error_code }),
    lookupCase: ({ caller_number, case_number }) =>
      rpc('pma_voice_case_lookup_v1', { caller_number: caller_number || null, case_number: case_number || null }),
  };
}

module.exports = { createStore };

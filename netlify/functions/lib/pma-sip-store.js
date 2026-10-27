'use strict';

const { createClient } = require('@supabase/supabase-js');

function createStore(env = process.env) {
  if (env.SUPABASE_URL !== 'https://vqrqyanqsiqzsmlhytaz.supabase.co' || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('PMA_DATABASE_UNAVAILABLE');
  }
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const scoped = {
    t: env.PMA_TENANT_ID,
    p: env.PMA_PROPERTY_ID,
  };
  async function rpc(name, args) {
    const { data, error } = await db.rpc(name, { ...scoped, ...args });
    if (error) throw new Error(`PMA_RPC_${error.code || 'FAILED'}`);
    return data;
  }
  return {
    start: ({ call_sid, sip_call_id, caller_number }) => rpc('pma_voice_session_start_v1', { call_sid, sip_call_id, caller_number }),
    createIncident: ({ session_id, call_sid, sip_call_id, args, observedCallerTurns }) => {
      if (!Array.isArray(observedCallerTurns) || !observedCallerTurns.some((turn) => typeof turn === 'string' && turn.trim() === args.description)) {
        throw new Error('VERBATIM_DESCRIPTION_NOT_OBSERVED');
      }
      return rpc('pma_voice_incident_create_v1', { session_id, call_sid, sip_call_id, incident: args });
    },
    recordPreference: ({ session_id, call_sid, sip_call_id, args }) => rpc('pma_voice_incident_preference_v1', {
      session_id,
      call_sid,
      sip_call_id,
      method: args.method,
      destination: args.destination,
      consent: args.consent,
    }),
    close: ({ session_id, call_sid, sip_call_id }, transcript) => rpc('pma_voice_session_close_v1', { session_id, call_sid, sip_call_id, transcript: transcript || [] }),
  };
}

module.exports = { createStore };

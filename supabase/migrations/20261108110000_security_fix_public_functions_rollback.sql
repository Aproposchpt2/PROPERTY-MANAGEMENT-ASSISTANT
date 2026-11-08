begin;

-- Restores both functions exactly as they were before 20261108110000 (as captured from the live
-- database on 2026-11-08). Note: restoring (1) brings back the close_session failure.

CREATE OR REPLACE FUNCTION public.pma_voice_session_close_v1(t uuid, p uuid, session_id uuid, call_sid text, sip_call_id text, transcript jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE pma_voice_sessions
  SET status = 'closed',
      ended_at = now(),
      updated_at = now(),
      incident_facts = CASE
        WHEN transcript IS NOT NULL AND jsonb_array_length(transcript) > 0
        THEN jsonb_build_object('transcript', transcript)
        ELSE incident_facts
      END
  WHERE pma_voice_sessions.session_id = close_v1.session_id
    AND pma_voice_sessions.call_sid   = close_v1.call_sid
    AND pma_voice_sessions.tenant_id  = t
    AND pma_voice_sessions.property_id = p;
  RETURN jsonb_build_object('closed', true);
END;
$function$;

grant execute on function public.stellar_create_support_intake(uuid, text, text, text, text, text, text, text, text, text, text) to public;

commit;

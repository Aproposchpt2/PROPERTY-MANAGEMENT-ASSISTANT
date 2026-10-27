begin;

create or replace function public.pma_voice_incident_sms_claim_v1(
  t uuid, p uuid, session_id uuid, call_sid text, sip_call_id text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.pma_voice_sessions;
  req public.pma_maintenance_requests;
  pref jsonb;
  ns text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  select * into s from public.pma_voice_sessions x
    where x.id=session_id and x.tenant_id=t and x.property_id=p for update;
  if not found or s.call_sid<>$4 or s.sip_call_id<>$5 or s.status<>'active' or s.request_id is null then
    raise exception 'Incident required' using errcode='42501';
  end if;
  select * into req from public.pma_maintenance_requests x
    where x.id=s.request_id and x.tenant_id=t and x.property_id=p for update;
  pref := req.intake_details->'contactPreference';
  if pref->>'method' <> 'sms' or coalesce((pref->'consent')::boolean, false) is distinct from true then
    return jsonb_build_object('success', false, 'state', 'NOT_ELIGIBLE');
  end if;
  ns := pref->>'notificationState';
  if ns = 'SENDING' then
    return jsonb_build_object('success', false, 'state', 'IN_PROGRESS');
  end if;
  if ns in ('SENT', 'OPTED_OUT') then
    return jsonb_build_object('success', false, 'state', 'ALREADY_SENT');
  end if;
  if ns is not null and ns <> 'NOT_SENT' then
    return jsonb_build_object('success', false, 'state', 'NOT_ELIGIBLE');
  end if;
  update public.pma_maintenance_requests set
    intake_details = intake_details || jsonb_build_object(
      'contactPreference', pref || jsonb_build_object(
        'notificationState', 'SENDING',
        'notificationClaimedAt', now()
      )
    )
  where id = req.id;
  return jsonb_build_object(
    'success', true,
    'destination', pref->>'destination',
    'caseNumber', req.case_number,
    'requestId', req.id
  );
end $$;
revoke all on function public.pma_voice_incident_sms_claim_v1(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.pma_voice_incident_sms_claim_v1(uuid,uuid,uuid,text,text) to service_role;

create or replace function public.pma_voice_incident_sms_result_v1(
  t uuid, p uuid, session_id uuid, call_sid text, sip_call_id text,
  message_sid text, outcome text, error_code text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.pma_voice_sessions;
  req public.pma_maintenance_requests;
  pref jsonb;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  if outcome not in ('SENT', 'FAILED', 'OPTED_OUT') then
    raise exception 'Invalid outcome' using errcode='22023';
  end if;
  select * into s from public.pma_voice_sessions x
    where x.id=session_id and x.tenant_id=t and x.property_id=p for update;
  if not found or s.call_sid<>$4 or s.sip_call_id<>$5 or s.status<>'active' or s.request_id is null then
    raise exception 'Incident required' using errcode='42501';
  end if;
  select * into req from public.pma_maintenance_requests x
    where x.id=s.request_id and x.tenant_id=t and x.property_id=p for update;
  pref := req.intake_details->'contactPreference';
  if pref->>'notificationState' <> 'SENDING' then
    raise exception 'Not in SENDING state' using errcode='42501';
  end if;
  update public.pma_maintenance_requests set
    intake_details = intake_details || jsonb_build_object(
      'contactPreference', pref || jsonb_build_object(
        'notificationState', outcome,
        'notificationSent', outcome = 'SENT',
        'messageSid', message_sid,
        'errorCode', error_code,
        'notificationAt', now()
      )
    )
  where id = req.id;
  return jsonb_build_object('success', true, 'state', outcome);
end $$;
revoke all on function public.pma_voice_incident_sms_result_v1(uuid,uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.pma_voice_incident_sms_result_v1(uuid,uuid,uuid,text,text,text,text,text) to service_role;

commit;

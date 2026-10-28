-- ROLLBACK: restore the three RPCs to their pre-20261028100000 state.
-- Run this inside a transaction; verify with a live-function regex test
-- before committing.

begin;

create or replace function public.pma_voice_incident_create_v1(t uuid, p uuid, session_id uuid, call_sid text, sip_call_id text, incident jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.pma_voice_sessions; req public.pma_maintenance_requests; contact uuid; facts jsonb; opid text;
name text; address text; unit_label text; description text; urgent boolean;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  select * into s from public.pma_voice_sessions x where x.id=session_id and x.tenant_id=t and x.property_id=p for update;
  if not found or s.call_sid<>call_sid or s.sip_call_id<>sip_call_id or s.status<>'active' or s.started_at<now()-interval '2 hours' then raise exception 'Active PMA call required' using errcode='42501'; end if;
  if jsonb_typeof(incident) is distinct from 'object' or exists(select 1 from jsonb_object_keys(incident) k where k not in ('reportedName','reportedAddress','reportedUnit','description')) then raise exception 'Invalid incident' using errcode='22023'; end if;
  name=btrim(incident->>'reportedName'); address=btrim(incident->>'reportedAddress'); unit_label=btrim(incident->>'reportedUnit'); description=btrim(incident->>'description');
  if length(name) not between 2 and 150 or length(address) not between 5 and 300 or length(unit_label) not between 1 and 80 or length(description) not between 3 and 4000 then raise exception 'Incomplete incident' using errcode='22023'; end if;
  facts=jsonb_build_object('reportedName',name,'reportedAddress',address,'reportedUnit',unit_label,'description',description);
  if s.request_id is not null then
    select * into req from public.pma_maintenance_requests x where x.id=s.request_id and x.tenant_id=t and x.property_id=p;
    if s.incident_facts<>facts then return jsonb_build_object('success',false,'state','CONFLICT','requestId',req.id,'caseNumber',req.case_number,'operationId',req.operation_id,'notificationSent',false); end if;
    return jsonb_build_object('success',true,'state','CONFIRMED','requestId',req.id,'caseNumber',req.case_number,'operationId',req.operation_id,'notificationSent',false,'vendorAssigned',false,'replayed',true);
  end if;
  select id into contact from public.ai4cc_contacts x where x.tenant_id=t and x.phone=s.caller_number order by x.updated_at desc limit 1;
  if contact is null then
    insert into public.ai4cc_contacts(tenant_id,display_name,phone,lead_source,metadata)
    values(t,name,s.caller_number,'pma_voice_intake',jsonb_build_object('identity_status','caller_asserted','pma_voice_session_id',session_id)) returning id into contact;
  end if;
  urgent=description~*'(fire|smoke|gas leak|smell gas|carbon monoxide|sparking|electrical hazard|electrical danger|severe flooding|burst pipe|immediate threat|immediate danger)';
  opid='pma:v1:'||gen_random_uuid()::text;
  insert into public.pma_maintenance_requests(tenant_id,property_id,contact_id,interaction_id,operation_id,summary,description,category,priority,status,source_channel,risk_assessment,intake_details)
  values(t,p,contact,null,opid,left(description,500),description,'other',case when urgent then 'emergency' else 'normal' end,'New','voice',jsonb_build_object('urgentReviewRequired',urgent),jsonb_build_object('voiceSessionId',session_id,'callerAssertedIdentity',true,'reportedName',name,'reportedAddress',address,'reportedUnit',unit_label,'descriptionVerbatim',description,'contactPreferenceState','NOT_COLLECTED')) returning * into req;
  update public.pma_voice_sessions set contact_id=contact,incident_facts=facts,request_id=req.id,updated_at=now() where id=session_id;
  return jsonb_build_object('success',true,'state','CONFIRMED','requestId',req.id,'caseNumber',req.case_number,'operationId',req.operation_id,'notificationSent',false,'notificationState','NOT_SENT','vendorAssigned',false,'urgentReviewRequired',urgent);
end $$;
revoke all on function public.pma_voice_incident_create_v1(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.pma_voice_incident_create_v1(uuid,uuid,uuid,text,text,jsonb) to service_role;

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

create or replace function public.pma_voice_incident_email_claim_v1(
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
  if pref->>'method' <> 'email' or coalesce((pref->'consent')::boolean, false) is distinct from true then
    return jsonb_build_object('success', false, 'state', 'NOT_ELIGIBLE');
  end if;
  ns := pref->>'notificationState';
  if ns = 'SENDING' then
    return jsonb_build_object('success', false, 'state', 'IN_PROGRESS');
  end if;
  if ns = 'SENT' then
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
revoke all on function public.pma_voice_incident_email_claim_v1(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.pma_voice_incident_email_claim_v1(uuid,uuid,uuid,text,text) to service_role;

commit;

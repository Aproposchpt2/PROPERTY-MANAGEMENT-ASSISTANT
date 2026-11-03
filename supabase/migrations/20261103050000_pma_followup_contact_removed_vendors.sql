-- Follow-up calls: a caller can ask for a text or email about a case filed earlier from the
-- same phone. pma_voice_incident_preference_v1 only works on the call that created the case.
-- Ownership is the caller ID matching a voice session linked to that case.
create or replace function public.pma_voice_followup_preference_v1(
  t uuid, p uuid, caller_number text, case_number text, method text, destination text, consent boolean)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare req public.pma_maintenance_requests; normalized text; opid text; ns text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  if method not in ('sms','email','phone') or consent is distinct from true then
    raise exception 'Explicit consent required' using errcode='22023';
  end if;
  normalized := btrim(destination);
  if method='email' and normalized !~ '^[^ @]+@[^ @]+\.[^ @]+$' then raise exception 'Invalid email' using errcode='22023'; end if;
  if method in ('sms','phone') and normalized !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Invalid phone' using errcode='22023'; end if;
  if caller_number is null or caller_number !~ '^\+[1-9][0-9]{7,14}$' or caller_number = '+10000000000' then
    return jsonb_build_object('success',false,'state','NOT_ELIGIBLE');
  end if;
  select r.* into req
  from public.pma_maintenance_requests r
  where r.case_number = pma_voice_followup_preference_v1.case_number and r.tenant_id = t and r.property_id = p
    and exists (
      select 1 from public.pma_voice_sessions s
      where s.request_id = r.id and s.tenant_id = t and s.property_id = p
        and s.caller_number = pma_voice_followup_preference_v1.caller_number)
  for update of r;
  if not found then return jsonb_build_object('success',false,'state','NOT_ELIGIBLE'); end if;
  ns := req.intake_details->'contactPreference'->>'notificationState';
  if ns = 'SENDING' then return jsonb_build_object('success',false,'state','IN_PROGRESS'); end if;
  opid := 'pma:v1:'||gen_random_uuid()::text;
  update public.pma_maintenance_requests set intake_details = intake_details || jsonb_build_object(
    'contactPreferenceState','RECORDED',
    'contactPreference',jsonb_build_object(
      'method',method,'destination',normalized,'consent',true,'operationId',opid,'recordedAt',now(),
      'notificationSent',false,'recordedOnFollowUp',true,
      'notificationState',case when method in ('sms','email') then 'SENDING' else 'NOT_SENT' end,
      'notificationClaimedAt',now()))
  where id = req.id;
  return jsonb_build_object('success',true,'state','CONFIRMED','requestId',req.id,'caseNumber',req.case_number,
    'operationId',opid,'language',coalesce(req.intake_details->>'language','en'));
end $function$;

create or replace function public.pma_voice_followup_notify_result_v1(
  t uuid, p uuid, request_id uuid, message_ref text, outcome text, error_code text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare req public.pma_maintenance_requests; pref jsonb;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  if outcome not in ('SENT','FAILED','OPTED_OUT') then raise exception 'Invalid outcome' using errcode='22023'; end if;
  select r.* into req from public.pma_maintenance_requests r
    where r.id = pma_voice_followup_notify_result_v1.request_id and r.tenant_id = t and r.property_id = p for update;
  if not found then return jsonb_build_object('success',false,'state','NOT_FOUND'); end if;
  pref := req.intake_details->'contactPreference';
  if pref->>'notificationState' is distinct from 'SENDING' then
    return jsonb_build_object('success',false,'state','NOT_SENDING');
  end if;
  update public.pma_maintenance_requests set intake_details = intake_details || jsonb_build_object(
    'contactPreference', pref || jsonb_build_object(
      'notificationState',outcome,'notificationSent',outcome='SENT',
      'messageId',message_ref,'errorCode',error_code,'notificationAt',now()))
  where id = req.id;
  return jsonb_build_object('success',true,'state',outcome);
end $function$;

revoke all on function public.pma_voice_followup_preference_v1(uuid,uuid,text,text,text,text,boolean) from public, anon, authenticated;
revoke all on function public.pma_voice_followup_notify_result_v1(uuid,uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.pma_voice_followup_preference_v1(uuid,uuid,text,text,text,text,boolean) to service_role;
grant execute on function public.pma_voice_followup_notify_result_v1(uuid,uuid,uuid,text,text,text) to service_role;

-- A vendor removed from a job can no longer decline it, propose a time, post status or ask for
-- cost approval on it. Accept and work orders already exclude cancelled assignments.
do $$
declare fn text; d text; anchor text;
begin
  foreach fn in array array['pma_vendor_decline_v1','pma_vendor_propose_window_v1','pma_vendor_post_status_v1','pma_vendor_request_nte_v1'] loop
    select pg_get_functiondef(x.oid) into d from pg_proc x join pg_namespace n on n.oid=x.pronamespace
      where n.nspname='public' and x.proname=fn;
    anchor := 'WHERE va.vendor_id = '||fn||'.vendor_id';
    if position(anchor in d) = 0 then raise exception 'anchor missing in %', fn; end if;
    execute replace(d, anchor, 'WHERE va.status IS DISTINCT FROM ''cancelled'' AND va.vendor_id = '||fn||'.vendor_id');
  end loop;
end $$;

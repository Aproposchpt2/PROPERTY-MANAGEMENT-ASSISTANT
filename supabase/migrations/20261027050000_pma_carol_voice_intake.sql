begin;

alter table public.pma_maintenance_requests
  add column if not exists case_number text,
  add column if not exists intake_details jsonb not null default '{}'::jsonb;

update public.pma_maintenance_requests
set case_number = 'PMA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
where case_number is null;

alter table public.pma_maintenance_requests
  alter column case_number set default ('PMA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  alter column case_number set not null;

create unique index if not exists pma_maintenance_requests_case_number_uq
  on public.pma_maintenance_requests(case_number);

create table if not exists public.pma_voice_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  property_id uuid not null,
  contact_id uuid,
  call_sid text not null check (call_sid ~ '^[!-~]{1,200}$'),
  sip_call_id text not null check (length(sip_call_id) between 1 and 200),
  caller_number text not null check (caller_number ~ '^\+[1-9][0-9]{7,14}$'),
  status text not null default 'active' check (status in ('active','closed')),
  incident_facts jsonb,
  request_id uuid,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (tenant_id, call_sid),
  unique (tenant_id, sip_call_id),
  foreign key (tenant_id, property_id) references public.pma_properties(tenant_id, id),
  foreign key (tenant_id, contact_id) references public.ai4cc_contacts(tenant_id, id),
  foreign key (tenant_id, property_id, request_id) references public.pma_maintenance_requests(tenant_id, property_id, id)
);

alter table public.pma_voice_sessions enable row level security;
revoke all on public.pma_voice_sessions from public, anon, authenticated;
grant select, insert, update on public.pma_voice_sessions to service_role;

create or replace function public.pma_voice_session_start_v1(t uuid, p uuid, call_sid text, sip_call_id text, caller_number text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare existing public.pma_voice_sessions; created public.pma_voice_sessions;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  if call_sid !~ '^[!-~]{1,200}$' or length(sip_call_id) not between 1 and 200 or caller_number !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Invalid call identity' using errcode='22023'; end if;
  if not exists(select 1 from public.pma_properties x where x.tenant_id=t and x.id=p and x.status='active') then raise exception 'Property unavailable' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(t::text || ':pma-voice:' || call_sid, 0));
  select * into existing from public.pma_voice_sessions x where x.tenant_id=t and x.call_sid=pma_voice_session_start_v1.call_sid for update;
  if found then
    if existing.sip_call_id<>sip_call_id or existing.caller_number<>caller_number then raise exception 'Call identity conflict' using errcode='23514'; end if;
    return jsonb_build_object('session_id',existing.id,'call_sid',existing.call_sid,'sip_call_id',existing.sip_call_id,'caller_number',existing.caller_number,'duplicate',true);
  end if;
  insert into public.pma_voice_sessions(tenant_id,property_id,call_sid,sip_call_id,caller_number)
  values(t,p,call_sid,sip_call_id,caller_number) returning * into created;
  return jsonb_build_object('session_id',created.id,'call_sid',created.call_sid,'sip_call_id',created.sip_call_id,'caller_number',created.caller_number);
end $$;
revoke all on function public.pma_voice_session_start_v1(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.pma_voice_session_start_v1(uuid,uuid,text,text,text) to service_role;

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

create or replace function public.pma_voice_incident_preference_v1(t uuid, p uuid, session_id uuid, call_sid text, sip_call_id text, method text, destination text, consent boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.pma_voice_sessions; req public.pma_maintenance_requests; normalized text; opid text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  if method not in ('sms','email','phone') or consent is distinct from true then raise exception 'Explicit consent required' using errcode='22023'; end if;
  normalized=btrim(destination);
  if method='email' and normalized !~ '^[^ @]+@[^ @]+\.[^ @]+$' then raise exception 'Invalid email' using errcode='22023'; end if;
  if method in ('sms','phone') and normalized !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Invalid phone' using errcode='22023'; end if;
  select * into s from public.pma_voice_sessions x where x.id=session_id and x.tenant_id=t and x.property_id=p for update;
  if not found or s.call_sid<>call_sid or s.sip_call_id<>sip_call_id or s.status<>'active' or s.request_id is null then raise exception 'Incident required' using errcode='42501'; end if;
  select * into req from public.pma_maintenance_requests x where x.id=s.request_id and x.tenant_id=t and x.property_id=p for update;
  if req.intake_details->'contactPreference'->>'method'=method and req.intake_details->'contactPreference'->>'destination'=normalized and req.intake_details->'contactPreference'->'consent'='true'::jsonb then
    return jsonb_build_object('success',true,'state','CONFIRMED','requestId',req.id,'operationId',req.intake_details->'contactPreference'->>'operationId','notificationSent',false,'replayed',true);
  end if;
  opid='pma:v1:'||gen_random_uuid()::text;
  update public.pma_maintenance_requests set intake_details=intake_details||jsonb_build_object('contactPreferenceState','RECORDED','contactPreference',jsonb_build_object('method',method,'destination',normalized,'consent',true,'operationId',opid,'recordedAt',now(),'notificationSent',false)) where id=req.id;
  return jsonb_build_object('success',true,'state','CONFIRMED','requestId',req.id,'operationId',opid,'notificationSent',false);
end $$;
revoke all on function public.pma_voice_incident_preference_v1(uuid,uuid,uuid,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.pma_voice_incident_preference_v1(uuid,uuid,uuid,text,text,text,text,boolean) to service_role;

create or replace function public.pma_voice_session_close_v1(t uuid, p uuid, session_id uuid, call_sid text, sip_call_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  update public.pma_voice_sessions set status='closed',ended_at=coalesce(ended_at,now()),updated_at=now() where id=session_id and tenant_id=t and property_id=p and pma_voice_sessions.call_sid=$4 and pma_voice_sessions.sip_call_id=$5;
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'PMA session not found' using errcode='42501'; end if;
  return jsonb_build_object('success',true,'state','CLOSED');
end $$;
revoke all on function public.pma_voice_session_close_v1(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.pma_voice_session_close_v1(uuid,uuid,uuid,text,text) to service_role;

commit;

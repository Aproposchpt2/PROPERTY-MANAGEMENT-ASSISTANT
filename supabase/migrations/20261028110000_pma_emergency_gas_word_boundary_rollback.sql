-- Rollback: restore the urgent pattern from 20261028100000_pma_emergency_detection.
begin;
create or replace function public.pma_voice_incident_create_v1(t uuid, p uuid, session_id uuid, call_sid text, sip_call_id text, incident jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.pma_voice_sessions; req public.pma_maintenance_requests; contact uuid; facts jsonb; opid text;
name text; address text; unit_label text; description text; urgent boolean; lang text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  select * into s from public.pma_voice_sessions x where x.id=session_id and x.tenant_id=t and x.property_id=p for update;
  if not found or s.call_sid<>call_sid or s.sip_call_id<>sip_call_id or s.status<>'active' or s.started_at<now()-interval '2 hours' then raise exception 'Active PMA call required' using errcode='42501'; end if;
  if jsonb_typeof(incident) is distinct from 'object' or exists(select 1 from jsonb_object_keys(incident) k where k not in ('reportedName','reportedAddress','reportedUnit','description','language')) then raise exception 'Invalid incident' using errcode='22023'; end if;
  if incident ? 'language' and incident->>'language' not in ('en','es') then raise exception 'Invalid language' using errcode='22023'; end if;
  name=btrim(incident->>'reportedName'); address=btrim(incident->>'reportedAddress'); unit_label=btrim(incident->>'reportedUnit'); description=btrim(incident->>'description');
  if length(name) not between 2 and 150 or length(address) not between 5 and 300 or length(unit_label) not between 1 and 80 or length(description) not between 3 and 4000 then raise exception 'Incomplete incident' using errcode='22023'; end if;
  lang=coalesce(incident->>'language','en');
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
  urgent=description~*'(smell(s|ed|ing)?[[:space:]]+(of[[:space:]]+|like[[:space:]]+)?gas|gas[[:space:]]+(smell|odor|leak)|odor[[:space:]]+of[[:space:]]+gas|fire|smoke|carbon[[:space:]]+monoxide|co[[:space:]]+(alarm|detector)|spark(s|ing)?|electrical[[:space:]]+(hazard|danger|fire)|exposed[[:space:]]+wires?|flood(ing|ed)?|burst[[:space:]]+pipe|water[[:space:]]+leak|leak(ing)?|sewage|sewer[[:space:]]+back|no[[:space:]]+(heat|water|power|electricity)|without[[:space:]]+(heat|water|power)|immediate[[:space:]]+(threat|danger)|(huele|olor|oler)[[:space:]]+a[[:space:]]+gas|fuga[[:space:]]+de[[:space:]]+gas|gas|incendio|fuego|humo|mon[oó]xido|chispas?|cortocircuito|cables?[[:space:]]+expuestos?|inundaci[oó]n|inundad[oa]|fuga[[:space:]]+de[[:space:]]+agua|tuber[ií]a[[:space:]]+rota|aguas?[[:space:]]+negras|sin[[:space:]]+(calefacci[oó]n|agua|luz|electricidad)|peligro)';
  opid='pma:v1:'||gen_random_uuid()::text;
  insert into public.pma_maintenance_requests(tenant_id,property_id,contact_id,interaction_id,operation_id,summary,description,category,priority,status,source_channel,risk_assessment,intake_details)
  values(t,p,contact,null,opid,left(description,500),description,'other',case when urgent then 'emergency' else 'normal' end,'New','voice',jsonb_build_object('urgentReviewRequired',urgent),jsonb_build_object('voiceSessionId',session_id,'callerAssertedIdentity',true,'reportedName',name,'reportedAddress',address,'reportedUnit',unit_label,'descriptionVerbatim',description,'contactPreferenceState','NOT_COLLECTED','language',lang)) returning * into req;
  update public.pma_voice_sessions set contact_id=contact,incident_facts=facts,request_id=req.id,updated_at=now() where id=session_id;
  return jsonb_build_object('success',true,'state','CONFIRMED','requestId',req.id,'caseNumber',req.case_number,'operationId',req.operation_id,'notificationSent',false,'notificationState','NOT_SENT','vendorAssigned',false,'urgentReviewRequired',urgent);
end $$;
revoke all on function public.pma_voice_incident_create_v1(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.pma_voice_incident_create_v1(uuid,uuid,uuid,text,text,jsonb) to service_role;

commit;

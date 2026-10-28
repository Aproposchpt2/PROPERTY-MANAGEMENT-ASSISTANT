begin;

-- pma_portal_token_issue_v1: issue a read-only status link token (store only the hash)
create or replace function public.pma_portal_token_issue_v1(
  t uuid, p uuid, request_id uuid, token_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  if length(token_hash) <> 64 or token_hash !~ '^[0-9a-f]+$' then
    raise exception 'token_hash must be a 64-char hex SHA-256' using errcode='22023';
  end if;
  if not exists(select 1 from public.pma_maintenance_requests x
    where x.id=pma_portal_token_issue_v1.request_id and x.tenant_id=t and x.property_id=p) then
    raise exception 'Case not found' using errcode='42501';
  end if;
  if exists(
    select 1 from public.pma_portal_tokens x
    where x.tenant_id=t and x.property_id=p and x.request_id=pma_portal_token_issue_v1.request_id
      and x.revoked_at is null and (x.expires_at is null or x.expires_at > now())
  ) then
    return jsonb_build_object('exists',true);
  end if;
  insert into public.pma_portal_tokens(tenant_id,property_id,request_id,token_hash)
  values(t,p,pma_portal_token_issue_v1.request_id,pma_portal_token_issue_v1.token_hash);
  return jsonb_build_object('success',true);
end $$;
revoke all on function public.pma_portal_token_issue_v1(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.pma_portal_token_issue_v1(uuid,uuid,uuid,text) to service_role;

-- pma_portal_case_view_v1: read-only tenant view; never exposes private fields
create or replace function public.pma_portal_case_view_v1(token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  tok public.pma_portal_tokens; r public.pma_maintenance_requests; tz text; vendor_name text; timeline jsonb;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  select * into tok from public.pma_portal_tokens x
    where x.token_hash=pma_portal_case_view_v1.token_hash;
  if not found or tok.revoked_at is not null
     or (tok.expires_at is not null and tok.expires_at <= now()) then
    return jsonb_build_object('success',false,'state','NOT_FOUND');
  end if;
  select * into r from public.pma_maintenance_requests x
    where x.id=tok.request_id and x.tenant_id=tok.tenant_id and x.property_id=tok.property_id;
  if not found then return jsonb_build_object('success',false,'state','NOT_FOUND'); end if;
  select prop.timezone into tz from public.pma_properties prop
    where prop.id=tok.property_id and prop.tenant_id=tok.tenant_id;
  select c.company_name into vendor_name
  from public.pma_vendor_assignments va
  join public.pma_vendors v on v.id=va.vendor_id and v.tenant_id=tok.tenant_id
  join public.ai4cc_contacts c on c.id=v.contact_id and c.tenant_id=tok.tenant_id
  where va.tenant_id=tok.tenant_id and va.property_id=tok.property_id and va.request_id=r.id
    and va.status in ('assigned','accepted')
  order by va.created_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('eventType',a.event_type,'createdAt',a.created_at) order by a.created_at),'[]'::jsonb)
  into timeline from public.pma_maintenance_activity a
  where a.tenant_id=tok.tenant_id and a.property_id=tok.property_id and a.request_id=r.id;
  return jsonb_build_object(
    'success',true,
    'caseNumber',r.case_number,
    'createdAt',r.created_at,
    'status',r.status,
    'isEmergency',(r.priority='emergency'),
    'language',coalesce(r.intake_details->>'language','en'),
    'tenantUpdate',r.tenant_update,
    'vendorName',vendor_name,
    'scheduledStart',(select va2.scheduled_start from public.pma_vendor_assignments va2 where va2.tenant_id=tok.tenant_id and va2.property_id=tok.property_id and va2.request_id=r.id and va2.status in ('assigned','accepted') order by va2.created_at desc limit 1),
    'scheduledEnd',(select va2.scheduled_end from public.pma_vendor_assignments va2 where va2.tenant_id=tok.tenant_id and va2.property_id=tok.property_id and va2.request_id=r.id and va2.status in ('assigned','accepted') order by va2.created_at desc limit 1),
    'completedAt',r.completed_at,
    'propertyTimezone',coalesce(tz,'America/Los_Angeles'),
    'timeline',timeline
  );
end $$;
revoke all on function public.pma_portal_case_view_v1(text) from public,anon,authenticated;
grant execute on function public.pma_portal_case_view_v1(text) to service_role;

-- Extend pma_voice_case_lookup_v1 to return vendorName, scheduledStart/End, propertyTimezone, tenantUpdate, completedAt
-- Preserves a2e2cfc parameter qualification (function_name.param).
create or replace function public.pma_voice_case_lookup_v1(
  t uuid, p uuid, caller_number text, case_number text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  req public.pma_maintenance_requests; match_count int;
  vendor_name text; sched_start timestamptz; sched_end timestamptz; tz text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  if pma_voice_case_lookup_v1.case_number is not null and pma_voice_case_lookup_v1.case_number<>'' then
    select r.* into req from public.pma_maintenance_requests r
    where r.case_number=pma_voice_case_lookup_v1.case_number and r.tenant_id=t and r.property_id=p;
    if not found then return jsonb_build_object('success',false,'state','NOT_FOUND'); end if;
  else
    if pma_voice_case_lookup_v1.caller_number is null or pma_voice_case_lookup_v1.caller_number='' then
      return jsonb_build_object('success',false,'state','NO_IDENTIFIER');
    end if;
    select count(*) into match_count from public.pma_voice_sessions s
    join public.pma_maintenance_requests r on r.id=s.request_id
    where s.caller_number=pma_voice_case_lookup_v1.caller_number and s.tenant_id=t and s.property_id=p
      and r.tenant_id=t and r.property_id=p;
    if match_count=0 then return jsonb_build_object('success',false,'state','NOT_FOUND'); end if;
    if match_count>1 then return jsonb_build_object('success',false,'state','MULTIPLE_CASES','count',match_count); end if;
    select r.* into req from public.pma_voice_sessions s
    join public.pma_maintenance_requests r on r.id=s.request_id
    where s.caller_number=pma_voice_case_lookup_v1.caller_number and s.tenant_id=t and s.property_id=p
      and r.tenant_id=t and r.property_id=p limit 1;
  end if;
  select c.company_name, va.scheduled_start, va.scheduled_end
  into vendor_name, sched_start, sched_end
  from public.pma_vendor_assignments va
  join public.pma_vendors v on v.id=va.vendor_id and v.tenant_id=t
  join public.ai4cc_contacts c on c.id=v.contact_id and c.tenant_id=t
  where va.tenant_id=t and va.property_id=p and va.request_id=req.id and va.status in ('assigned','accepted')
  order by va.created_at desc limit 1;
  select prop.timezone into tz from public.pma_properties prop where prop.id=p and prop.tenant_id=t;
  return jsonb_build_object(
    'success',true,
    'caseNumber',req.case_number,'status',req.status,'summary',req.summary,
    'category',req.category,'priority',req.priority,'createdAt',req.created_at,
    'vendorName',vendor_name,'scheduledStart',sched_start,'scheduledEnd',sched_end,
    'propertyTimezone',coalesce(tz,'America/Los_Angeles'),
    'tenantUpdate',req.tenant_update,'completedAt',req.completed_at
  );
end $$;
revoke all on function public.pma_voice_case_lookup_v1(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.pma_voice_case_lookup_v1(uuid,uuid,text,text) to service_role;

commit;

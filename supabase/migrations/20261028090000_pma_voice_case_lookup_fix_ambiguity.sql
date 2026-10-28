-- Fix 42702 'column reference "case_number" is ambiguous' in pma_voice_case_lookup_v1.
-- Parameter names collide with column names; qualify parameter references with the function name.
-- Signature, security, grants unchanged.
begin;

create or replace function public.pma_voice_case_lookup_v1(
  t uuid, p uuid, caller_number text, case_number text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  req public.pma_maintenance_requests;
  match_count int;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;

  -- Lookup by case number when provided
  if pma_voice_case_lookup_v1.case_number is not null and pma_voice_case_lookup_v1.case_number <> '' then
    select r.* into req
    from public.pma_maintenance_requests r
    where r.case_number = pma_voice_case_lookup_v1.case_number
      and r.tenant_id = t and r.property_id = p;
    if not found then
      return jsonb_build_object('success', false, 'state', 'NOT_FOUND');
    end if;
    return jsonb_build_object(
      'success', true,
      'caseNumber', req.case_number,
      'status', req.status,
      'summary', req.summary,
      'category', req.category,
      'priority', req.priority,
      'createdAt', req.created_at
    );
  end if;

  -- Lookup by caller number via sessions
  if pma_voice_case_lookup_v1.caller_number is null or pma_voice_case_lookup_v1.caller_number = '' then
    return jsonb_build_object('success', false, 'state', 'NO_IDENTIFIER');
  end if;

  select count(*) into match_count
  from public.pma_voice_sessions s
  join public.pma_maintenance_requests r on r.id = s.request_id
  where s.caller_number = pma_voice_case_lookup_v1.caller_number
    and s.tenant_id = t and s.property_id = p
    and r.tenant_id = t and r.property_id = p;

  if match_count = 0 then
    return jsonb_build_object('success', false, 'state', 'NOT_FOUND');
  end if;

  if match_count > 1 then
    return jsonb_build_object(
      'success', false,
      'state', 'MULTIPLE_CASES',
      'count', match_count
    );
  end if;

  select r.* into req
  from public.pma_voice_sessions s
  join public.pma_maintenance_requests r on r.id = s.request_id
  where s.caller_number = pma_voice_case_lookup_v1.caller_number
    and s.tenant_id = t and s.property_id = p
    and r.tenant_id = t and r.property_id = p
  limit 1;

  return jsonb_build_object(
    'success', true,
    'caseNumber', req.case_number,
    'status', req.status,
    'summary', req.summary,
    'category', req.category,
    'priority', req.priority,
    'createdAt', req.created_at
  );
end $$;
revoke all on function public.pma_voice_case_lookup_v1(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.pma_voice_case_lookup_v1(uuid,uuid,text,text) to service_role;

commit;

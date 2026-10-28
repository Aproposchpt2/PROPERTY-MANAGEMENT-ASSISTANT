-- When a caller's number matches several cases, return a short list of those cases
-- (case number, short issue summary, unit, status, date) so Ava can ask which issue
-- they're calling about instead of requiring a case number. Only cases filed from the
-- caller's own number are listed. Newest six.
do $$
declare d text; d2 text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='pma_voice_case_lookup_v1';
  d2 := replace(d,
    $old$if match_count>1 then return jsonb_build_object('success',false,'state','MULTIPLE_CASES','count',match_count); end if;$old$,
    $new$if match_count>1 then
      return jsonb_build_object('success',false,'state','MULTIPLE_CASES','count',match_count,
        'cases',(select coalesce(jsonb_agg(c order by c_created desc),'[]'::jsonb) from (
          select r.created_at as c_created, jsonb_build_object(
            'caseNumber',r.case_number,
            'issue',left(coalesce(r.summary,''),120),
            'unit',r.intake_details->>'reportedUnit',
            'status',r.status,
            'reportedOn',to_char(r.created_at at time zone coalesce((select prop.timezone from public.pma_properties prop where prop.id=p and prop.tenant_id=t),'America/Los_Angeles'),'FMDay, FMMonth FMDD')
          ) as c
          from public.pma_voice_sessions s
          join public.pma_maintenance_requests r on r.id=s.request_id
          where s.caller_number=pma_voice_case_lookup_v1.caller_number and s.tenant_id=t and s.property_id=p
            and r.tenant_id=t and r.property_id=p
          order by r.created_at desc limit 6) x));
    end if;$new$);
  if d2 = d then raise exception 'pma_voice_case_lookup_v1 body not as expected; aborting'; end if;
  execute d2;
end $$;

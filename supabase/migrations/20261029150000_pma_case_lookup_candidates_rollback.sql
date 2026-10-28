-- Rollback: MULTIPLE_CASES returns only state and count again.
do $$
declare d text; i int; j int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='pma_voice_case_lookup_v1';
  i := position('if match_count>1 then' in d);
  j := position('end if;' in substr(d, i)) + i + 6;
  d := substr(d,1,i-1) || $r$if match_count>1 then return jsonb_build_object('success',false,'state','MULTIPLE_CASES','count',match_count); end if;$r$ || substr(d,j);
  execute d;
end $$;

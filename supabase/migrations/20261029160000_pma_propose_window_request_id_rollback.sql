-- Rollback: stop returning requestId from pma_vendor_propose_window_v1.
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='pma_vendor_propose_window_v1';
  d := replace(d, $o$,'requestId',v_request_id$o$, '');
  execute d;
end $$;

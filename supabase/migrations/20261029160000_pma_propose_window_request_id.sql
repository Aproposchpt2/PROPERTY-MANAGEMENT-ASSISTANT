-- Return requestId from pma_vendor_propose_window_v1 so the vendor endpoint can
-- refresh the tenant-facing update when a vendor's window is confirmed.
do $$
declare d text; d2 text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='pma_vendor_propose_window_v1';
  d2 := replace(d, $o$'confirmed',true,'caseNumber',v_case_number,$o$, $n$'confirmed',true,'caseNumber',v_case_number,'requestId',v_request_id,$n$);
  d2 := replace(d2, $o$'confirmed',false,'caseNumber',v_case_number$o$, $n$'confirmed',false,'caseNumber',v_case_number,'requestId',v_request_id$n$);
  if d2 = d then raise exception 'pma_vendor_propose_window_v1 body not as expected; aborting'; end if;
  execute d2;
end $$;

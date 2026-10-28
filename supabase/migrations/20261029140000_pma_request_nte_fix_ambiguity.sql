-- pma_vendor_request_nte_v1 raised 42702 "column reference vendor_id is ambiguous":
-- the UPDATE of pma_vendor_assignments used unqualified vendor_id/request_id, and
-- vendor_id is also a parameter name. Qualify the columns. Nothing else changes.
do $$
declare d text; d2 text;
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'pma_vendor_request_nte_v1';
  d2 := regexp_replace(d,
    'UPDATE public\.pma_vendor_assignments SET quoted_amount\s*=\s*amount,\s*updated_at\s*=\s*now\(\)\s*WHERE vendor_id\s*=\s*pma_vendor_request_nte_v1\.vendor_id AND request_id\s*=\s*v_request_id;',
    'UPDATE public.pma_vendor_assignments va_q SET quoted_amount = pma_vendor_request_nte_v1.amount, updated_at = now()
    WHERE va_q.vendor_id = pma_vendor_request_nte_v1.vendor_id AND va_q.request_id = v_request_id;');
  if d2 = d then raise exception 'pma_vendor_request_nte_v1 body not as expected; aborting'; end if;
  execute d2;
end $$;

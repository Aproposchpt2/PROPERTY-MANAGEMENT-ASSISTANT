-- Rollback: restore the unqualified UPDATE (function will fail again with 42702).
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='pma_vendor_request_nte_v1';
  d := replace(d,
    'UPDATE public.pma_vendor_assignments va_q SET quoted_amount = pma_vendor_request_nte_v1.amount, updated_at = now()
    WHERE va_q.vendor_id = pma_vendor_request_nte_v1.vendor_id AND va_q.request_id = v_request_id;',
    'UPDATE public.pma_vendor_assignments SET quoted_amount=amount, updated_at=now()
    WHERE vendor_id=pma_vendor_request_nte_v1.vendor_id AND request_id=v_request_id;');
  execute d;
end $$;

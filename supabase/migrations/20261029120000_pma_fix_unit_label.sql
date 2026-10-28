-- pma_units has no unit_number column (the column is "label"), so every RPC that
-- read u.unit_number failed with 42703, including the vendor line's work order list.
-- 1) Recreate the two live callers with the real column, falling back to the
--    caller-reported unit stored on voice cases.
-- 2) Drop the unused 4-argument overloads of pma_mgr_case_get_v1 / pma_mgr_case_list_v1
--    added in 20261029110000. The manager API calls the 3-argument versions; the extra
--    overloads were broken and make positional calls ambiguous.
do $$
declare r record; d text;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.proname in ('pma_vendor_work_orders_v1', 'pma_approval_load_v1')
      and p.prosrc like '%u.unit_number%'
  loop
    d := pg_get_functiondef(r.oid);
    d := replace(d, 'u.unit_number', 'coalesce(u.label, mr.intake_details->>''reportedUnit'')');
    execute d;
  end loop;
end $$;

drop function if exists public.pma_mgr_case_get_v1(uuid, uuid, uuid, uuid);
drop function if exists public.pma_mgr_case_list_v1(uuid, uuid, uuid, text[]);

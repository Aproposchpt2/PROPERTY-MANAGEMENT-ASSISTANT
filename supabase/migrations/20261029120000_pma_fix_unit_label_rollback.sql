-- Rollback for 20261029120000_pma_fix_unit_label.sql
-- Restores u.unit_number in the two functions (they will fail again with 42703).
do $$
declare r record; d text;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.proname in ('pma_vendor_work_orders_v1', 'pma_approval_load_v1')
  loop
    d := pg_get_functiondef(r.oid);
    d := replace(d, 'coalesce(u.label, mr.intake_details->>''reportedUnit'')', 'u.unit_number');
    execute d;
  end loop;
end $$;
-- The dropped 4-argument overloads can be restored by re-running their
-- CREATE FUNCTION blocks from 20261029110000_pma_approval_rpcs.sql.

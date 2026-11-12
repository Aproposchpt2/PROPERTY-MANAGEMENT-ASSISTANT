begin;

-- The web dashboard (main, PR #32) and the staff app offer three more staff statuses:
-- Waiting on Parts, Waiting on Tenant Access, On Hold. The table check only allowed the original
-- six, so saving one of them failed. Allow all nine. Existing rows already satisfy the new check.
alter table public.pma_maintenance_requests drop constraint if exists pma_maintenance_requests_status_check;
alter table public.pma_maintenance_requests add constraint pma_maintenance_requests_status_check
  check (status = any (array[
    'New', 'Assigned', 'Scheduled', 'In Progress',
    'Waiting on Parts', 'Waiting on Tenant Access', 'On Hold',
    'Completed', 'Closed'
  ]::text[]));

commit;

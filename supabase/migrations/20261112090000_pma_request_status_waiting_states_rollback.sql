begin;

-- Restores the original six-status check. Fails if any case currently uses a waiting/on-hold
-- status; move those cases to another status first.
alter table public.pma_maintenance_requests drop constraint if exists pma_maintenance_requests_status_check;
alter table public.pma_maintenance_requests add constraint pma_maintenance_requests_status_check
  check (status = any (array['New', 'Assigned', 'Scheduled', 'In Progress', 'Completed', 'Closed']::text[]));

commit;

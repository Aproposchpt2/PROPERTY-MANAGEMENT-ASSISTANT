begin;
drop table if exists public.pma_portal_tokens;
alter table public.pma_maintenance_requests
  drop column if exists tenant_update,
  drop column if exists internal_notes,
  drop column if exists completed_at,
  drop column if exists resolution_note;
alter table public.pma_vendor_assignments
  drop constraint if exists pma_vendor_assignments_schedule_order,
  drop column if exists scheduled_start,
  drop column if exists scheduled_end,
  drop column if exists work_order_ref;
drop table if exists public.pma_staff_property_access;
commit;

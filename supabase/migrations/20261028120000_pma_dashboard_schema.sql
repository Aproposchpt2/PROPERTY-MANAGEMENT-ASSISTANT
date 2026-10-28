begin;

-- pma_staff_property_access: MANAGER-to-property mapping (OWNER/ADMIN have full access)
create table if not exists public.pma_staff_property_access (
  id uuid primary key default gen_random_uuid(),
  tenant_user_id uuid not null references public.tenant_users(id) on delete cascade,
  property_id uuid not null references public.pma_properties(id),
  created_at timestamptz not null default now(),
  unique (tenant_user_id, property_id)
);
alter table public.pma_staff_property_access enable row level security;
revoke all on public.pma_staff_property_access from public, anon, authenticated;
grant select, insert, delete on public.pma_staff_property_access to service_role;

-- pma_vendor_assignments: add scheduling + work order columns
alter table public.pma_vendor_assignments
  add column if not exists scheduled_start timestamptz,
  add column if not exists scheduled_end timestamptz,
  add column if not exists work_order_ref text check (length(work_order_ref) <= 100);

alter table public.pma_vendor_assignments
  drop constraint if exists pma_vendor_assignments_schedule_order;
alter table public.pma_vendor_assignments
  add constraint pma_vendor_assignments_schedule_order
    check (scheduled_end is null or scheduled_start is null or scheduled_end > scheduled_start);

-- pma_maintenance_requests: add manager and portal fields
alter table public.pma_maintenance_requests
  add column if not exists tenant_update text check (length(tenant_update) <= 1000),
  add column if not exists internal_notes text check (length(internal_notes) <= 4000),
  add column if not exists completed_at timestamptz,
  add column if not exists resolution_note text check (length(resolution_note) <= 2000);

-- pma_portal_tokens: read-only tenant status links (SHA-256 hash, never raw token)
create table if not exists public.pma_portal_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  property_id uuid not null,
  request_id uuid not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  foreign key (tenant_id, property_id, request_id)
    references public.pma_maintenance_requests(tenant_id, property_id, id)
);
alter table public.pma_portal_tokens enable row level security;
revoke all on public.pma_portal_tokens from public, anon, authenticated;
grant select, insert, update on public.pma_portal_tokens to service_role;

commit;

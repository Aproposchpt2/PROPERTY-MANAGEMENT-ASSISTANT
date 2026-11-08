begin;

-- pma_push_tokens: Expo push tokens for manager devices (PMA mobile app, phase 2).
-- One row per device token. Read and written only by Netlify functions (service role):
-- the app registers through /api/manager/push-token after the manager check passes.
create table if not exists public.pma_push_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  tenant_user_id uuid not null references public.tenant_users(id) on delete cascade,
  user_id uuid not null,
  token text not null unique
    check (length(token) <= 200 and token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$'),
  platform text not null check (platform in ('ios','android')),
  prefs jsonb not null default '{"newCase":true,"emergency":true,"approval":true}'::jsonb
    check (jsonb_typeof(prefs) = 'object'),
  enabled boolean not null default true,
  last_error text check (length(last_error) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pma_push_tokens_tenant_enabled on public.pma_push_tokens (tenant_id) where enabled;
create index if not exists pma_push_tokens_user on public.pma_push_tokens (user_id);

alter table public.pma_push_tokens enable row level security;
revoke all on public.pma_push_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.pma_push_tokens to service_role;

commit;

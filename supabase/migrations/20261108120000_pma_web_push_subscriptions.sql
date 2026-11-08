begin;

-- pma_web_push_subscriptions: browser push subscriptions for managers using the PMA web app
-- (pma.stellaruc.com/app). Companion to pma_push_tokens (native phone tokens). One row per
-- browser endpoint. Read and written only by Netlify functions (service role) after the
-- manager check in /api/manager/web-push.
create table if not exists public.pma_web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  tenant_user_id uuid not null references public.tenant_users(id) on delete cascade,
  user_id uuid not null,
  endpoint text not null unique check (length(endpoint) <= 1000 and endpoint ~ '^https://'),
  p256dh text not null check (length(p256dh) between 20 and 200),
  auth text not null check (length(auth) between 8 and 100),
  prefs jsonb not null default '{"newCase":true,"emergency":true,"approval":true}'::jsonb
    check (jsonb_typeof(prefs) = 'object'),
  enabled boolean not null default true,
  last_error text check (length(last_error) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pma_web_push_subscriptions_tenant_enabled on public.pma_web_push_subscriptions (tenant_id) where enabled;
create index if not exists pma_web_push_subscriptions_user on public.pma_web_push_subscriptions (user_id);

alter table public.pma_web_push_subscriptions enable row level security;
revoke all on public.pma_web_push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.pma_web_push_subscriptions to service_role;

commit;

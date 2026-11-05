-- Call Trace Lab: one row per tool request the PMA tool function handles, and
-- staged fault drills scoped to one caller number. Service role only.
begin;

create table if not exists public.ops_call_trace (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null default 'pma-tool-function',
  phase text not null default 'finished' check (phase in ('started','finished')),
  call_sid text,
  conversation_id text,
  caller_id text,
  tool_name text,
  status_code integer,
  latency_ms integer,
  outcome_state text,
  success boolean,
  error text,
  fault_id uuid,
  fault_key text,
  request_summary jsonb not null default '{}'::jsonb,
  response_summary jsonb not null default '{}'::jsonb
);
create index if not exists ops_call_trace_call_sid_idx on public.ops_call_trace(call_sid, created_at);
create index if not exists ops_call_trace_conv_idx on public.ops_call_trace(conversation_id, created_at);
create index if not exists ops_call_trace_created_idx on public.ops_call_trace(created_at desc);

create table if not exists public.ops_fault_drills (
  id uuid primary key default gen_random_uuid(),
  fault_key text not null check (fault_key in ('tool_auth','tool_500','function_timeout','slow_backend','db_unavailable','bad_json')),
  tool_scope text not null default 'create_incident' check (tool_scope in ('create_incident','record_contact_preference','get_case_status','close_session','any')),
  caller_number text not null check (caller_number ~ '^\+[1-9][0-9]{7,14}$'),
  blind boolean not null default true,
  armed_by text not null,
  armed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  disarmed_at timestamptz,
  revealed_at timestamptz,
  hits integer not null default 0,
  last_hit_at timestamptz,
  check (expires_at > armed_at and expires_at <= armed_at + interval '2 hours')
);
create index if not exists ops_fault_drills_active_idx on public.ops_fault_drills(caller_number, expires_at) where disarmed_at is null;

alter table public.ops_call_trace enable row level security;
alter table public.ops_fault_drills enable row level security;
revoke all on public.ops_call_trace, public.ops_fault_drills from public, anon, authenticated;
grant select, insert, update, delete on public.ops_call_trace, public.ops_fault_drills to service_role;

-- Count a drill hit atomically (the tool function calls this when a drill fires).
create or replace function public.ops_fault_drill_hit_v1(drill_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.ops_fault_drills set hits = hits + 1, last_hit_at = now() where id = drill_id;
$$;
revoke all on function public.ops_fault_drill_hit_v1(uuid) from public, anon, authenticated;
grant execute on function public.ops_fault_drill_hit_v1(uuid) to service_role;

commit;

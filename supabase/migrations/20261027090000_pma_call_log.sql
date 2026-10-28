begin;

create table if not exists public.pma_call_log (
  id                  uuid        primary key default gen_random_uuid(),
  tenant_id           uuid        not null,
  property_id         uuid        not null,
  conversation_id     text        not null,
  agent_id            text,
  call_duration_secs  integer     not null default 0,
  credits_used        integer,
  twilio_cost_usd     numeric(10,4),
  termination_reason  text,
  call_successful     text,
  started_at          timestamptz,
  created_at          timestamptz not null default now(),
  unique(tenant_id, conversation_id)
);

-- Insert RPC — service_role only; called by cedar-postcall.js
create or replace function public.pma_call_log_insert_v1(
  t uuid, p uuid,
  conversation_id text,
  agent_id text,
  call_duration_secs integer,
  credits_used integer,
  twilio_cost_usd numeric,
  termination_reason text,
  call_successful text,
  started_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb->>'role'
     is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  insert into public.pma_call_log(
    tenant_id, property_id, conversation_id, agent_id,
    call_duration_secs, credits_used, twilio_cost_usd,
    termination_reason, call_successful, started_at
  ) values (
    t, p, conversation_id, agent_id,
    coalesce(call_duration_secs, 0), credits_used, twilio_cost_usd,
    termination_reason, call_successful, started_at
  )
  on conflict (tenant_id, conversation_id) do nothing;
  return jsonb_build_object('success', true);
end $$;
revoke all on function public.pma_call_log_insert_v1(uuid,uuid,text,text,integer,integer,numeric,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.pma_call_log_insert_v1(uuid,uuid,text,text,integer,integer,numeric,text,text,timestamptz)
  to service_role;

-- Summary RPC — service_role only; called by cedar-call-log.js
create or replace function public.pma_call_log_summary_v1(
  t uuid, p uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  agg jsonb;
  recent jsonb;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb->>'role'
     is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;

  select jsonb_build_object(
    'total_calls',         count(*),
    'avg_duration_secs',   round(avg(call_duration_secs))::integer,
    'total_credits',       coalesce(sum(credits_used), 0)::integer,
    'total_twilio_cost',   round(coalesce(sum(twilio_cost_usd), 0), 4),
    'successful_calls',    count(*) filter (where call_successful = 'success'),
    'failed_calls',        count(*) filter (where call_successful in ('failure', 'error'))
  ) into agg
  from public.pma_call_log
  where tenant_id = t and property_id = p;

  select jsonb_agg(row_to_json(r)::jsonb order by r.created_at desc) into recent
  from (
    select
      conversation_id,
      call_duration_secs,
      credits_used,
      twilio_cost_usd,
      termination_reason,
      call_successful,
      started_at,
      created_at
    from public.pma_call_log
    where tenant_id = t and property_id = p
    order by created_at desc
    limit 25
  ) r;

  return jsonb_build_object(
    'success', true,
    'summary', agg,
    'recent', coalesce(recent, '[]'::jsonb)
  );
end $$;
revoke all on function public.pma_call_log_summary_v1(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.pma_call_log_summary_v1(uuid,uuid)
  to service_role;

commit;

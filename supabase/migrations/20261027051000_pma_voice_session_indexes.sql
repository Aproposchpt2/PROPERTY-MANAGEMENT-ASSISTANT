begin;

create index if not exists pma_voice_sessions_tenant_property_idx
  on public.pma_voice_sessions(tenant_id, property_id);

create index if not exists pma_voice_sessions_tenant_contact_idx
  on public.pma_voice_sessions(tenant_id, contact_id)
  where contact_id is not null;

create index if not exists pma_voice_sessions_tenant_property_request_idx
  on public.pma_voice_sessions(tenant_id, property_id, request_id)
  where request_id is not null;

commit;

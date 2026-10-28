-- Rollback: restore the original (ambiguous) definition from 20261028130000.
create or replace function public.pma_mgr_vendor_upsert_v1(
  t uuid, p uuid, actor_user_id uuid, name text, trade text, phone text, v_status text default 'active'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  contact_id uuid; vendor_id uuid; n text; ph text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  n := btrim(name); ph := btrim(phone);
  if length(n) not between 2 and 150 then raise exception 'Invalid vendor name' using errcode='22023'; end if;
  if ph !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Invalid phone' using errcode='22023'; end if;
  if trade is null or length(btrim(trade)) < 2 then raise exception 'Trade required' using errcode='22023'; end if;
  if v_status not in ('active','inactive') then raise exception 'Invalid status' using errcode='22023'; end if;
  select c.id into contact_id from public.ai4cc_contacts c
    where c.tenant_id=t and c.phone=ph and c.company_name=n limit 1;
  if contact_id is null then
    insert into public.ai4cc_contacts(tenant_id,company_name,phone,lead_source,metadata)
    values(t,n,ph,'pma_vendor',jsonb_build_object('source','manager_dashboard'))
    returning id into contact_id;
  else
    update public.ai4cc_contacts set company_name=n, phone=ph, updated_at=now() where id=contact_id;
  end if;
  select v.id into vendor_id from public.pma_vendors v
    where v.tenant_id=t and v.contact_id=contact_id limit 1;
  if vendor_id is null then
    insert into public.pma_vendors(tenant_id,contact_id,trade,status)
    values(t,contact_id,btrim(trade),v_status)
    returning id into vendor_id;
  else
    update public.pma_vendors set trade=btrim(trade),status=v_status,updated_at=now() where id=vendor_id;
  end if;
  if not exists(select 1 from public.pma_property_vendors x where x.tenant_id=t and x.property_id=p and x.vendor_id=vendor_id) then
    insert into public.pma_property_vendors(tenant_id,property_id,vendor_id) values(t,p,vendor_id);
  end if;
  return jsonb_build_object('success',true,'vendorId',vendor_id,'contactId',contact_id);
end $$;
revoke all on function public.pma_mgr_vendor_upsert_v1(uuid,uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.pma_mgr_vendor_upsert_v1(uuid,uuid,uuid,text,text,text,text) to service_role;

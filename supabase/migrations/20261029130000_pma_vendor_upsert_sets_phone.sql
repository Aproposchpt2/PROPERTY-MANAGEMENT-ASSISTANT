-- The vendor line identifies callers by pma_vendors.phone (added in 20261029090000),
-- but pma_mgr_vendor_upsert_v1 only stored the phone on the contact. Every vendor added
-- from the manager dashboard was therefore "not registered" on the vendor line.
-- 1) Upsert now writes pma_vendors.phone and refuses a number another vendor holds.
-- 2) Backfill pma_vendors.phone from the contact where it is missing and unclaimed.
create or replace function public.pma_mgr_vendor_upsert_v1(
  t uuid, p uuid, actor_user_id uuid, name text, trade text, phone text, v_status text default 'active'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_contact uuid; v_vendor uuid; n text; ph text; tr text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  n := btrim(pma_mgr_vendor_upsert_v1.name);
  ph := btrim(pma_mgr_vendor_upsert_v1.phone);
  tr := btrim(pma_mgr_vendor_upsert_v1.trade);
  if length(n) not between 2 and 150 then raise exception 'Invalid vendor name' using errcode='22023'; end if;
  if ph !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Invalid phone' using errcode='22023'; end if;
  if tr is null or length(tr) < 2 then raise exception 'Trade required' using errcode='22023'; end if;
  if v_status not in ('active','inactive') then raise exception 'Invalid status' using errcode='22023'; end if;
  select c.id into v_contact from public.ai4cc_contacts c
    where c.tenant_id=t and c.phone=ph and c.company_name=n limit 1;
  if v_contact is null then
    insert into public.ai4cc_contacts(tenant_id,company_name,phone,lead_source,metadata)
    values(t,n,ph,'pma_vendor',jsonb_build_object('source','manager_dashboard'))
    returning id into v_contact;
  else
    update public.ai4cc_contacts c set company_name=n, phone=ph, updated_at=now() where c.id=v_contact;
  end if;
  select v.id into v_vendor from public.pma_vendors v
    where v.tenant_id=t and v.contact_id=v_contact limit 1;
  if exists(select 1 from public.pma_vendors x where x.tenant_id=t and x.phone=ph
            and (v_vendor is null or x.id<>v_vendor)) then
    return jsonb_build_object('success',false,'state','PHONE_IN_USE',
      'error','That phone number is already used by another vendor.');
  end if;
  if v_vendor is null then
    insert into public.pma_vendors(tenant_id,contact_id,trade,status,phone)
    values(t,v_contact,tr,v_status,ph)
    returning id into v_vendor;
  else
    update public.pma_vendors v set trade=tr,status=v_status,phone=ph,updated_at=now() where v.id=v_vendor;
  end if;
  if not exists(select 1 from public.pma_property_vendors x where x.tenant_id=t and x.property_id=p and x.vendor_id=v_vendor) then
    insert into public.pma_property_vendors(tenant_id,property_id,vendor_id) values(t,p,v_vendor);
  end if;
  return jsonb_build_object('success',true,'vendorId',v_vendor,'contactId',v_contact);
end $$;
revoke all on function public.pma_mgr_vendor_upsert_v1(uuid,uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.pma_mgr_vendor_upsert_v1(uuid,uuid,uuid,text,text,text,text) to service_role;

update public.pma_vendors v set phone = c.phone, updated_at = now()
from public.ai4cc_contacts c
where c.id = v.contact_id and v.phone is null and c.phone ~ '^\+[1-9][0-9]{7,14}$'
  and not exists (select 1 from public.pma_vendors x where x.tenant_id = v.tenant_id and x.phone = c.phone);

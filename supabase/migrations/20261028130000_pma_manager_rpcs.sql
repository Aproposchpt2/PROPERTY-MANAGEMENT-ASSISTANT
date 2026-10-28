begin;

create or replace function public.pma_mgr_case_list_v1(
  t uuid, p uuid, status_filter text[] default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  return (
    select jsonb_build_object('success',true,'cases',coalesce(jsonb_agg(row order by sort_key),'[]'::jsonb))
    from (
      select jsonb_build_object(
        'id',r.id,'caseNumber',r.case_number,'createdAt',r.created_at,'updatedAt',r.updated_at,
        'priority',r.priority,'status',r.status,
        'reportedName',r.intake_details->>'reportedName',
        'reportedAddress',r.intake_details->>'reportedAddress',
        'reportedUnit',r.intake_details->>'reportedUnit',
        'language',coalesce(r.intake_details->>'language','en'),
        'vendorName',c.company_name,
        'scheduledStart',va.scheduled_start,'scheduledEnd',va.scheduled_end,
        'tenantUpdate',r.tenant_update
      ) as row,
      case when r.priority='emergency' then 0
           when va.scheduled_start is null and r.status not in ('In Progress','Completed','Closed') then
             1000000000000::bigint + extract(epoch from r.created_at)::bigint
           else 2000000000000::bigint - extract(epoch from r.created_at)::bigint
      end as sort_key
      from public.pma_maintenance_requests r
      left join lateral (
        select va2.scheduled_start, va2.scheduled_end, va2.vendor_id
        from public.pma_vendor_assignments va2
        where va2.tenant_id=t and va2.property_id=p and va2.request_id=r.id
          and va2.status in ('assigned','accepted')
        order by va2.created_at desc limit 1
      ) va on true
      left join public.pma_vendors v on v.id=va.vendor_id and v.tenant_id=t
      left join public.ai4cc_contacts c on c.id=v.contact_id and c.tenant_id=t
      where r.tenant_id=t and r.property_id=p
        and (status_filter is null or r.status=any(status_filter))
    ) sub
  );
end $$;
revoke all on function public.pma_mgr_case_list_v1(uuid,uuid,text[]) from public,anon,authenticated;
grant execute on function public.pma_mgr_case_list_v1(uuid,uuid,text[]) to service_role;

create or replace function public.pma_mgr_case_get_v1(
  t uuid, p uuid, request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.pma_maintenance_requests;
  va_row record; c_row public.ai4cc_contacts; pref jsonb; dest text; timeline jsonb;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  select * into r from public.pma_maintenance_requests x
    where x.id=pma_mgr_case_get_v1.request_id and x.tenant_id=t and x.property_id=p;
  if not found then return jsonb_build_object('success',false,'state','NOT_FOUND'); end if;
  select va2.*, v.id as vid, c.company_name, c.phone as vendor_phone
  into va_row
  from public.pma_vendor_assignments va2
  join public.pma_vendors v on v.id=va2.vendor_id and v.tenant_id=t
  join public.ai4cc_contacts c on c.id=v.contact_id and c.tenant_id=t
  where va2.tenant_id=t and va2.property_id=p and va2.request_id=r.id
    and va2.status in ('assigned','accepted')
  order by va2.created_at desc limit 1;
  pref := r.intake_details->'contactPreference';
  dest := pref->>'destination';
  if dest is not null and dest ~ '^\+' then
    dest := '•••' || right(dest, 4);
  elsif dest is not null and dest ~ '@' then
    dest := left(dest, 1) || '•••@' || split_part(dest, '@', 2);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('eventType',a.event_type,'body',a.body,'actorUserId',a.actor_user_id,'createdAt',a.created_at) order by a.created_at),'[]'::jsonb)
  into timeline from public.pma_maintenance_activity a
  where a.tenant_id=t and a.property_id=p and a.request_id=r.id;
  return jsonb_build_object(
    'success',true,
    'id',r.id,'caseNumber',r.case_number,'createdAt',r.created_at,'updatedAt',r.updated_at,
    'priority',r.priority,'status',r.status,'category',r.category,'sourceChannel',r.source_channel,
    'summary',r.summary,
    'reportedName',r.intake_details->>'reportedName',
    'reportedAddress',r.intake_details->>'reportedAddress',
    'reportedUnit',r.intake_details->>'reportedUnit',
    'descriptionVerbatim',r.intake_details->>'descriptionVerbatim',
    'language',coalesce(r.intake_details->>'language','en'),
    'isEmergency',(r.priority='emergency'),
    'contactMethod',pref->>'method','contactDestinationMasked',dest,
    'tenantUpdate',r.tenant_update,'internalNotes',r.internal_notes,
    'completedAt',r.completed_at,'resolutionNote',r.resolution_note,
    'vendorId',va_row.vid,'vendorName',va_row.company_name,
    'scheduledStart',va_row.scheduled_start,'scheduledEnd',va_row.scheduled_end,
    'workOrderRef',va_row.work_order_ref,
    'timeline',timeline
  );
end $$;
revoke all on function public.pma_mgr_case_get_v1(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.pma_mgr_case_get_v1(uuid,uuid,uuid) to service_role;

create or replace function public.pma_mgr_case_update_v1(
  t uuid, p uuid, request_id uuid, actor_user_id uuid, patch jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.pma_maintenance_requests; allowed_keys text[] := array['status','priority','tenant_update','internal_notes','completed_at','resolution_note'];
  k text; new_status text; new_priority text; new_tenant_update text; new_internal_notes text; new_completed_at timestamptz; new_resolution_note text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  if jsonb_typeof(patch) is distinct from 'object' then raise exception 'Invalid patch' using errcode='22023'; end if;
  for k in select jsonb_object_keys(patch) loop
    if not (k=any(allowed_keys)) then raise exception 'Unknown key: %',k using errcode='22023'; end if;
  end loop;
  select * into r from public.pma_maintenance_requests x
    where x.id=pma_mgr_case_update_v1.request_id and x.tenant_id=t and x.property_id=p for update;
  if not found then return jsonb_build_object('success',false,'state','NOT_FOUND'); end if;
  new_status := coalesce(patch->>'status', r.status);
  new_priority := coalesce(patch->>'priority', r.priority);
  new_tenant_update := case when patch ? 'tenant_update' then patch->>'tenant_update' else r.tenant_update end;
  new_internal_notes := case when patch ? 'internal_notes' then patch->>'internal_notes' else r.internal_notes end;
  new_completed_at := case when patch ? 'completed_at' then coalesce((patch->>'completed_at')::timestamptz, now()) else r.completed_at end;
  if new_status='Completed' and new_completed_at is null then new_completed_at := now(); end if;
  new_resolution_note := case when patch ? 'resolution_note' then patch->>'resolution_note' else r.resolution_note end;
  update public.pma_maintenance_requests set
    status=new_status, priority=new_priority, tenant_update=new_tenant_update,
    internal_notes=new_internal_notes, completed_at=new_completed_at,
    resolution_note=new_resolution_note, updated_at=now()
  where id=r.id;
  if new_status='Closed' and r.status<>'Closed' then
    update public.pma_portal_tokens set expires_at=now()+interval '30 days'
    where pma_portal_tokens.tenant_id=t and pma_portal_tokens.property_id=p
      and pma_portal_tokens.request_id=r.id and pma_portal_tokens.revoked_at is null;
  end if;
  insert into public.pma_maintenance_activity(tenant_id,property_id,request_id,event_type,body,actor_user_id)
  values(t,p,r.id,'case_updated','Status: '||new_status||', Priority: '||new_priority,actor_user_id);
  return jsonb_build_object('success',true,'status',new_status,'priority',new_priority);
end $$;
revoke all on function public.pma_mgr_case_update_v1(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.pma_mgr_case_update_v1(uuid,uuid,uuid,uuid,jsonb) to service_role;

create or replace function public.pma_mgr_assignment_set_v1(
  t uuid, p uuid, request_id uuid, actor_user_id uuid, vendor_id uuid,
  scheduled_start timestamptz default null, scheduled_end timestamptz default null, work_order_ref text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.pma_maintenance_requests; new_status text; vendor_name text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  if pma_mgr_assignment_set_v1.scheduled_end is not null and pma_mgr_assignment_set_v1.scheduled_start is not null
     and pma_mgr_assignment_set_v1.scheduled_end <= pma_mgr_assignment_set_v1.scheduled_start then
    raise exception 'scheduled_end must be after scheduled_start' using errcode='22023';
  end if;
  select * into r from public.pma_maintenance_requests x
    where x.id=pma_mgr_assignment_set_v1.request_id and x.tenant_id=t and x.property_id=p for update;
  if not found then return jsonb_build_object('success',false,'state','NOT_FOUND'); end if;
  if not exists(select 1 from public.pma_vendors x where x.id=vendor_id and x.tenant_id=t) then
    return jsonb_build_object('success',false,'state','VENDOR_NOT_FOUND');
  end if;
  update public.pma_vendor_assignments set status='cancelled', updated_at=now()
  where pma_vendor_assignments.tenant_id=t and pma_vendor_assignments.property_id=p
    and pma_vendor_assignments.request_id=r.id and status in ('assigned','accepted');
  insert into public.pma_vendor_assignments(tenant_id,property_id,request_id,vendor_id,status,scheduled_start,scheduled_end,work_order_ref)
  values(t,p,r.id,vendor_id,'assigned',scheduled_start,scheduled_end,work_order_ref);
  new_status := case
    when r.status='New' and pma_mgr_assignment_set_v1.scheduled_start is not null then 'Scheduled'
    when r.status='New' then 'Assigned'
    else r.status
  end;
  if new_status<>r.status then
    update public.pma_maintenance_requests set status=new_status, updated_at=now() where id=r.id;
  end if;
  select c.company_name into vendor_name
  from public.pma_vendors v join public.ai4cc_contacts c on c.id=v.contact_id and c.tenant_id=t
  where v.id=vendor_id and v.tenant_id=t;
  insert into public.pma_maintenance_activity(tenant_id,property_id,request_id,event_type,body,actor_user_id)
  values(t,p,r.id,'vendor_assigned','Assigned to: '||coalesce(vendor_name,'vendor'),actor_user_id);
  return jsonb_build_object('success',true,'status',new_status,'scheduledStart',scheduled_start,'scheduledEnd',scheduled_end);
end $$;
revoke all on function public.pma_mgr_assignment_set_v1(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.pma_mgr_assignment_set_v1(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text) to service_role;

create or replace function public.pma_mgr_vendor_list_v1(t uuid, p uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  return (
    select jsonb_build_object('success',true,'vendors',coalesce(jsonb_agg(
      jsonb_build_object('id',v.id,'name',c.company_name,'trade',v.trade,'phone',c.phone,'status',v.status)
      order by c.company_name
    ),'[]'::jsonb))
    from public.pma_property_vendors pv
    join public.pma_vendors v on v.id=pv.vendor_id and v.tenant_id=t
    join public.ai4cc_contacts c on c.id=v.contact_id and c.tenant_id=t
    where pv.tenant_id=t and pv.property_id=p and v.status='active'
  );
end $$;
revoke all on function public.pma_mgr_vendor_list_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pma_mgr_vendor_list_v1(uuid,uuid) to service_role;

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

commit;

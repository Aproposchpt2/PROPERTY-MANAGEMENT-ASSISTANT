begin;
drop function if exists public.pma_mgr_vendor_upsert_v1(uuid,uuid,uuid,text,text,text,text);
drop function if exists public.pma_mgr_vendor_list_v1(uuid,uuid);
drop function if exists public.pma_mgr_assignment_set_v1(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text);
drop function if exists public.pma_mgr_case_update_v1(uuid,uuid,uuid,uuid,jsonb);
drop function if exists public.pma_mgr_case_get_v1(uuid,uuid,uuid);
drop function if exists public.pma_mgr_case_list_v1(uuid,uuid,text[]);
commit;

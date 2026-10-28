-- Rollback for 20261029100000_pma_vendor_rpcs
begin;
DROP FUNCTION IF EXISTS public.pma_approval_insert_v1(uuid,uuid,uuid,uuid,numeric,text);
DROP FUNCTION IF EXISTS public.pma_vendor_request_nte_v1(uuid,uuid,uuid,text,numeric,text);
DROP FUNCTION IF EXISTS public.pma_vendor_post_status_v1(uuid,uuid,uuid,text,text,text);
DROP FUNCTION IF EXISTS public.pma_vendor_propose_window_v1(uuid,uuid,uuid,text,timestamptz,timestamptz);
DROP FUNCTION IF EXISTS public.pma_vendor_decline_v1(uuid,uuid,uuid,text,text);
DROP FUNCTION IF EXISTS public.pma_vendor_accept_v1(uuid,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.pma_vendor_work_orders_v1(uuid,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.pma_vendor_lookup_v1(uuid,uuid,text);
commit;

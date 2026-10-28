-- Rollback for 20261029110000_pma_approval_rpcs
begin;
DROP FUNCTION IF EXISTS public.pma_mgr_case_list_v1(uuid,uuid,uuid,text[]);
DROP FUNCTION IF EXISTS public.pma_mgr_case_get_v1(uuid,uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.pma_mgr_approve_case_v1(uuid,uuid,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.pma_preauth_rule_upsert_v1(uuid,uuid,uuid,uuid,uuid,text,numeric,boolean,boolean);
DROP FUNCTION IF EXISTS public.pma_preauth_rules_list_v1(uuid,uuid);
DROP FUNCTION IF EXISTS public.pma_approval_load_v1(text);
DROP FUNCTION IF EXISTS public.pma_approval_respond_v1(text,text,text);
commit;

-- Rollback for 20261029090000_pma_vendor_authorization
begin;
DROP TABLE IF EXISTS public.pma_approval_requests;
DROP TABLE IF EXISTS public.pma_preauth_rules;
DROP INDEX IF EXISTS public.pma_vendors_tenant_phone_uidx;
ALTER TABLE public.pma_vendor_assignments
  DROP COLUMN IF EXISTS response_state,
  DROP COLUMN IF EXISTS proposed_start,
  DROP COLUMN IF EXISTS proposed_end,
  DROP COLUMN IF EXISTS window_state,
  DROP COLUMN IF EXISTS quoted_amount,
  DROP COLUMN IF EXISTS responded_at;
ALTER TABLE public.pma_vendors DROP COLUMN IF EXISTS phone;
ALTER TABLE public.tenant_users DROP COLUMN IF EXISTS notification_phone;
ALTER TABLE public.pma_maintenance_requests
  DROP COLUMN IF EXISTS nte_amount,
  DROP COLUMN IF EXISTS approval_state,
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS approval_channel;
commit;

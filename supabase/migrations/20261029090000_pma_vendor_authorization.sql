-- DIRECTIVE 3 — schema: vendor authorization, approval flow, preauth rules
begin;

-- pma_maintenance_requests: NTE + approval fields
ALTER TABLE public.pma_maintenance_requests
  ADD COLUMN IF NOT EXISTS nte_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS approval_state text NOT NULL DEFAULT 'NOT_REQUIRED'
    CHECK (approval_state IN ('NOT_REQUIRED','PENDING','APPROVED','DECLINED')),
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.tenant_users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_channel text
    CHECK (approval_channel IN ('sms','dashboard','auto_rule'));

-- tenant_users: optional notification phone for approval SMS
ALTER TABLE public.tenant_users
  ADD COLUMN IF NOT EXISTS notification_phone text;

-- pma_vendors: denormalized phone for fast caller_id lookup (unique per tenant)
ALTER TABLE public.pma_vendors
  ADD COLUMN IF NOT EXISTS phone text;
CREATE UNIQUE INDEX IF NOT EXISTS pma_vendors_tenant_phone_uidx
  ON public.pma_vendors(tenant_id, phone)
  WHERE phone IS NOT NULL;

-- pma_vendor_assignments: response + window + quoted amount
ALTER TABLE public.pma_vendor_assignments
  ADD COLUMN IF NOT EXISTS response_state text NOT NULL DEFAULT 'OFFERED'
    CHECK (response_state IN ('OFFERED','ACCEPTED','DECLINED')),
  ADD COLUMN IF NOT EXISTS proposed_start timestamptz,
  ADD COLUMN IF NOT EXISTS proposed_end timestamptz,
  ADD COLUMN IF NOT EXISTS window_state text NOT NULL DEFAULT 'NONE'
    CHECK (window_state IN ('NONE','PROPOSED','CONFIRMED')),
  ADD COLUMN IF NOT EXISTS quoted_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS responded_at timestamptz;

-- pma_preauth_rules: amount-based auto-approval rules (null property/category = wildcard)
CREATE TABLE IF NOT EXISTS public.pma_preauth_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  property_id uuid REFERENCES public.pma_properties(id),
  category text,
  max_amount numeric(10,2) NOT NULL,
  allow_emergency boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.tenant_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pma_preauth_rules ENABLE ROW LEVEL SECURITY;

-- pma_approval_requests: one row per approver per NTE request
CREATE TABLE IF NOT EXISTS public.pma_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  property_id uuid NOT NULL REFERENCES public.pma_properties(id),
  request_id uuid NOT NULL REFERENCES public.pma_maintenance_requests(id),
  approver_user_id uuid NOT NULL REFERENCES public.tenant_users(id),
  amount numeric(10,2) NOT NULL,
  short_code text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'OPEN'
    CHECK (state IN ('OPEN','APPROVED','DECLINED','EXPIRED')),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pma_approval_requests ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS pma_approval_token_uidx
  ON public.pma_approval_requests(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS pma_approval_shortcode_open_uidx
  ON public.pma_approval_requests(short_code)
  WHERE state = 'OPEN';

commit;

-- DIRECTIVE 3 — approval RPCs + manager extensions
begin;

-- Respond to an approval request by short_code (SMS) or token_hash (web).
-- Single-use: marks state APPROVED/DECLINED, marks other open rows for the same request EXPIRED.
CREATE OR REPLACE FUNCTION public.pma_approval_respond_v1(
  response text,
  short_code text DEFAULT NULL,
  token_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ar public.pma_approval_requests;
  v_vendor_phone text; v_case_number text; v_unit text;
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode='42501';
  END IF;
  IF pma_approval_respond_v1.response NOT IN ('APPROVED','DECLINED') THEN
    RAISE EXCEPTION 'response must be APPROVED or DECLINED' USING errcode='22023';
  END IF;
  IF pma_approval_respond_v1.short_code IS NULL AND pma_approval_respond_v1.token_hash IS NULL THEN
    RAISE EXCEPTION 'short_code or token_hash required' USING errcode='22023';
  END IF;
  -- Lock the row
  SELECT * INTO ar FROM public.pma_approval_requests
  WHERE (pma_approval_respond_v1.short_code IS NOT NULL AND short_code=pma_approval_respond_v1.short_code AND state='OPEN')
     OR (pma_approval_respond_v1.token_hash IS NOT NULL AND token_hash=pma_approval_respond_v1.token_hash AND state='OPEN')
  LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'state','NOT_FOUND'); END IF;
  IF ar.expires_at < now() THEN
    UPDATE public.pma_approval_requests SET state='EXPIRED' WHERE id=ar.id;
    RETURN jsonb_build_object('success',false,'state','EXPIRED');
  END IF;
  -- Mark this row
  UPDATE public.pma_approval_requests
    SET state=pma_approval_respond_v1.response, responded_at=now()
    WHERE id=ar.id;
  -- Expire remaining OPEN rows for the same request (one approval is sufficient)
  UPDATE public.pma_approval_requests
    SET state='EXPIRED'
    WHERE request_id=ar.request_id AND state='OPEN' AND id<>ar.id;
  -- Update main request
  UPDATE public.pma_maintenance_requests
    SET approval_state=pma_approval_respond_v1.response,
        approved_at=now(),
        approval_channel='sms',
        approved_by=ar.approver_user_id,
        updated_at=now()
    WHERE id=ar.request_id;
  -- Log activity
  INSERT INTO public.pma_maintenance_activity(tenant_id,property_id,request_id,event_type,body)
    VALUES(ar.tenant_id,ar.property_id,ar.request_id,'nte_approval_response',
      'NTE $'||ar.amount||' '||lower(pma_approval_respond_v1.response)||' by approver.');
  -- If approved, confirm any PROPOSED window
  IF pma_approval_respond_v1.response='APPROVED' THEN
    UPDATE public.pma_vendor_assignments
      SET window_state='CONFIRMED',
          scheduled_start=proposed_start, scheduled_end=proposed_end,
          updated_at=now()
      WHERE request_id=ar.request_id AND window_state='PROPOSED';
    -- Update case status to Scheduled if window just confirmed
    IF FOUND THEN
      UPDATE public.pma_maintenance_requests
        SET status='Scheduled', updated_at=now()
        WHERE id=ar.request_id AND status NOT IN ('Completed','Closed');
    END IF;
  END IF;
  -- Gather case info so Node.js can notify vendor
  SELECT mr.case_number, u.unit_number INTO v_case_number, v_unit
  FROM public.pma_maintenance_requests mr
  LEFT JOIN public.pma_units u ON u.id = mr.unit_id
  WHERE mr.id = ar.request_id;
  SELECT v.phone INTO v_vendor_phone
  FROM public.pma_vendor_assignments va
  JOIN public.pma_vendors v ON v.id = va.vendor_id
  WHERE va.request_id = ar.request_id AND va.response_state <> 'DECLINED'
  LIMIT 1;
  RETURN jsonb_build_object(
    'success',true,'response',pma_approval_respond_v1.response,
    'caseNumber',v_case_number,'amount',ar.amount,
    'vendorPhone',v_vendor_phone
  );
END $$;
REVOKE ALL ON FUNCTION public.pma_approval_respond_v1(text,text,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pma_approval_respond_v1(text,text,text) TO service_role;

-- Load an approval request by token_hash for the web approve page.
-- Returns non-sensitive display info only (no phone, no internal_notes).
CREATE OR REPLACE FUNCTION public.pma_approval_load_v1(token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ar public.pma_approval_requests; v_case text; v_summary text; v_unit text; v_prop text;
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode='42501';
  END IF;
  SELECT * INTO ar FROM public.pma_approval_requests
  WHERE pma_approval_load_v1.token_hash = public.pma_approval_requests.token_hash AND state='OPEN' LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'state','NOT_FOUND'); END IF;
  IF ar.expires_at < now() THEN
    UPDATE public.pma_approval_requests SET state='EXPIRED' WHERE id=ar.id;
    RETURN jsonb_build_object('success',false,'state','EXPIRED');
  END IF;
  SELECT mr.case_number, mr.summary, u.unit_number, pr.name
  INTO v_case, v_summary, v_unit, v_prop
  FROM public.pma_maintenance_requests mr
  JOIN public.pma_properties pr ON pr.id = mr.property_id
  LEFT JOIN public.pma_units u ON u.id = mr.unit_id
  WHERE mr.id = ar.request_id;
  RETURN jsonb_build_object(
    'success',true,'caseNumber',v_case,'summary',v_summary,
    'unit',v_unit,'property',v_prop,'amount',ar.amount,
    'expiresAt',ar.expires_at
  );
END $$;
REVOKE ALL ON FUNCTION public.pma_approval_load_v1(text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pma_approval_load_v1(text) TO service_role;

-- List preauth rules for a property (OWNER/ADMIN only, enforced in Node.js).
CREATE OR REPLACE FUNCTION public.pma_preauth_rules_list_v1(t uuid, p uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode='42501';
  END IF;
  RETURN (
    SELECT jsonb_build_object('success',true,'rules',coalesce(jsonb_agg(
      jsonb_build_object('id',r.id,'propertyId',r.property_id,'category',r.category,
        'maxAmount',r.max_amount,'allowEmergency',r.allow_emergency,'active',r.active)
      ORDER BY r.created_at
    ),'[]'::jsonb))
    FROM public.pma_preauth_rules r
    WHERE r.tenant_id=t AND (r.property_id IS NULL OR r.property_id=p) AND r.active=true
  );
END $$;
REVOKE ALL ON FUNCTION public.pma_preauth_rules_list_v1(uuid,uuid) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pma_preauth_rules_list_v1(uuid,uuid) TO service_role;

-- Upsert a preauth rule (insert or update by id).
CREATE OR REPLACE FUNCTION public.pma_preauth_rule_upsert_v1(
  t uuid, p uuid, actor_user_id uuid,
  rule_id uuid DEFAULT NULL,
  rule_property_id uuid DEFAULT NULL,
  category text DEFAULT NULL,
  max_amount numeric DEFAULT NULL,
  allow_emergency boolean DEFAULT false,
  active boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE new_id uuid;
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode='42501';
  END IF;
  IF max_amount IS NULL OR max_amount <= 0 THEN
    RAISE EXCEPTION 'max_amount must be positive' USING errcode='22023';
  END IF;
  IF pma_preauth_rule_upsert_v1.rule_id IS NOT NULL THEN
    UPDATE public.pma_preauth_rules
      SET property_id=pma_preauth_rule_upsert_v1.rule_property_id,
          category=pma_preauth_rule_upsert_v1.category,
          max_amount=pma_preauth_rule_upsert_v1.max_amount,
          allow_emergency=pma_preauth_rule_upsert_v1.allow_emergency,
          active=pma_preauth_rule_upsert_v1.active,
          updated_at=now()
      WHERE id=pma_preauth_rule_upsert_v1.rule_id AND tenant_id=t
      RETURNING id INTO new_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'state','NOT_FOUND'); END IF;
  ELSE
    INSERT INTO public.pma_preauth_rules(tenant_id,property_id,category,max_amount,allow_emergency,active,created_by)
      VALUES(t,pma_preauth_rule_upsert_v1.rule_property_id,
             pma_preauth_rule_upsert_v1.category,
             pma_preauth_rule_upsert_v1.max_amount,
             pma_preauth_rule_upsert_v1.allow_emergency,
             pma_preauth_rule_upsert_v1.active,
             pma_preauth_rule_upsert_v1.actor_user_id)
      RETURNING id INTO new_id;
  END IF;
  RETURN jsonb_build_object('success',true,'ruleId',new_id);
END $$;
REVOKE ALL ON FUNCTION public.pma_preauth_rule_upsert_v1(uuid,uuid,uuid,uuid,uuid,text,numeric,boolean,boolean) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pma_preauth_rule_upsert_v1(uuid,uuid,uuid,uuid,uuid,text,numeric,boolean,boolean) TO service_role;

-- Manager dashboard: approve or decline from dashboard (approval_channel='dashboard').
CREATE OR REPLACE FUNCTION public.pma_mgr_approve_case_v1(
  t uuid, p uuid, actor_user_id uuid, request_id uuid, response text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request public.pma_maintenance_requests;
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode='42501';
  END IF;
  IF pma_mgr_approve_case_v1.response NOT IN ('APPROVED','DECLINED') THEN
    RAISE EXCEPTION 'response must be APPROVED or DECLINED' USING errcode='22023';
  END IF;
  SELECT * INTO v_request FROM public.pma_maintenance_requests
  WHERE id=pma_mgr_approve_case_v1.request_id AND tenant_id=t AND property_id=p;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'state','NOT_FOUND'); END IF;
  UPDATE public.pma_maintenance_requests
    SET approval_state=pma_mgr_approve_case_v1.response,
        approved_by=pma_mgr_approve_case_v1.actor_user_id,
        approved_at=now(),
        approval_channel='dashboard',
        updated_at=now()
    WHERE id=pma_mgr_approve_case_v1.request_id;
  -- Expire any open approval requests
  UPDATE public.pma_approval_requests SET state='EXPIRED'
    WHERE request_id=pma_mgr_approve_case_v1.request_id AND state='OPEN';
  -- If approved, confirm any proposed window
  IF pma_mgr_approve_case_v1.response='APPROVED' THEN
    UPDATE public.pma_vendor_assignments
      SET window_state='CONFIRMED', scheduled_start=proposed_start, scheduled_end=proposed_end, updated_at=now()
      WHERE request_id=pma_mgr_approve_case_v1.request_id AND window_state='PROPOSED';
    IF FOUND THEN
      UPDATE public.pma_maintenance_requests
        SET status='Scheduled', updated_at=now()
        WHERE id=pma_mgr_approve_case_v1.request_id AND status NOT IN ('Completed','Closed');
    END IF;
  END IF;
  INSERT INTO public.pma_maintenance_activity(tenant_id,property_id,request_id,event_type,body)
    VALUES(t,p,pma_mgr_approve_case_v1.request_id,'mgr_approval_response',
      'NTE '||lower(pma_mgr_approve_case_v1.response)||' by manager (dashboard).');
  RETURN jsonb_build_object('success',true,'response',response);
END $$;
REVOKE ALL ON FUNCTION public.pma_mgr_approve_case_v1(uuid,uuid,uuid,uuid,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pma_mgr_approve_case_v1(uuid,uuid,uuid,uuid,text) TO service_role;

-- Extend pma_mgr_case_get_v1 to include NTE + approval fields.
CREATE OR REPLACE FUNCTION public.pma_mgr_case_get_v1(t uuid, p uuid, actor_user_id uuid, request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE mr public.pma_maintenance_requests; contact_dest text; contact_type text;
  v_vendor jsonb; v_unit text; v_assign jsonb;
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode='42501';
  END IF;
  SELECT * INTO mr FROM public.pma_maintenance_requests
  WHERE id=pma_mgr_case_get_v1.request_id AND tenant_id=t AND property_id=p;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'state','NOT_FOUND'); END IF;
  -- Masked contact
  SELECT c.phone, c.email INTO contact_dest, contact_type
  FROM public.ai4cc_contacts c
  WHERE c.id=mr.contact_id AND c.tenant_id=t LIMIT 1;
  IF contact_dest IS NOT NULL THEN
    contact_dest := CASE WHEN contact_dest ~ '^\+?[0-9]' THEN '••••'||right(contact_dest,4) ELSE contact_dest END;
    contact_type := 'phone';
  END IF;
  -- Unit
  SELECT u.unit_number INTO v_unit FROM public.pma_units u WHERE u.id=mr.unit_id LIMIT 1;
  -- Vendor assignment
  SELECT jsonb_build_object(
    'id',va.id,'vendorId',va.vendor_id,'companyName',c.company_name,
    'trade',v.trade,'responseState',va.response_state,'windowState',va.window_state,
    'scheduledStart',va.scheduled_start,'scheduledEnd',va.scheduled_end,
    'proposedStart',va.proposed_start,'proposedEnd',va.proposed_end,
    'quotedAmount',va.quoted_amount,'workOrderRef',va.work_order_ref
  ) INTO v_assign
  FROM public.pma_vendor_assignments va
  JOIN public.pma_vendors v ON v.id=va.vendor_id
  JOIN public.ai4cc_contacts c ON c.id=v.contact_id AND c.tenant_id=t
  WHERE va.request_id=mr.id AND va.response_state<>'DECLINED'
  ORDER BY va.created_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'success',true,
    'id',mr.id,'caseNumber',mr.case_number,'status',mr.status,
    'priority',mr.priority,'category',mr.category,'summary',mr.summary,
    'description',mr.description,'createdAt',mr.created_at,'unit',v_unit,
    'contactDest',contact_dest,'contactType',contact_type,
    'internalNotes',mr.internal_notes,'tenantUpdate',mr.tenant_update,
    'completedAt',mr.completed_at,'resolutionNote',mr.resolution_note,
    'nteAmount',mr.nte_amount,'approvalState',mr.approval_state,
    'approvedAt',mr.approved_at,'approvalChannel',mr.approval_channel,
    'vendor',v_assign,
    'language',(mr.intake_details->>'language')
  );
END $$;
REVOKE ALL ON FUNCTION public.pma_mgr_case_get_v1(uuid,uuid,uuid,uuid) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pma_mgr_case_get_v1(uuid,uuid,uuid,uuid) TO service_role;

-- Extend pma_mgr_case_list_v1 to surface nte_amount and approval_state.
CREATE OR REPLACE FUNCTION public.pma_mgr_case_list_v1(
  t uuid, p uuid, actor_user_id uuid, status_filter text[] DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode='42501';
  END IF;
  RETURN (
    SELECT jsonb_build_object('success',true,'cases',coalesce(jsonb_agg(
      jsonb_build_object(
        'id',mr.id,'caseNumber',mr.case_number,'status',mr.status,
        'priority',mr.priority,'category',mr.category,'summary',mr.summary,
        'createdAt',mr.created_at,'unit',u.unit_number,
        'isEmergency',(mr.priority='emergency'),
        'language',(mr.intake_details->>'language'),
        'nteAmount',mr.nte_amount,'approvalState',mr.approval_state,
        'vendorAssigned',(EXISTS(
          SELECT 1 FROM public.pma_vendor_assignments va
          WHERE va.request_id=mr.id AND va.response_state<>'DECLINED'))
      ) ORDER BY
        CASE mr.priority WHEN 'emergency' THEN 0 ELSE 1 END ASC,
        CASE WHEN mr.priority<>'emergency' AND NOT EXISTS(
          SELECT 1 FROM public.pma_vendor_assignments va2
          WHERE va2.request_id=mr.id AND va2.scheduled_start IS NOT NULL)
          THEN extract(epoch from mr.created_at)::bigint
          ELSE NULL END ASC NULLS LAST,
        CASE WHEN mr.priority<>'emergency' AND EXISTS(
          SELECT 1 FROM public.pma_vendor_assignments va3
          WHERE va3.request_id=mr.id AND va3.scheduled_start IS NOT NULL)
          THEN extract(epoch from mr.created_at)::bigint
          ELSE NULL END DESC NULLS LAST
    ),'[]'::jsonb))
    FROM public.pma_maintenance_requests mr
    LEFT JOIN public.pma_units u ON u.id=mr.unit_id
    WHERE mr.tenant_id=t AND mr.property_id=p
      AND (status_filter IS NULL OR mr.status=ANY(status_filter))
  );
END $$;
REVOKE ALL ON FUNCTION public.pma_mgr_case_list_v1(uuid,uuid,uuid,text[]) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pma_mgr_case_list_v1(uuid,uuid,uuid,text[]) TO service_role;

commit;

-- DIRECTIVE 3 — vendor-facing RPCs for Avery's tool endpoint
begin;

-- Lookup vendor by phone (system__caller_id). Returns UNKNOWN_VENDOR if not found.
CREATE OR REPLACE FUNCTION public.pma_vendor_lookup_v1(t uuid, p uuid, caller_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_trade text; v_name text;
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode='42501';
  END IF;
  SELECT v.id, v.trade, c.company_name
  INTO v_id, v_trade, v_name
  FROM public.pma_vendors v
  JOIN public.ai4cc_contacts c ON c.id = v.contact_id AND c.tenant_id = t
  WHERE v.tenant_id = t AND v.phone = pma_vendor_lookup_v1.caller_phone AND v.status = 'active'
  LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'state','UNKNOWN_VENDOR'); END IF;
  RETURN jsonb_build_object('success',true,'vendorId',v_id,'trade',v_trade,'companyName',v_name);
END $$;
REVOKE ALL ON FUNCTION public.pma_vendor_lookup_v1(uuid,uuid,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pma_vendor_lookup_v1(uuid,uuid,text) TO service_role;

-- Get vendor's open work orders (or a specific case).
-- Never returns tenant phone/email or internal_notes.
CREATE OR REPLACE FUNCTION public.pma_vendor_work_orders_v1(
  t uuid, p uuid, vendor_id uuid, case_number text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rows jsonb;
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode='42501';
  END IF;
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'assignmentId', va.id,
      'caseNumber', mr.case_number,
      'summary', mr.summary,
      'category', mr.category,
      'priority', mr.priority,
      'status', mr.status,
      'unit', u.unit_number,
      'propertyAddress', pr.address,
      'propertyTimezone', pr.timezone,
      'nteAmount', mr.nte_amount,
      'approvalState', mr.approval_state,
      'responseState', va.response_state,
      'windowState', va.window_state,
      'scheduledStart', va.scheduled_start,
      'scheduledEnd', va.scheduled_end,
      'proposedStart', va.proposed_start,
      'proposedEnd', va.proposed_end,
      'quotedAmount', va.quoted_amount
    ) ORDER BY mr.created_at DESC
  ),'[]'::jsonb)
  INTO rows
  FROM public.pma_vendor_assignments va
  JOIN public.pma_maintenance_requests mr ON mr.id = va.request_id
  JOIN public.pma_properties pr ON pr.id = mr.property_id
  LEFT JOIN public.pma_units u ON u.id = mr.unit_id
  WHERE va.vendor_id = pma_vendor_work_orders_v1.vendor_id
    AND va.tenant_id = t AND va.property_id = p
    AND va.response_state <> 'DECLINED'
    AND mr.status NOT IN ('Closed','Completed')
    AND (pma_vendor_work_orders_v1.case_number IS NULL OR mr.case_number = pma_vendor_work_orders_v1.case_number);
  RETURN jsonb_build_object('success',true,'workOrders',rows);
END $$;
REVOKE ALL ON FUNCTION public.pma_vendor_work_orders_v1(uuid,uuid,uuid,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pma_vendor_work_orders_v1(uuid,uuid,uuid,text) TO service_role;

-- Accept a job assignment
CREATE OR REPLACE FUNCTION public.pma_vendor_accept_v1(
  t uuid, p uuid, vendor_id uuid, case_number text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_assign_id uuid; v_request_id uuid;
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode='42501';
  END IF;
  SELECT va.id, va.request_id INTO v_assign_id, v_request_id
  FROM public.pma_vendor_assignments va
  JOIN public.pma_maintenance_requests mr ON mr.id = va.request_id
  WHERE va.vendor_id = pma_vendor_accept_v1.vendor_id AND va.tenant_id = t AND va.property_id = p
    AND mr.case_number = pma_vendor_accept_v1.case_number AND va.response_state = 'OFFERED'
  LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'state','NOT_FOUND'); END IF;
  UPDATE public.pma_vendor_assignments
    SET response_state='ACCEPTED', responded_at=now(), updated_at=now()
    WHERE id = v_assign_id;
  INSERT INTO public.pma_maintenance_activity(tenant_id,property_id,request_id,event_type,body)
    VALUES(t,p,v_request_id,'vendor_accepted','Vendor accepted the job.');
  RETURN jsonb_build_object('success',true,'caseNumber',case_number);
END $$;
REVOKE ALL ON FUNCTION public.pma_vendor_accept_v1(uuid,uuid,uuid,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pma_vendor_accept_v1(uuid,uuid,uuid,text) TO service_role;

-- Decline a job assignment; logs reason for manager.
CREATE OR REPLACE FUNCTION public.pma_vendor_decline_v1(
  t uuid, p uuid, vendor_id uuid, case_number text, reason text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_assign_id uuid; v_request_id uuid;
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode='42501';
  END IF;
  SELECT va.id, va.request_id INTO v_assign_id, v_request_id
  FROM public.pma_vendor_assignments va
  JOIN public.pma_maintenance_requests mr ON mr.id = va.request_id
  WHERE va.vendor_id = pma_vendor_decline_v1.vendor_id AND va.tenant_id = t AND va.property_id = p
    AND mr.case_number = pma_vendor_decline_v1.case_number AND va.response_state IN ('OFFERED','ACCEPTED')
  LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'state','NOT_FOUND'); END IF;
  UPDATE public.pma_vendor_assignments
    SET response_state='DECLINED', responded_at=now(), updated_at=now()
    WHERE id = v_assign_id;
  INSERT INTO public.pma_maintenance_activity(tenant_id,property_id,request_id,event_type,body)
    VALUES(t,p,v_request_id,'vendor_declined',
      CASE WHEN length(btrim(coalesce(reason,'')))>0 THEN 'Vendor declined. Reason: '||btrim(reason) ELSE 'Vendor declined.' END);
  RETURN jsonb_build_object('success',true,'caseNumber',case_number,'notifyManager',true);
END $$;
REVOKE ALL ON FUNCTION public.pma_vendor_decline_v1(uuid,uuid,uuid,text,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pma_vendor_decline_v1(uuid,uuid,uuid,text,text) TO service_role;

-- Propose a service window. Auto-confirms if approval is APPROVED or NOT_REQUIRED.
-- Returns confirmed=true + tenant contact info when auto-confirming so Node.js can SMS the tenant.
CREATE OR REPLACE FUNCTION public.pma_vendor_propose_window_v1(
  t uuid, p uuid, vendor_id uuid, case_number text,
  proposed_start timestamptz, proposed_end timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_assign_id uuid; v_request_id uuid; v_approval_state text;
  v_tenant_phone text; v_case_number text; v_status text;
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode='42501';
  END IF;
  SELECT va.id, va.request_id, mr.approval_state, mr.status, mr.case_number
  INTO v_assign_id, v_request_id, v_approval_state, v_status, v_case_number
  FROM public.pma_vendor_assignments va
  JOIN public.pma_maintenance_requests mr ON mr.id = va.request_id
  WHERE va.vendor_id = pma_vendor_propose_window_v1.vendor_id
    AND va.tenant_id = t AND va.property_id = p
    AND mr.case_number = pma_vendor_propose_window_v1.case_number
    AND va.response_state <> 'DECLINED'
  LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'state','NOT_FOUND'); END IF;
  -- Store proposed window on assignment
  UPDATE public.pma_vendor_assignments
    SET proposed_start=pma_vendor_propose_window_v1.proposed_start,
        proposed_end=pma_vendor_propose_window_v1.proposed_end,
        window_state=CASE WHEN v_approval_state IN ('APPROVED','NOT_REQUIRED') THEN 'CONFIRMED' ELSE 'PROPOSED' END,
        scheduled_start=CASE WHEN v_approval_state IN ('APPROVED','NOT_REQUIRED') THEN pma_vendor_propose_window_v1.proposed_start ELSE NULL END,
        scheduled_end=CASE WHEN v_approval_state IN ('APPROVED','NOT_REQUIRED') THEN pma_vendor_propose_window_v1.proposed_end ELSE NULL END,
        updated_at=now()
    WHERE id = v_assign_id;
  IF v_approval_state IN ('APPROVED','NOT_REQUIRED') THEN
    -- Auto-confirm: update case
    UPDATE public.pma_maintenance_requests
      SET status='Scheduled',
          updated_at=now()
      WHERE id = v_request_id AND status NOT IN ('Completed','Closed');
    INSERT INTO public.pma_maintenance_activity(tenant_id,property_id,request_id,event_type,body)
      VALUES(t,p,v_request_id,'window_confirmed','Service window confirmed by vendor.');
    -- Get tenant contact phone for SMS
    SELECT c.phone INTO v_tenant_phone
    FROM public.pma_occupancies occ
    JOIN public.ai4cc_contacts c ON c.id = occ.contact_id AND c.tenant_id = t
    WHERE occ.property_id = p AND occ.status = 'active'
    LIMIT 1;
    RETURN jsonb_build_object(
      'success',true,'confirmed',true,'caseNumber',v_case_number,
      'tenantPhone',v_tenant_phone,
      'scheduledStart',pma_vendor_propose_window_v1.proposed_start,
      'scheduledEnd',pma_vendor_propose_window_v1.proposed_end
    );
  ELSE
    INSERT INTO public.pma_maintenance_activity(tenant_id,property_id,request_id,event_type,body)
      VALUES(t,p,v_request_id,'window_proposed','Vendor proposed service window (pending approval).');
    RETURN jsonb_build_object('success',true,'confirmed',false,'caseNumber',v_case_number);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.pma_vendor_propose_window_v1(uuid,uuid,uuid,text,timestamptz,timestamptz) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pma_vendor_propose_window_v1(uuid,uuid,uuid,text,timestamptz,timestamptz) TO service_role;

-- Post a status update (In Progress / Completed). Note goes to activity log only.
CREATE OR REPLACE FUNCTION public.pma_vendor_post_status_v1(
  t uuid, p uuid, vendor_id uuid, case_number text, new_status text, note text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request_id uuid; v_body text;
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode='42501';
  END IF;
  IF pma_vendor_post_status_v1.new_status NOT IN ('In Progress','Completed') THEN
    RAISE EXCEPTION 'Status must be In Progress or Completed' USING errcode='22023';
  END IF;
  SELECT mr.id INTO v_request_id
  FROM public.pma_vendor_assignments va
  JOIN public.pma_maintenance_requests mr ON mr.id = va.request_id
  WHERE va.vendor_id = pma_vendor_post_status_v1.vendor_id AND va.tenant_id = t AND va.property_id = p
    AND mr.case_number = pma_vendor_post_status_v1.case_number AND va.response_state = 'ACCEPTED'
  LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'state','NOT_FOUND'); END IF;
  UPDATE public.pma_maintenance_requests
    SET status = pma_vendor_post_status_v1.new_status,
        completed_at = CASE WHEN pma_vendor_post_status_v1.new_status='Completed' THEN now() ELSE NULL END,
        updated_at = now()
    WHERE id = v_request_id;
  v_body := 'Vendor update: '||pma_vendor_post_status_v1.new_status||
    CASE WHEN length(btrim(coalesce(note,'')))>0 THEN '. '||btrim(note) ELSE '' END;
  INSERT INTO public.pma_maintenance_activity(tenant_id,property_id,request_id,event_type,body)
    VALUES(t,p,v_request_id,'vendor_status_update',v_body);
  RETURN jsonb_build_object('success',true,'caseNumber',case_number,'status',new_status);
END $$;
REVOKE ALL ON FUNCTION public.pma_vendor_post_status_v1(uuid,uuid,uuid,text,text,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pma_vendor_post_status_v1(uuid,uuid,uuid,text,text,text) TO service_role;

-- Request NTE approval. Checks preauth rules; returns auto-approved or list of approvers.
-- Node.js calls pma_approval_insert_v1 for each approver after generating tokens.
CREATE OR REPLACE FUNCTION public.pma_vendor_request_nte_v1(
  t uuid, p uuid, vendor_id uuid, case_number text, amount numeric, reason text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_request_id uuid; v_priority text; v_category text;
  v_preauth_id uuid; approvers jsonb;
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode='42501';
  END IF;
  IF amount IS NULL OR amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive' USING errcode='22023';
  END IF;
  SELECT mr.id, mr.priority, mr.category INTO v_request_id, v_priority, v_category
  FROM public.pma_vendor_assignments va
  JOIN public.pma_maintenance_requests mr ON mr.id = va.request_id
  WHERE va.vendor_id = pma_vendor_request_nte_v1.vendor_id AND va.tenant_id = t AND va.property_id = p
    AND mr.case_number = pma_vendor_request_nte_v1.case_number AND va.response_state <> 'DECLINED'
  LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'state','NOT_FOUND'); END IF;
  -- Store quoted amount
  UPDATE public.pma_vendor_assignments SET quoted_amount = amount, updated_at=now()
    WHERE vendor_id = pma_vendor_request_nte_v1.vendor_id AND request_id = v_request_id;
  -- Check preauth rules (most-specific match wins: property+category > property > tenant-wide)
  SELECT id INTO v_preauth_id
  FROM public.pma_preauth_rules
  WHERE tenant_id = t AND active = true
    AND (property_id IS NULL OR property_id = p)
    AND (category IS NULL OR category = v_category)
    AND max_amount >= amount
    AND (allow_emergency = true OR v_priority <> 'emergency')
  ORDER BY (property_id IS NOT NULL)::int DESC, (category IS NOT NULL)::int DESC
  LIMIT 1;
  IF v_preauth_id IS NOT NULL THEN
    UPDATE public.pma_maintenance_requests
      SET nte_amount=amount, approval_state='APPROVED', approval_channel='auto_rule', approved_at=now(), updated_at=now()
      WHERE id = v_request_id;
    INSERT INTO public.pma_maintenance_activity(tenant_id,property_id,request_id,event_type,body)
      VALUES(t,p,v_request_id,'nte_auto_approved','NTE $'||amount||' auto-approved by preauth rule.');
    RETURN jsonb_build_object('success',true,'approved',true,'approvalChannel','auto_rule','amount',amount);
  END IF;
  -- Needs manual approval — set PENDING, gather OWNER/MANAGER list
  UPDATE public.pma_maintenance_requests
    SET nte_amount=amount, approval_state='PENDING', updated_at=now()
    WHERE id = v_request_id;
  INSERT INTO public.pma_maintenance_activity(tenant_id,property_id,request_id,event_type,body)
    VALUES(t,p,v_request_id,'nte_approval_requested','Vendor requested NTE approval: $'||amount||
      CASE WHEN length(btrim(coalesce(reason,'')))>0 THEN '. Reason: '||btrim(reason) ELSE '' END);
  -- Return approvers so Node.js can issue tokens and send SMS
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'tenantUserId', tu.id,
    'email', au.email,
    'phone', tu.notification_phone
  )),'[]'::jsonb)
  INTO approvers
  FROM public.tenant_users tu
  JOIN auth.users au ON au.id = tu.user_id
  LEFT JOIN public.pma_staff_property_access spa ON spa.tenant_user_id = tu.id AND spa.property_id = p
  WHERE tu.tenant_id = t AND tu.status = 'ACTIVE'
    AND (tu.role IN ('OWNER','ADMIN') OR (tu.role='MANAGER' AND spa.property_id IS NOT NULL));
  RETURN jsonb_build_object(
    'success',true,'approved',false,'amount',amount,
    'requestId',v_request_id,'caseNumber',case_number,'approvers',approvers
  );
END $$;
REVOKE ALL ON FUNCTION public.pma_vendor_request_nte_v1(uuid,uuid,uuid,text,numeric,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pma_vendor_request_nte_v1(uuid,uuid,uuid,text,numeric,text) TO service_role;

-- Insert a single approval request row. Returns short_code. Called by Node.js per-approver.
CREATE OR REPLACE FUNCTION public.pma_approval_insert_v1(
  t uuid, p uuid, request_id uuid, approver_user_id uuid, amount numeric, token_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE candidate text; inserted_id uuid;
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode='42501';
  END IF;
  IF length(pma_approval_insert_v1.token_hash) <> 64 THEN
    RAISE EXCEPTION 'token_hash must be 64-char hex' USING errcode='22023';
  END IF;
  LOOP
    candidate := upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
    BEGIN
      INSERT INTO public.pma_approval_requests(
        tenant_id,property_id,request_id,approver_user_id,amount,short_code,token_hash,expires_at
      ) VALUES(t,p,pma_approval_insert_v1.request_id,pma_approval_insert_v1.approver_user_id,
        pma_approval_insert_v1.amount,candidate,pma_approval_insert_v1.token_hash,
        now()+interval'24 hours')
      RETURNING id INTO inserted_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- short_code collision — retry
    END;
  END LOOP;
  RETURN jsonb_build_object('success',true,'approvalId',inserted_id,'shortCode',candidate);
END $$;
REVOKE ALL ON FUNCTION public.pma_approval_insert_v1(uuid,uuid,uuid,uuid,numeric,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pma_approval_insert_v1(uuid,uuid,uuid,uuid,numeric,text) TO service_role;

commit;

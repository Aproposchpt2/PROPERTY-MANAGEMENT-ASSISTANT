-- Accepting a job the vendor already holds reports success instead of NOT_FOUND.
-- Work orders now carry the tenant-reported service address, because pma_properties.address
-- is a placeholder. A vendor removed from a job (assignment status cancelled) no longer sees
-- or accepts it, so job details cannot reach them.
CREATE OR REPLACE FUNCTION public.pma_vendor_accept_v1(t uuid, p uuid, vendor_id uuid, case_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_assign_id uuid; v_request_id uuid; v_state text;
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode='42501';
  END IF;
  SELECT va.id, va.request_id, va.response_state INTO v_assign_id, v_request_id, v_state
  FROM public.pma_vendor_assignments va
  JOIN public.pma_maintenance_requests mr ON mr.id = va.request_id
  WHERE va.vendor_id = pma_vendor_accept_v1.vendor_id AND va.tenant_id = t AND va.property_id = p
    AND mr.case_number = pma_vendor_accept_v1.case_number
    AND va.response_state IN ('OFFERED','ACCEPTED')
    AND va.status IS DISTINCT FROM 'cancelled'
  ORDER BY va.created_at DESC
  LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'state','NOT_FOUND'); END IF;
  IF v_state = 'ACCEPTED' THEN
    RETURN jsonb_build_object('success',true,'alreadyAccepted',true,'caseNumber',pma_vendor_accept_v1.case_number);
  END IF;
  UPDATE public.pma_vendor_assignments SET response_state='ACCEPTED', responded_at=now(), updated_at=now() WHERE id = v_assign_id;
  INSERT INTO public.pma_maintenance_activity(tenant_id,property_id,request_id,event_type,body)
    VALUES(t,p,v_request_id,'vendor_accepted','Vendor accepted the job.');
  RETURN jsonb_build_object('success',true,'caseNumber',pma_vendor_accept_v1.case_number);
END $function$;

CREATE OR REPLACE FUNCTION public.pma_vendor_work_orders_v1(t uuid, p uuid, vendor_id uuid, case_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE rows jsonb;
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode='42501';
  END IF;
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'assignmentId', va.id,'caseNumber', mr.case_number,'summary', mr.summary,
      'category', mr.category,'priority', mr.priority,'status', mr.status,
      'unit', coalesce(u.label, mr.intake_details->>'reportedUnit'),'propertyAddress', pr.address,'propertyTimezone', pr.timezone,
      'serviceAddress', mr.intake_details->>'reportedAddress',
      'nteAmount', mr.nte_amount,'approvalState', mr.approval_state,
      'responseState', va.response_state,'windowState', va.window_state,
      'scheduledStart', va.scheduled_start,'scheduledEnd', va.scheduled_end,
      'proposedStart', va.proposed_start,'proposedEnd', va.proposed_end,
      'quotedAmount', va.quoted_amount
    ) ORDER BY mr.created_at DESC
  ),'[]'::jsonb) INTO rows
  FROM public.pma_vendor_assignments va
  JOIN public.pma_maintenance_requests mr ON mr.id = va.request_id
  JOIN public.pma_properties pr ON pr.id = mr.property_id
  LEFT JOIN public.pma_units u ON u.id = mr.unit_id
  WHERE va.vendor_id = pma_vendor_work_orders_v1.vendor_id
    AND va.tenant_id = t AND va.property_id = p
    AND va.response_state <> 'DECLINED'
    AND va.status IS DISTINCT FROM 'cancelled'
    AND mr.status NOT IN ('Closed','Completed')
    AND (pma_vendor_work_orders_v1.case_number IS NULL OR mr.case_number = pma_vendor_work_orders_v1.case_number);
  RETURN jsonb_build_object('success',true,'workOrders',rows);
END $function$;

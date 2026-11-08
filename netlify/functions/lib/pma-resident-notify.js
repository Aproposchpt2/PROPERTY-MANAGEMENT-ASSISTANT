'use strict';

// Manager-side helpers that read case rows directly (service role, always scoped to the
// tenant and property): send a manager's update to the resident, and add the cost-approval
// fields that the live case RPCs do not return.

// Send the resident a manager's update by the method they chose at intake (text or email).
// Returns { sent, state, method }. Never throws: the case update itself has already been saved.
async function notifyResident({ db, env, tenantId, propertyId, requestId, update, actorUserId }) {
  const text = String(update || '').trim();
  if (!text) return { sent: false, state: 'NO_UPDATE', method: null };
  let row;
  try {
    const { data, error } = await db.from('pma_maintenance_requests')
      .select('case_number, status, intake_details')
      .eq('tenant_id', tenantId).eq('property_id', propertyId).eq('id', requestId)
      .maybeSingle();
    if (error) throw error;
    row = data;
  } catch (err) {
    console.error(JSON.stringify({ event: 'pma_resident_notify_lookup_failed', error: err?.message }));
    return { sent: false, state: 'FAILED', method: null };
  }
  if (!row) return { sent: false, state: 'NOT_FOUND', method: null };

  const pref = (row.intake_details && row.intake_details.contactPreference) || {};
  const method = pref.method;
  if (!pref.destination || pref.consent !== true || (method !== 'sms' && method !== 'email')) {
    return { sent: false, state: 'NO_PREFERENCE', method: method || null };
  }
  const enabled = method === 'sms' ? env.PMA_SMS_ENABLED === 'true' : env.PMA_EMAIL_ENABLED === 'true';
  if (!enabled) return { sent: false, state: 'DISABLED', method };

  const sender = require(method === 'sms' ? './pma-sms' : './pma-email');
  const language = row.intake_details.language === 'es' ? 'es' : 'en';
  let state = 'FAILED';
  try {
    await sender.sendResidentUpdate({
      to: pref.destination, caseNumber: row.case_number, update: text, status: row.status, language, env,
    });
    state = 'SENT';
  } catch (err) {
    state = err.code === 21610 || err.twilioCode === 21610 ? 'OPTED_OUT' : 'FAILED';
  }
  const how = method === 'sms' ? 'text' : 'email';
  const body = state === 'SENT' ? `Update sent to resident by ${how}.`
    : state === 'OPTED_OUT' ? `Update not sent: resident opted out of texts.`
    : `Update could not be sent to resident by ${how}.`;
  try {
    const { error } = await db.from('pma_maintenance_activity').insert({
      tenant_id: tenantId, property_id: propertyId, request_id: requestId,
      event_type: 'resident_update_sent', body, actor_user_id: actorUserId || null,
    });
    if (error) throw error;
  } catch (err) {
    console.error(JSON.stringify({ event: 'pma_resident_notify_record_failed', error: err?.message }));
  }
  return { sent: state === 'SENT', state, method };
}

// Adds nteAmount and approvalState to case objects in place. Best effort: on any failure the
// cases are returned unchanged.
async function addApprovalFields({ db, tenantId, propertyId, cases }) {
  const list = (cases || []).filter(c => c && c.id);
  if (!list.length) return;
  try {
    const { data, error } = await db.from('pma_maintenance_requests')
      .select('id, nte_amount, approval_state')
      .eq('tenant_id', tenantId).eq('property_id', propertyId)
      .in('id', list.map(c => c.id));
    if (error) throw error;
    const byId = new Map((data || []).map(r => [r.id, r]));
    for (const c of list) {
      const r = byId.get(c.id);
      if (!r) continue;
      c.nteAmount = r.nte_amount == null ? null : Number(r.nte_amount);
      c.approvalState = r.approval_state || null;
    }
  } catch (err) {
    console.error(JSON.stringify({ event: 'pma_mgr_approval_fields_failed', error: err?.message }));
  }
}

module.exports = { notifyResident, addApprovalFields };

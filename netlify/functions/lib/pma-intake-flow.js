'use strict';

// Steps shared by every way a resident files a maintenance request: Ava on the phone
// (cedar-elevenlabs.js) and the mobile app (pma-app-api.js). Both use the same store,
// so a request gets the same case number, emergency escalation, confirmation and status link.

const crypto = require('node:crypto');

// Issue a resident status link for a case. Returns null when a live link already exists
// (so a second one is never sent) or when issuing fails.
async function issuePortalLink(store, requestId) {
  if (!requestId) return null;
  try {
    const rawToken = crypto.randomBytes(16).toString('base64url').slice(0, 22);
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const result = await store.issuePortalToken({ request_id: requestId, token_hash: tokenHash });
    if (result && result.exists) return null; // live token already exists; don't send a second link
    return `https://pma.stellaruc.com/status?t=${rawToken}`;
  } catch (err) {
    console.error(JSON.stringify({ event: 'cedar_portal_token_failed', error: err?.message }));
    return null;
  }
}

// Emergency escalation to the maintenance and manager lines. Awaited: Lambda freezes
// background promises when the handler returns, so fire-and-forget never reached Twilio.
async function escalateEmergency({ result, args, callerPhone, env }) {
  if (!result || !result.urgentReviewRequired || env.PMA_SMS_ENABLED !== 'true') return;
  const { sendEmergencyEscalation } = require('./pma-sms');
  const escalationArgs = {
    caseNumber: result.caseNumber,
    address: args.reportedAddress || null,
    description: args.description || null,
    callerPhone: callerPhone || null,
    env,
  };
  const smsResults = await Promise.allSettled([
    sendEmergencyEscalation({ to: env.PMA_SMS_MAINTENANCE_NUMBER, ...escalationArgs }),
    sendEmergencyEscalation({ to: env.PMA_SMS_MANAGER_NUMBER, ...escalationArgs }),
  ]);
  smsResults.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(JSON.stringify({ event: 'cedar_emergency_escalation_failed', index: i, error: r.reason?.message }));
    }
  });
}

// After a contact preference is recorded: text the resident their case number and status link,
// record the outcome, and alert staff. Returns { notificationSent, notificationState, portalLink }.
async function confirmBySms({ store, session_id, call_sid, env }) {
  if (env.PMA_SMS_ENABLED !== 'true') return { notificationSent: false, notificationState: 'DISABLED', portalLink: null };
  let notificationSent = false;
  let notificationState = 'FAILED';
  let portalLink = null;
  try {
    const claim = await store.claimSms({ session_id, call_sid });
    if (!claim || !claim.success) {
      return { notificationSent: false, notificationState: claim.state || 'NOT_ELIGIBLE', portalLink: null };
    }
    portalLink = await issuePortalLink(store, claim.requestId);
    const { sendCaseConfirmation, sendStaffNotification } = require('./pma-sms');
    try {
      const { sid } = await sendCaseConfirmation({ to: claim.destination, caseNumber: claim.caseNumber, language: claim.language, portalLink, env });
      notificationSent = true;
      notificationState = 'SENT';
      try {
        await store.recordSms({ session_id, call_sid, message_sid: sid, outcome: 'SENT', error_code: null });
      } catch (recErr) {
        console.error(JSON.stringify({ event: 'cedar_sms_record_failed', error: recErr?.message }));
      }
    } catch (sendErr) {
      const smsOutcome = sendErr.code === 21610 || sendErr.twilioCode === 21610 ? 'OPTED_OUT' : 'FAILED';
      notificationState = smsOutcome;
      try {
        await store.recordSms({ session_id, call_sid, message_sid: null, outcome: smsOutcome, error_code: String(sendErr.code || '') });
      } catch (recErr) {
        console.error(JSON.stringify({ event: 'cedar_sms_record_failed', error: recErr?.message }));
      }
    }
    await Promise.allSettled([
      sendStaffNotification({ to: env.PMA_SMS_MAINTENANCE_NUMBER, caseNumber: claim.caseNumber, env }),
      sendStaffNotification({ to: env.PMA_SMS_MANAGER_NUMBER, caseNumber: claim.caseNumber, env }),
    ]);
  } catch (smsFlowErr) {
    console.error(JSON.stringify({ event: 'cedar_sms_flow_failed', error: smsFlowErr?.message }));
  }
  return { notificationSent, notificationState, portalLink };
}

// Email counterpart of confirmBySms.
async function confirmByEmail({ store, session_id, call_sid, env }) {
  if (env.PMA_EMAIL_ENABLED !== 'true') return { notificationSent: false, notificationState: 'DISABLED', portalLink: null };
  let notificationSent = false;
  let notificationState = 'FAILED';
  let portalLink = null;
  try {
    const claim = await store.claimEmail({ session_id, call_sid });
    if (!claim || !claim.success) {
      return { notificationSent: false, notificationState: claim.state || 'NOT_ELIGIBLE', portalLink: null };
    }
    portalLink = await issuePortalLink(store, claim.requestId);
    const { sendCaseConfirmation, sendStaffNotification } = require('./pma-email');
    try {
      const { id } = await sendCaseConfirmation({ to: claim.destination, caseNumber: claim.caseNumber, language: claim.language, portalLink, env });
      notificationSent = true;
      notificationState = 'SENT';
      try {
        await store.recordEmail({ session_id, call_sid, message_id: id, outcome: 'SENT', error_code: null });
      } catch (recErr) {
        console.error(JSON.stringify({ event: 'cedar_email_record_failed', error: recErr?.message }));
      }
    } catch (sendErr) {
      notificationState = 'FAILED';
      try {
        await store.recordEmail({ session_id, call_sid, message_id: null, outcome: 'FAILED', error_code: String(sendErr.code || '') });
      } catch (recErr) {
        console.error(JSON.stringify({ event: 'cedar_email_record_failed', error: recErr?.message }));
      }
    }
    await Promise.allSettled([
      sendStaffNotification({ to: env.PMA_EMAIL_MAINTENANCE_ADDRESS, caseNumber: claim.caseNumber, env }),
      sendStaffNotification({ to: env.PMA_EMAIL_MANAGER_ADDRESS, caseNumber: claim.caseNumber, env }),
    ]);
  } catch (emailFlowErr) {
    console.error(JSON.stringify({ event: 'cedar_email_flow_failed', error: emailFlowErr?.message }));
  }
  return { notificationSent, notificationState, portalLink };
}

module.exports = { issuePortalLink, escalateEmergency, confirmBySms, confirmByEmail };

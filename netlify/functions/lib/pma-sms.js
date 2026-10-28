'use strict';

async function sendCaseConfirmation({ to, caseNumber, language = 'en', portalLink = null, env }) {
  if (!env.PMA_SMS_MESSAGING_SERVICE_SID && !env.PMA_SMS_FROM_NUMBER) {
    throw Object.assign(new Error('SMS_NOT_CONFIGURED'), { code: 'SMS_NOT_CONFIGURED' });
  }
  const twilio = require('twilio');
  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const params = {
    to,
    body: language === 'es'
      ? `StellarUC: Su solicitud de mantenimiento fue registrada. Caso #${caseNumber}. En caso de emergencia llame al 911. Frecuencia de mensajes variable. Pueden aplicar tarifas de mensajes y datos. Responda AYUDA para ayuda o STOP para cancelar.${portalLink ? ' ' + portalLink : ''}`
      : `Desert Ridge Customer Care: your maintenance request is on file. Case #${caseNumber}. For emergencies call 911. Reply STOP to opt out.${portalLink ? ' ' + portalLink : ''}`,
  };
  if (env.PMA_SMS_MESSAGING_SERVICE_SID) {
    params.messagingServiceSid = env.PMA_SMS_MESSAGING_SERVICE_SID;
  } else {
    params.from = env.PMA_SMS_FROM_NUMBER;
  }
  const last4 = String(to).slice(-4);
  console.log(JSON.stringify({ event: 'pma_sms_sending', to_last4: last4 }));
  let msg;
  try {
    msg = await Promise.race([
      client.messages.create(params),
      new Promise((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error('SMS_TIMEOUT'), { code: 'SMS_TIMEOUT' })), 8000)
      ),
    ]);
  } catch (err) {
    if (err.code === 21610 || err.status === 21610) {
      const e = Object.assign(new Error('OPTED_OUT'), { code: 21610, twilioCode: 21610 });
      console.error(JSON.stringify({ event: 'pma_sms_opted_out', to_last4: last4 }));
      throw e;
    }
    console.error(JSON.stringify({ event: 'pma_sms_failed', to_last4: last4, code: err.code || err.message }));
    throw err;
  }
  console.log(JSON.stringify({ event: 'pma_sms_sent', to_last4: last4, sid: msg.sid }));
  return { sid: msg.sid };
}

// Staff alert sent to Maintenance and Manager numbers (best-effort, no DB record).
async function sendStaffNotification({ to, caseNumber, env }) {
  if (!to) return;
  if (!env.PMA_SMS_MESSAGING_SERVICE_SID && !env.PMA_SMS_FROM_NUMBER) return;
  const twilio = require('twilio');
  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const params = {
    to,
    body: `Desert Ridge PMA: New maintenance case #${caseNumber} filed. Review in your system for details.`,
  };
  if (env.PMA_SMS_MESSAGING_SERVICE_SID) {
    params.messagingServiceSid = env.PMA_SMS_MESSAGING_SERVICE_SID;
  } else {
    params.from = env.PMA_SMS_FROM_NUMBER;
  }
  const last4 = String(to).slice(-4);
  try {
    const msg = await Promise.race([
      client.messages.create(params),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('SMS_TIMEOUT')), 8000)
      ),
    ]);
    console.log(JSON.stringify({ event: 'pma_sms_staff_sent', to_last4: last4, sid: msg.sid }));
  } catch (err) {
    console.error(JSON.stringify({ event: 'pma_sms_staff_failed', to_last4: last4, code: err.code || err.message }));
  }
}

async function sendVendorApprovalRequest({ to, approverName, caseNumber, amount, approveUrl, shortCode, env }) {
  if (!env.PMA_VENDOR_FROM) throw Object.assign(new Error('PMA_VENDOR_FROM not configured'), { code: 'SMS_NOT_CONFIGURED' });
  const twilio = require('twilio');
  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const last4 = String(to).slice(-4);
  const body = `PMA NTE Request: Case #${caseNumber} — vendor quoted $${Number(amount).toFixed(2)}. ` +
    `Reply YES${shortCode} to approve or NO${shortCode} to decline. Or tap: ${approveUrl}`;
  try {
    const msg = await Promise.race([
      client.messages.create({ to, from: env.PMA_VENDOR_FROM, body }),
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('SMS_TIMEOUT'), { code: 'SMS_TIMEOUT' })), 8000)),
    ]);
    console.log(JSON.stringify({ event: 'pma_approval_sms_sent', to_last4: last4, sid: msg.sid }));
    return { sid: msg.sid };
  } catch (err) {
    console.error(JSON.stringify({ event: 'pma_approval_sms_failed', to_last4: last4, code: err.code || err.message }));
    throw err;
  }
}

async function sendVendorSms({ to, body, env }) {
  if (!env.PMA_VENDOR_FROM) return;
  const twilio = require('twilio');
  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const last4 = String(to).slice(-4);
  try {
    const msg = await Promise.race([
      client.messages.create({ to, from: env.PMA_VENDOR_FROM, body }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('SMS_TIMEOUT')), 8000)),
    ]);
    console.log(JSON.stringify({ event: 'pma_vendor_sms_sent', to_last4: last4, sid: msg.sid }));
    return { sid: msg.sid };
  } catch (err) {
    console.error(JSON.stringify({ event: 'pma_vendor_sms_failed', to_last4: last4, code: err.code || err.message }));
  }
}

// Emergency escalation — sent immediately on urgentReviewRequired, before contact-preference collection.
// Best-effort (never throws). Uses a 5-second timeout to keep Ava's response snappy.
async function sendEmergencyEscalation({ to, caseNumber, address, description, callerPhone, env }) {
  if (!to) return;
  if (!env.PMA_SMS_MESSAGING_SERVICE_SID && !env.PMA_SMS_FROM_NUMBER) return;
  const twilio = require('twilio');
  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const addrPart = address ? ` at ${address}` : '';
  const descPart = description ? ` — ${description.slice(0, 120)}` : '';
  const callbackPart = callerPhone ? ` Caller: ${callerPhone}` : '';
  const body = `🚨 EMERGENCY — Desert Ridge PMA: Case #${caseNumber}${addrPart}${descPart}.${callbackPart} Immediate attention required.`;
  const params = { to, body };
  if (env.PMA_SMS_MESSAGING_SERVICE_SID) {
    params.messagingServiceSid = env.PMA_SMS_MESSAGING_SERVICE_SID;
  } else {
    params.from = env.PMA_SMS_FROM_NUMBER;
  }
  const last4 = String(to).slice(-4);
  try {
    const msg = await Promise.race([
      client.messages.create(params),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('SMS_TIMEOUT')), 5000)
      ),
    ]);
    console.log(JSON.stringify({ event: 'pma_sms_emergency_sent', to_last4: last4, sid: msg.sid, caseNumber }));
  } catch (err) {
    console.error(JSON.stringify({ event: 'pma_sms_emergency_failed', to_last4: last4, code: err.code || err.message, caseNumber }));
  }
}

module.exports = { sendCaseConfirmation, sendStaffNotification, sendEmergencyEscalation, sendVendorApprovalRequest, sendVendorSms };

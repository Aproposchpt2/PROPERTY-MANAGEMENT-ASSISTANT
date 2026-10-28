'use strict';

async function sendCaseConfirmation({ to, caseNumber, language = 'en', env }) {
  if (!env.PMA_SMS_MESSAGING_SERVICE_SID && !env.PMA_SMS_FROM_NUMBER) {
    throw Object.assign(new Error('SMS_NOT_CONFIGURED'), { code: 'SMS_NOT_CONFIGURED' });
  }
  const twilio = require('twilio');
  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const params = {
    to,
    body: language === 'es'
      ? `StellarUC: Su solicitud de mantenimiento fue registrada. Caso #${caseNumber}. En caso de emergencia llame al 911. Frecuencia de mensajes variable. Pueden aplicar tarifas de mensajes y datos. Responda AYUDA para ayuda o STOP para cancelar.`
      : `Desert Ridge Customer Care: your maintenance request is on file. Case #${caseNumber}. For emergencies call 911. Reply STOP to opt out.`,
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

module.exports = { sendCaseConfirmation, sendStaffNotification };

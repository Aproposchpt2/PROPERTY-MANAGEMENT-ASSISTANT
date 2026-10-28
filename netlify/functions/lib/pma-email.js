'use strict';

const TENANT_SUBJECT = (caseNumber) => `Desert Ridge Customer Care — Case #${caseNumber} Confirmed`;
const TENANT_HTML = (caseNumber) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:560px;width:100%">
        <tr><td style="background:#1a1a2e;padding:24px 32px">
          <p style="margin:0;color:#ffffff;font-size:18px;font-weight:bold">Desert Ridge Customer Care</p>
          <p style="margin:4px 0 0;color:#a0aec0;font-size:13px">Stellar Intelligent Technologies</p>
        </td></tr>
        <tr><td style="padding:32px">
          <p style="margin:0 0 16px;font-size:15px;color:#1a1a2e">Your maintenance request has been received and is on file.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:24px">
            <tr><td style="padding:16px 20px">
              <p style="margin:0 0 4px;font-size:12px;color:#718096;text-transform:uppercase;letter-spacing:0.05em">Case Number</p>
              <p style="margin:0;font-size:22px;font-weight:bold;color:#1a1a2e;letter-spacing:0.05em">${caseNumber}</p>
            </td></tr>
          </table>
          <p style="margin:0 0 16px;font-size:14px;color:#4a5568">You will receive updates as your request is processed. If you need an update at any time, please contact us:</p>
          <p style="margin:0 0 8px;font-size:14px;color:#4a5568"><strong>Customer Care Center:</strong> (725) 201-0584</p>
          <p style="margin:0 0 24px;font-size:14px;color:#4a5568">Our team is available to assist you.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff5f5;border:1px solid #fed7d7;border-radius:6px">
            <tr><td style="padding:14px 20px">
              <p style="margin:0;font-size:13px;color:#c53030"><strong>For life-safety emergencies, call 911 immediately.</strong><br>Do not use this channel for emergencies.</p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0">
          <p style="margin:0;font-size:12px;color:#a0aec0;text-align:center">Desert Ridge Property Management &bull; Powered by Stellar Intelligent Technologies</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const TENANT_TEXT = (caseNumber) =>
  `Desert Ridge Customer Care: your maintenance request is on file. Case #${caseNumber}. Call (725) 201-0584 for updates. For emergencies call 911.`;

const TENANT_SUBJECT_ES = (caseNumber) => `Desert Ridge Customer Care — Caso #${caseNumber} Confirmado`;
const TENANT_HTML_ES = (caseNumber) => `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:560px;width:100%">
        <tr><td style="background:#1a1a2e;padding:24px 32px">
          <p style="margin:0;color:#ffffff;font-size:18px;font-weight:bold">Desert Ridge Customer Care</p>
          <p style="margin:4px 0 0;color:#a0aec0;font-size:13px">Stellar Intelligent Technologies</p>
        </td></tr>
        <tr><td style="padding:32px">
          <p style="margin:0 0 16px;font-size:15px;color:#1a1a2e">Su solicitud de mantenimiento ha sido recibida y est&#225; en registro.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:24px">
            <tr><td style="padding:16px 20px">
              <p style="margin:0 0 4px;font-size:12px;color:#718096;text-transform:uppercase;letter-spacing:0.05em">N&#250;mero de Caso</p>
              <p style="margin:0;font-size:22px;font-weight:bold;color:#1a1a2e;letter-spacing:0.05em">${caseNumber}</p>
            </td></tr>
          </table>
          <p style="margin:0 0 16px;font-size:14px;color:#4a5568">Recibir&#225; actualizaciones a medida que se procese su solicitud. Para consultas, comun&#237;quese con nosotros:</p>
          <p style="margin:0 0 8px;font-size:14px;color:#4a5568"><strong>Centro de Atenci&#243;n al Cliente:</strong> (725) 201-0584</p>
          <p style="margin:0 0 24px;font-size:14px;color:#4a5568">Nuestro equipo est&#225; disponible para asistirle.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff5f5;border:1px solid #fed7d7;border-radius:6px">
            <tr><td style="padding:14px 20px">
              <p style="margin:0;font-size:13px;color:#c53030"><strong>En caso de emergencia que pone en riesgo la vida, llame al 911 de inmediato.</strong><br>No use este canal para emergencias.</p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0">
          <p style="margin:0;font-size:12px;color:#a0aec0;text-align:center">Desert Ridge Property Management &bull; Powered by Stellar Intelligent Technologies</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const TENANT_TEXT_ES = (caseNumber) =>
  `Desert Ridge Customer Care: su solicitud de mantenimiento está en registro. Caso #${caseNumber}. Para actualizaciones llame al (725) 201-0584. En emergencias llame al 911.`;

const STAFF_SUBJECT = (caseNumber) => `Desert Ridge PMA: New maintenance case #${caseNumber}`;
const STAFF_TEXT = (caseNumber) =>
  `Desert Ridge PMA: New maintenance case #${caseNumber} filed. Review in your system for details.`;

async function sendCaseConfirmation({ to, caseNumber, language = 'en', portalLink = null, env }) {
  if (!env.RESEND_API_KEY) {
    throw Object.assign(new Error('EMAIL_NOT_CONFIGURED'), { code: 'EMAIL_NOT_CONFIGURED' });
  }
  const { Resend } = require('resend');
  const resend = new Resend(env.RESEND_API_KEY);
  const last6 = String(to).replace(/[^@]/g, (c, i, s) => i < s.indexOf('@') - 2 ? '*' : c);
  console.log(JSON.stringify({ event: 'pma_email_sending', to_masked: last6 }));
  let result;
  try {
    const isEs = language === 'es';
    const linkHtml = portalLink
      ? `<tr><td style="padding:20px 32px 0"><p style="margin:0;font-size:14px;color:#4a5568">${isEs ? 'Siga el estado de su solicitud:' : 'Track your request status:'} <a href="${portalLink}" style="color:#2b6cb0">${isEs ? 'Ver estado' : 'View status'}</a></p></td></tr>`
      : '';
    const linkText = portalLink ? (isEs ? `\nSiga el estado: ${portalLink}` : `\nTrack status: ${portalLink}`) : '';
    const baseHtml = isEs ? TENANT_HTML_ES(caseNumber) : TENANT_HTML(caseNumber);
    const html = linkHtml ? baseHtml.replace('</table>\n</body>', `${linkHtml}\n</table>\n</body>`) : baseHtml;
    result = await Promise.race([
      resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to: [to],
        subject: isEs ? TENANT_SUBJECT_ES(caseNumber) : TENANT_SUBJECT(caseNumber),
        html,
        text: (isEs ? TENANT_TEXT_ES(caseNumber) : TENANT_TEXT(caseNumber)) + linkText,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error('EMAIL_TIMEOUT'), { code: 'EMAIL_TIMEOUT' })), 8000)
      ),
    ]);
  } catch (err) {
    console.error(JSON.stringify({ event: 'pma_email_failed', code: err.code || err.message }));
    throw err;
  }
  if (result.error) {
    const err = Object.assign(new Error(result.error.message || 'EMAIL_FAILED'), { code: 'EMAIL_FAILED', resendError: result.error });
    console.error(JSON.stringify({ event: 'pma_email_failed', code: err.code }));
    throw err;
  }
  console.log(JSON.stringify({ event: 'pma_email_sent', id: result.data.id }));
  return { id: result.data.id };
}

async function sendStaffNotification({ to, caseNumber, env }) {
  if (!to || !env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) return;
  const { Resend } = require('resend');
  const resend = new Resend(env.RESEND_API_KEY);
  try {
    const result = await Promise.race([
      resend.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to: [to],
        subject: STAFF_SUBJECT(caseNumber),
        text: STAFF_TEXT(caseNumber),
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('EMAIL_TIMEOUT')), 8000)
      ),
    ]);
    if (!result.error) {
      console.log(JSON.stringify({ event: 'pma_email_staff_sent', id: result.data.id }));
    } else {
      console.error(JSON.stringify({ event: 'pma_email_staff_failed', code: result.error.message }));
    }
  } catch (err) {
    console.error(JSON.stringify({ event: 'pma_email_staff_failed', code: err.code || err.message }));
  }
}

module.exports = { sendCaseConfirmation, sendStaffNotification };

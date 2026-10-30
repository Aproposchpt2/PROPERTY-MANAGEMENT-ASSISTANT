'use strict';

// Public consultation intake for pma.stellaruc.com/intake.html.
// Mirrors the stellaruc.com intake (name, business name, phone, email, optional SMS consent).
// Delivery is email-only: each submission is emailed to the owner via Resend.
// Nothing is stored, so the request only succeeds when the email is accepted.

const NOTIFY_EMAIL = 'jmitchell@aproposgroupllc.com';
const SMS_CONSENT_TEXT =
  'Yes, StellarUC (Apropos Group LLC) may send me text messages about my inquiry and consultation. ' +
  'Message frequency varies. Msg & data rates may apply. Reply STOP to opt out or HELP for help. ' +
  'Consent is not a condition of purchase.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLIENT_TOKEN_RE = /^[A-Za-z0-9_-]{8,80}$/;
const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const reply = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });
const text = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function normalizePhone(value) {
  const raw = value.trim();
  if (!raw || !/^[+\d().\-\s]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  if (raw.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits;
}

function sameOrigin(headers) {
  const origin = headers.origin || headers.Origin;
  const host = headers.host || headers.Host;
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

async function sendEmail({ name, businessName, phone, email, smsConsent, at }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) throw new Error('EMAIL_NOT_CONFIGURED');
  const to = process.env.PMA_INTAKE_TO_EMAIL || process.env.OWNER_NOTIFICATION_EMAIL || NOTIFY_EMAIL;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: email,
      subject: `New PMA consultation request: ${businessName}`,
      text:
        'New consultation request from pma.stellaruc.com/intake.html.\n\n' +
        `Name: ${name}\nBusiness: ${businessName}\nPhone: ${phone}\nEmail: ${email}\n` +
        `SMS consent: ${smsConsent ? `Yes (${at})\nConsent text: ${SMS_CONSENT_TEXT}` : 'No'}\n`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`EMAIL_SEND_FAILED_${res.status}`);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  if (!sameOrigin(event.headers || {})) return reply(403, { error: 'Invalid request origin' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid request.' }); }

  const name = text(body.name);
  const businessName = text(body.businessName);
  const email = text(body.email).toLowerCase();
  const phone = normalizePhone(text(body.phone, 40));
  const smsConsent = body.smsConsent === true;
  const website = text(body.website); // honeypot: real visitors never fill this

  if (!name) return reply(400, { error: 'Name is required.' });
  if (!businessName) return reply(400, { error: 'Business name is required.' });
  if (!phone) return reply(400, { error: 'A valid phone number is required.' });
  if (!EMAIL_RE.test(email)) return reply(400, { error: 'A valid email address is required.' });
  if (!CLIENT_TOKEN_RE.test(text(body.clientToken, 80))) return reply(400, { error: 'Invalid submission token.' });
  if (website) return reply(200, { ok: true });

  try {
    await sendEmail({ name, businessName, phone, email, smsConsent, at: new Date().toISOString() });
    return reply(200, { ok: true });
  } catch (err) {
    console.error('[pma-intake] failed:', err.message);
    return reply(500, { error: 'We could not send your information. Please try again or call us.' });
  }
};

exports._test = { normalizePhone, sameOrigin };

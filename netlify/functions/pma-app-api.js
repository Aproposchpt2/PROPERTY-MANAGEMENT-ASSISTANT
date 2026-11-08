'use strict';

// Mobile app maintenance requests: the app's equivalent of calling the Customer Care Center.
//
//   POST /api/app/verify   { phone }                       -> texts a 6-digit code, returns a challenge
//   POST /api/app/request  { challenge, code, reportedName, reportedAddress, reportedUnit,
//                            description, language, contactMethod, email, consent }
//                          -> files the request exactly like a call does
//
// Filing reuses Ava's path (cedar-store + pma-intake-flow): same case number, emergency
// escalation, staff alerts, text/email confirmation and status link. The verified phone plays
// the part of caller ID. Rate limits are per Lambda instance (best effort, not global).

const { createStore } = require('./lib/cedar-store');
const { escalateEmergency, confirmBySms, confirmByEmail, issuePortalLink } = require('./lib/pma-intake-flow');
const { normalizeNanpPhone, newCode, createChallenge, checkChallenge } = require('./lib/pma-app-verify');
const { pushNewCase } = require('./lib/pma-push');

const HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };
const reply = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEN_MIN = 10 * 60 * 1000;

let storeOverride = null; // test hook
const _limits = new Map();
function allow(key, max, windowMs = TEN_MIN, now = Date.now()) {
  const e = _limits.get(key);
  if (!e || e.reset <= now) { _limits.set(key, { count: 1, reset: now + windowMs }); return true; }
  if (e.count >= max) return false;
  e.count++;
  return true;
}
function resetLimits() { _limits.clear(); }

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max + 1) : '');
const clientIp = (headers) => String(headers['x-nf-client-connection-ip'] || headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
const digits = (v) => String(v || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');

async function verify(body, ip, env) {
  if (env.PMA_SMS_ENABLED !== 'true' || !env.PMA_APP_VERIFY_SECRET) {
    return reply(503, { success: false, state: 'UNAVAILABLE', error: 'Requests by app are not available right now. Please call the property line.' });
  }
  const phone = normalizeNanpPhone(body.phone);
  if (!phone) return reply(400, { success: false, state: 'INVALID_PHONE', error: 'Enter a 10-digit US or Canadian mobile number.' });
  const ownLines = [env.PMA_SMS_FROM_NUMBER, env.PMA_VENDOR_FROM].map(digits).filter(Boolean);
  if (ownLines.includes(digits(phone))) {
    return reply(400, { success: false, state: 'INVALID_PHONE', error: 'Enter your own mobile number.' });
  }
  if (!allow(`verify-ip:${ip}`, 5) || !allow(`verify-phone:${phone}`, 3)) {
    return reply(429, { success: false, state: 'RATE_LIMITED', error: 'Too many codes requested. Wait 10 minutes, or call the property line.' });
  }
  const code = newCode();
  const { challenge, expiresAt } = createChallenge({ phone, code, secret: env.PMA_APP_VERIFY_SECRET });
  try {
    await require('./lib/pma-sms').sendVerificationCode({ to: phone, code, env });
  } catch (err) {
    const optedOut = err.code === 21610 || err.twilioCode === 21610;
    return reply(502, {
      success: false,
      state: optedOut ? 'OPTED_OUT' : 'SEND_FAILED',
      error: optedOut
        ? 'This number has opted out of our texts. Reply START to our number to opt back in, or call the property line.'
        : 'We could not text that number. Check it, or call the property line.',
    });
  }
  return reply(200, { success: true, challenge, expiresAt, phoneLast4: phone.slice(-4) });
}

function validateRequest(body) {
  const f = {
    reportedName: text(body.reportedName, 150),
    reportedAddress: text(body.reportedAddress, 300),
    reportedUnit: text(body.reportedUnit, 80),
    description: text(body.description, 4000),
  };
  // Same limits as pma_voice_incident_create_v1.
  if (f.reportedName.length < 2 || f.reportedName.length > 150) return { error: 'Enter your name.' };
  if (f.reportedAddress.length < 5 || f.reportedAddress.length > 300) return { error: 'Enter the property address.' };
  if (f.reportedUnit.length < 1 || f.reportedUnit.length > 80) return { error: 'Enter your unit or apartment.' };
  if (f.description.length < 3 || f.description.length > 4000) return { error: 'Describe the problem (up to 4,000 characters).' };
  const language = body.language === 'es' ? 'es' : 'en';
  const method = body.contactMethod === 'email' ? 'email' : body.contactMethod === 'sms' ? 'sms' : null;
  if (!method) return { error: 'Choose text or email for updates.' };
  const email = method === 'email' ? text(body.email, 254).toLowerCase() : null;
  if (method === 'email' && (!EMAIL_RE.test(email) || email.length > 254)) return { error: 'Enter a valid email address.' };
  if (body.consent !== true) return { error: 'Agree to receive updates about this request.' };
  return { fields: { ...f, language }, method, email };
}

async function fileRequest(body, ip, env) {
  if (!env.PMA_APP_VERIFY_SECRET) {
    return reply(503, { success: false, state: 'UNAVAILABLE', error: 'Requests by app are not available right now. Please call the property line.' });
  }
  if (!allow(`request-ip:${ip}`, 20)) {
    return reply(429, { success: false, state: 'RATE_LIMITED', error: 'Too many attempts. Wait 10 minutes, or call the property line.' });
  }
  const v = validateRequest(body);
  if (v.error) return reply(400, { success: false, state: 'INVALID_REQUEST', error: v.error });

  const check = checkChallenge({ challenge: body.challenge, code: body.code, secret: env.PMA_APP_VERIFY_SECRET });
  if (!check.ok) {
    if (check.state === 'WRONG_CODE' && check.nonce && !allow(`attempts:${check.nonce}`, 5)) {
      return reply(400, { success: false, state: 'TOO_MANY_ATTEMPTS', error: 'Too many wrong codes. Request a new code.' });
    }
    const msg = check.state === 'WRONG_CODE' ? 'That code is not right. Check the text and try again.'
      : check.state === 'EXPIRED' ? 'That code has expired. Request a new code.'
      : 'Request a new code.';
    return reply(400, { success: false, state: check.state, error: msg });
  }
  if (!allow(`attempts:${check.nonce}`, 5)) {
    return reply(400, { success: false, state: 'TOO_MANY_ATTEMPTS', error: 'Too many attempts. Request a new code.' });
  }

  let store;
  try {
    store = storeOverride || createStore(env);
  } catch {
    return reply(503, { success: false, state: 'UNAVAILABLE', error: 'Requests by app are not available right now. Please call the property line.' });
  }
  const phone = check.phone;
  const call_sid = `app-${check.nonce}`; // one verification files at most one case
  try {
    const { session_id } = await store.start({ call_sid, caller_number: phone });
    const result = await store.createIncident({ session_id, call_sid, args: v.fields });
    if (!result || !result.success) {
      const state = (result && result.state) || 'UNKNOWN';
      return reply(state === 'CONFLICT' ? 409 : 500, {
        success: false, state,
        error: state === 'CONFLICT'
          ? 'This code was already used for a different request. Request a new code.'
          : 'Your request was not filed. Please try again or call the property line.',
      });
    }
    await Promise.all([
      escalateEmergency({ result, args: v.fields, callerPhone: phone, env }),
      pushNewCase({ result, args: v.fields, env }),
    ]);

    let notice = { notificationSent: false, notificationState: 'NOT_SENT', portalLink: null };
    try {
      const destination = v.method === 'sms' ? phone : v.email;
      const pref = await store.recordPreference({ session_id, call_sid, args: { method: v.method, destination, consent: true } });
      if (pref && pref.success && !pref.replayed) {
        notice = await (v.method === 'sms' ? confirmBySms : confirmByEmail)({ store, session_id, call_sid, env });
      }
    } catch (err) {
      console.error(JSON.stringify({ event: 'pma_app_preference_failed', error: err?.message }));
    }
    // The app opens the case straight away, so it needs a status link even when the
    // confirmation is turned off or failed. Returns null if one was already issued.
    const portalLink = notice.portalLink || await issuePortalLink(store, result.requestId);
    try { await store.close({ session_id, call_sid }); } catch { /* session also expires on its own */ }

    const token = portalLink ? new URL(portalLink).searchParams.get('t') : null;
    console.log(JSON.stringify({ event: 'pma_app_request_filed', caseNumber: result.caseNumber, urgent: !!result.urgentReviewRequired, method: v.method, notification: notice.notificationState, replayed: !!result.replayed }));
    return reply(200, {
      success: true,
      caseNumber: result.caseNumber,
      urgent: !!result.urgentReviewRequired,
      statusToken: token,
      notificationSent: notice.notificationSent,
      notificationState: notice.notificationState,
      replayed: !!result.replayed,
    });
  } catch (err) {
    const invalid = err?.message === 'PMA_RPC_22023';
    console.error(JSON.stringify({ event: 'pma_app_request_failed', error: err?.message }));
    return reply(invalid ? 400 : 500, {
      success: false,
      state: invalid ? 'INVALID_REQUEST' : 'UNKNOWN',
      error: invalid ? 'Check the details and try again.' : 'Your request was not filed. Please try again or call the property line.',
    });
  }
}

async function handler(event) {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, val]) => [k.toLowerCase(), val]));
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'Invalid JSON' });
  const ip = clientIp(headers);
  const action = String(event.path || '').replace(/^.*\/api\/app\/?/, '').replace(/\/+$/, '');
  if (action === 'verify') return verify(body, ip, process.env);
  if (action === 'request') return fileRequest(body, ip, process.env);
  return reply(404, { error: 'Not found' });
}

module.exports = {
  handler,
  _test: { setStore: (s) => { storeOverride = s; }, resetLimits, validateRequest },
};

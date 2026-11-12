'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { normalizeNanpPhone, createChallenge, checkChallenge } = require('../netlify/functions/lib/pma-app-verify');

// Stub the SMS and email senders so no Twilio or Resend is touched.
const sent = [];
const smsOverrides = {};
const smsPath = path.join(__dirname, '../netlify/functions/lib/pma-sms.js');
require.cache[require.resolve(smsPath)] = {
  id: smsPath, filename: smsPath, loaded: true,
  exports: {
    sendVerificationCode: async (a) => { sent.push(['code', a]); if (smsOverrides.code) return smsOverrides.code(a); return { sid: 'SM_code' }; },
    sendCaseConfirmation: async (a) => { sent.push(['confirm', a]); return { sid: 'SM_conf' }; },
    sendStaffNotification: async (a) => { sent.push(['staff', a]); },
    sendEmergencyEscalation: async (a) => { sent.push(['emergency', a]); },
  },
};
const emailPath = path.join(__dirname, '../netlify/functions/lib/pma-email.js');
require.cache[require.resolve(emailPath)] = {
  id: emailPath, filename: emailPath, loaded: true,
  exports: {
    sendCaseConfirmation: async (a) => { sent.push(['email_confirm', a]); return { id: 'RE_1' }; },
    sendStaffNotification: async (a) => { sent.push(['email_staff', a]); },
  },
};

const { handler, _test } = require('../netlify/functions/pma-app-api');

const SECRET = 'x'.repeat(40);
const calls = [];
let createResult = null;
const store = {
  start: async (a) => { calls.push(['start', a]); return { session_id: 'sess_app' }; },
  createIncident: async (a) => { calls.push(['createIncident', a]); return createResult || { success: true, state: 'CONFIRMED', requestId: 'req_1', caseNumber: 'PMA-2001', urgentReviewRequired: false }; },
  recordPreference: async (a) => { calls.push(['recordPreference', a]); return { success: true, state: 'CONFIRMED', requestId: 'req_1' }; },
  claimSms: async (a) => { calls.push(['claimSms', a]); return { success: true, destination: '+17025550100', caseNumber: 'PMA-2001', requestId: 'req_1', language: 'en' }; },
  recordSms: async (a) => { calls.push(['recordSms', a]); return { success: true }; },
  claimEmail: async (a) => { calls.push(['claimEmail', a]); return { success: true, destination: 'r@example.com', caseNumber: 'PMA-2001', requestId: 'req_1', language: 'en' }; },
  recordEmail: async (a) => { calls.push(['recordEmail', a]); return { success: true }; },
  issuePortalToken: async (a) => { calls.push(['issuePortalToken', a]); return { success: true }; },
  close: async (a) => { calls.push(['close', a]); return { success: true }; },
};
_test.setStore(store);

function env(extra = {}) {
  Object.assign(process.env, {
    PMA_SMS_ENABLED: 'true', PMA_EMAIL_ENABLED: 'true', PMA_APP_VERIFY_SECRET: SECRET,
    PMA_SMS_FROM_NUMBER: '+17252010584', PMA_SMS_MAINTENANCE_NUMBER: '+17025550111', PMA_SMS_MANAGER_NUMBER: '+17025550112',
  }, extra);
}
const post = (p, body, ip = '1.2.3.4') => handler({ httpMethod: 'POST', path: `/api/app/${p}`, headers: { 'x-nf-client-connection-ip': ip }, body: JSON.stringify(body) });
const parse = (r) => JSON.parse(r.body);

function reset() {
  sent.length = 0; calls.length = 0; createResult = null;
  for (const k of Object.keys(smsOverrides)) delete smsOverrides[k];
  _test.resetLimits(); env();
}

async function getChallenge(phone = '(702) 555-0100') {
  const r = await post('verify', { phone });
  assert.equal(r.statusCode, 200, r.body);
  const code = sent.find(s => s[0] === 'code')[1].code;
  return { challenge: parse(r).challenge, code };
}

const form = (extra = {}) => ({
  reportedName: 'Dana Ruiz', reportedAddress: '1200 Desert Palm Dr', reportedUnit: '14B',
  description: 'Kitchen sink is leaking under the cabinet.', language: 'en', contactMethod: 'sms', consent: true, ...extra,
});

// ── Phone check helpers ────────────────────────────────────────────────────

test('normalizeNanpPhone accepts US/Canada numbers only', () => {
  assert.equal(normalizeNanpPhone('(702) 555-0100'), '+17025550100');
  assert.equal(normalizeNanpPhone('+1 702.555.0100'), '+17025550100');
  assert.equal(normalizeNanpPhone('17025550100'), '+17025550100');
  assert.equal(normalizeNanpPhone('+447700900123'), null);
  assert.equal(normalizeNanpPhone('011 44 7700 900123'), null);
  assert.equal(normalizeNanpPhone('1025550100'), null); // area code cannot start with 0/1
  assert.equal(normalizeNanpPhone('abc'), null);
  assert.equal(normalizeNanpPhone(''), null);
});

test('challenge: right code passes; wrong, tampered, expired and unkeyed fail', () => {
  const { challenge } = createChallenge({ phone: '+17025550100', code: '123456', secret: SECRET, now: 1000 });
  assert.deepEqual(checkChallenge({ challenge, code: '123456', secret: SECRET, now: 2000 }).ok, true);
  assert.equal(checkChallenge({ challenge, code: '123456', secret: SECRET, now: 2000 }).phone, '+17025550100');
  assert.equal(checkChallenge({ challenge, code: '654321', secret: SECRET, now: 2000 }).state, 'WRONG_CODE');
  assert.equal(checkChallenge({ challenge, code: '123456', secret: SECRET, now: 1000 + 11 * 60 * 1000 }).state, 'EXPIRED');
  assert.equal(checkChallenge({ challenge, code: '123456', secret: 'y'.repeat(40), now: 2000 }).state, 'INVALID');
  const [payload, sig] = challenge.split('.');
  const body = JSON.parse(Buffer.from(payload, 'base64url').toString());
  const forged = Buffer.from(JSON.stringify({ ...body, p: '+17025559999' })).toString('base64url') + '.' + sig;
  assert.equal(checkChallenge({ challenge: forged, code: '123456', secret: SECRET, now: 2000 }).state, 'INVALID');
  assert.throws(() => createChallenge({ phone: '+17025550100', code: '1', secret: 'short' }));
});

test('challenge does not contain the code', () => {
  const { challenge } = createChallenge({ phone: '+17025550100', code: '424242', secret: SECRET });
  assert.ok(!Buffer.from(challenge.split('.')[0], 'base64url').toString().includes('424242'));
});

// ── /api/app/verify ────────────────────────────────────────────────────────

test('verify texts a code to the normalized number', async () => {
  reset();
  const r = await post('verify', { phone: '702-555-0100' });
  assert.equal(r.statusCode, 200);
  assert.equal(parse(r).phoneLast4, '0100');
  const [, a] = sent.find(s => s[0] === 'code');
  assert.equal(a.to, '+17025550100');
  assert.match(a.code, /^\d{6}$/);
});

test('verify refuses international numbers, our own line, and missing config', async () => {
  reset();
  assert.equal((await post('verify', { phone: '+447700900123' })).statusCode, 400);
  assert.equal((await post('verify', { phone: '(725) 201-0584' })).statusCode, 400);
  env({ PMA_APP_VERIFY_SECRET: '' });
  assert.equal((await post('verify', { phone: '7025550100' })).statusCode, 503);
  env({ PMA_SMS_ENABLED: 'false' });
  assert.equal((await post('verify', { phone: '7025550100' })).statusCode, 503);
  assert.equal(sent.length, 0);
});

test('verify is rate limited per number', async () => {
  reset();
  for (let i = 0; i < 3; i++) assert.equal((await post('verify', { phone: '7025550100' }, `9.9.9.${i}`)).statusCode, 200);
  assert.equal((await post('verify', { phone: '7025550100' }, '9.9.9.9')).statusCode, 429);
});

test('verify reports a send failure without a challenge', async () => {
  reset();
  smsOverrides.code = async () => { throw Object.assign(new Error('x'), { code: 21610 }); };
  const r = await post('verify', { phone: '7025550100' });
  assert.equal(r.statusCode, 502);
  assert.equal(parse(r).state, 'OPTED_OUT');
  assert.equal(parse(r).challenge, undefined);
});

// ── /api/app/request ───────────────────────────────────────────────────────

test('request files the case like a call: session, incident, preference, confirmation, staff alert', async () => {
  reset();
  const { challenge, code } = await getChallenge();
  const r = await post('request', { ...form(), challenge, code });
  const b = parse(r);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(b.caseNumber, 'PMA-2001');
  assert.match(b.statusToken, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(b.notificationState, 'SENT');
  const start = calls.find(c => c[0] === 'start')[1];
  assert.equal(start.caller_number, '+17025550100'); // verified phone stands in for caller ID
  assert.match(start.call_sid, /^app-/);
  assert.deepEqual(calls.find(c => c[0] === 'createIncident')[1].args, {
    reportedName: 'Dana Ruiz', reportedAddress: '1200 Desert Palm Dr', reportedUnit: '14B',
    description: 'Kitchen sink is leaking under the cabinet.', language: 'en',
  });
  assert.deepEqual(calls.find(c => c[0] === 'recordPreference')[1].args, { method: 'sms', destination: '+17025550100', consent: true });
  assert.ok(sent.some(s => s[0] === 'confirm'));
  assert.equal(sent.filter(s => s[0] === 'staff').length, 2);
  assert.ok(!sent.some(s => s[0] === 'emergency'));
  assert.ok(calls.some(c => c[0] === 'close'));
});

test('urgent requests escalate to maintenance and manager', async () => {
  reset();
  createResult = { success: true, requestId: 'req_2', caseNumber: 'PMA-2002', urgentReviewRequired: true };
  const { challenge, code } = await getChallenge();
  const r = await post('request', { ...form({ description: 'I smell gas in the kitchen' }), challenge, code });
  assert.equal(parse(r).urgent, true);
  const esc = sent.filter(s => s[0] === 'emergency');
  assert.equal(esc.length, 2);
  assert.equal(esc[0][1].callerPhone, '+17025550100');
});

test('email confirmation goes to the email given; app still gets a status token', async () => {
  reset();
  const { challenge, code } = await getChallenge();
  const r = await post('request', { ...form({ contactMethod: 'email', email: 'Dana@Example.com' }), challenge, code });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(calls.find(c => c[0] === 'recordPreference')[1].args, { method: 'email', destination: 'dana@example.com', consent: true });
  assert.ok(sent.some(s => s[0] === 'email_confirm'));
  assert.ok(parse(r).statusToken);
});

test('with texts turned off the case is still filed and the app gets a status token', async () => {
  reset();
  const { challenge, code } = await getChallenge();
  env({ PMA_SMS_ENABLED: 'false' });
  const r = await post('request', { ...form(), challenge, code });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(parse(r).notificationState, 'DISABLED');
  assert.ok(parse(r).statusToken);
});

test('wrong code files nothing and locks after 5 tries', async () => {
  reset();
  const { challenge, code } = await getChallenge();
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal(parse(await post('request', { ...form(), challenge, code: wrong })).state, 'WRONG_CODE');
  assert.equal(parse(await post('request', { ...form(), challenge, code: wrong })).state, 'TOO_MANY_ATTEMPTS');
  assert.equal(parse(await post('request', { ...form(), challenge, code })).state, 'TOO_MANY_ATTEMPTS');
  assert.ok(!calls.some(c => c[0] === 'createIncident'));
});

test('missing fields and consent are rejected before the code is checked', async () => {
  reset();
  const { challenge, code } = await getChallenge();
  for (const bad of [{ reportedName: 'D' }, { reportedAddress: '12' }, { reportedUnit: '' }, { description: 'x' },
    { consent: false }, { contactMethod: 'fax' }, { contactMethod: 'email', email: 'nope' }]) {
    const r = await post('request', { ...form(bad), challenge, code });
    assert.equal(r.statusCode, 400, JSON.stringify(bad));
    assert.equal(parse(r).state, 'INVALID_REQUEST');
  }
  assert.equal(calls.length, 0);
});

test('a forged challenge for another number is rejected', async () => {
  reset();
  const { challenge, code } = await getChallenge();
  const [payload, sig] = challenge.split('.');
  const body = JSON.parse(Buffer.from(payload, 'base64url').toString());
  const forged = Buffer.from(JSON.stringify({ ...body, p: '+17025559999' })).toString('base64url') + '.' + sig;
  const r = await post('request', { ...form(), challenge: forged, code });
  assert.equal(parse(r).state, 'INVALID');
  assert.equal(calls.length, 0);
});

test('only POST and known paths', async () => {
  reset();
  assert.equal((await handler({ httpMethod: 'GET', path: '/api/app/verify', headers: {} })).statusCode, 405);
  assert.equal((await post('other', {})).statusCode, 404);
  assert.equal((await handler({ httpMethod: 'POST', path: '/api/app/verify', headers: {}, body: '{' })).statusCode, 400);
});

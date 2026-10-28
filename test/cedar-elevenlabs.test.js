'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

// Mutable overrides for per-test behaviour.
const storeOverrides = {};
const smsOverrides = {};

// Stub the Supabase-backed store so no network or DB is touched.
const storePath = path.join(__dirname, '../netlify/functions/lib/cedar-store.js');
const calls = [];
require.cache[require.resolve(storePath)] = {
  id: storePath,
  filename: storePath,
  loaded: true,
  exports: {
    createStore: () => ({
      start: async (a) => { calls.push(['start', a]); return { session_id: 'sess_1' }; },
      createIncident: async (a) => {
        calls.push(['createIncident', a]);
        return storeOverrides.createIncident
          ? storeOverrides.createIncident(a)
          : { success: true, state: 'CREATED', incident_number: 'INC-1' };
      },
      recordPreference: async (a) => { calls.push(['recordPreference', a]); return { success: true, state: 'RECORDED' }; },
      close: async (a) => { calls.push(['close', a]); return { success: true, state: 'CLOSED' }; },
      claimSms: async (a) => {
        calls.push(['claimSms', a]);
        return storeOverrides.claimSms
          ? storeOverrides.claimSms(a)
          : { success: true, destination: '+17025550100', caseNumber: 'INC-1', requestId: 'req_1' };
      },
      recordSms: async (a) => {
        calls.push(['recordSms', a]);
        return storeOverrides.recordSms ? storeOverrides.recordSms(a) : { success: true };
      },
      claimEmail: async (a) => {
        calls.push(['claimEmail', a]);
        return storeOverrides.claimEmail
          ? storeOverrides.claimEmail(a)
          : { success: true, destination: 'tenant@example.com', caseNumber: 'INC-1', requestId: 'req_1' };
      },
      recordEmail: async (a) => {
        calls.push(['recordEmail', a]);
        return storeOverrides.recordEmail ? storeOverrides.recordEmail(a) : { success: true };
      },
      lookupCase: async (a) => {
        calls.push(['lookupCase', a]);
        return storeOverrides.lookupCase
          ? storeOverrides.lookupCase(a)
          : { success: true, caseNumber: 'INC-1', status: 'OPEN', summary: 'Gas smell reported', category: 'gas', priority: 'high', createdAt: '2026-10-27T00:00:00Z' };
      },
    }),
  },
};

// Stub pma-sms so no Twilio is touched.
const smsPath = path.join(__dirname, '../netlify/functions/lib/pma-sms.js');
require.cache[require.resolve(smsPath)] = {
  id: smsPath,
  filename: smsPath,
  loaded: true,
  exports: {
    sendCaseConfirmation: async (a) => {
      calls.push(['sendCaseConfirmation', a]);
      if (smsOverrides.sendCaseConfirmation) return smsOverrides.sendCaseConfirmation(a);
      return { sid: 'SM_test_123' };
    },
    sendStaffNotification: async (a) => {
      calls.push(['sendStaffNotification', a]);
    },
  },
};

// Mutable overrides for email per-test behaviour.
const emailOverrides = {};

// Stub pma-email so no Resend is touched.
const emailPath = path.join(__dirname, '../netlify/functions/lib/pma-email.js');
require.cache[require.resolve(emailPath)] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendCaseConfirmation: async (a) => {
      calls.push(['email_sendCaseConfirmation', a]);
      if (emailOverrides.sendCaseConfirmation) return emailOverrides.sendCaseConfirmation(a);
      return { id: 'RE_test_abc123' };
    },
    sendStaffNotification: async (a) => {
      calls.push(['email_sendStaffNotification', a]);
    },
  },
};

const { handler } = require('../netlify/functions/cedar-elevenlabs.js');

const KEY = 'k'.repeat(48);
const SECRET = 's'.repeat(32);
process.env.PMA_ELEVENLABS_TOOL_KEY = KEY;
process.env.ELEVENLABS_WEBHOOK_SECRET = SECRET;
process.env.PMA_CREATE_DELAY_MS = '0'; // disable processing delay in tests; delay-specific tests override this

const post = (body, headers = {}) => handler({ httpMethod: 'POST', headers, body: JSON.stringify(body), isBase64Encoded: false });

const incidentBody = {
  tool_name: 'create_incident',
  call_sid: 'CA7b66a46003a7f8ae13e3726b47967a1f',
  conversation_id: 'conv_123',
  caller_id: '+17025550100',
  reportedName: 'Test Caller',
  reportedAddress: '1 Test St',
  reportedUnit: '2-25',
  description: 'I smelled gas so I left.',
};

test('flat ElevenLabs tool body with valid key creates incident', async () => {
  calls.length = 0;
  const res = await post(incidentBody, { 'X-PMA-Tool-Key': KEY });
  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.success, true);
  assert.equal(out.incident_number, 'INC-1');
  const start = calls.find((c) => c[0] === 'start')[1];
  assert.deepEqual(start, { call_sid: incidentBody.call_sid, caller_number: '+17025550100' });
  const inc = calls.find((c) => c[0] === 'createIncident')[1];
  assert.equal(inc.session_id, 'sess_1');
  assert.deepEqual(inc.args, { reportedName: 'Test Caller', reportedAddress: '1 Test St', reportedUnit: '2-25', description: 'I smelled gas so I left.' });
});

test('missing or wrong key is rejected with 401', async () => {
  assert.equal((await post(incidentBody)).statusCode, 401);
  assert.equal((await post(incidentBody, { 'x-pma-tool-key': 'x'.repeat(48) })).statusCode, 401);
});

test('close_session with empty parameters routes correctly', async () => {
  calls.length = 0;
  const res = await post({ tool_name: 'close_session', call_sid: 'CA1', conversation_id: 'conv_1', caller_id: '+17025550100' }, { 'x-pma-tool-key': KEY });
  assert.equal(JSON.parse(res.body).state, 'CLOSED');
  assert.ok(calls.some((c) => c[0] === 'close'));
});

test('falls back to conversation_id when call_sid absent', async () => {
  calls.length = 0;
  await post({ ...incidentBody, call_sid: undefined }, { 'x-pma-tool-key': KEY });
  assert.equal(calls.find((c) => c[0] === 'start')[1].call_sid, 'conv_123');
});

test('missing tool_name returns a non-success tool result', async () => {
  const { tool_name, ...rest } = incidentBody;
  const res = await post(rest, { 'x-pma-tool-key': KEY });
  assert.equal(JSON.parse(res.body).success, false);
});

test('legacy signed envelope still works', async () => {
  const body = JSON.stringify({ tool_name: 'close_session', tool_call_id: 'tc_1', parameters: {}, dynamic_variables: { call_sid: 'CA2', session_id: 'sess_9' } });
  const ts = Math.floor(Date.now() / 1000);
  const mac = crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
  const res = await handler({ httpMethod: 'POST', headers: { 'elevenlabs-signature': `t=${ts},v0=${mac}` }, body, isBase64Encoded: false });
  const out = JSON.parse(res.body);
  assert.equal(out.tool_call_id, 'tc_1');
  assert.equal(JSON.parse(out.result).state, 'CLOSED');
});

// ── SMS test cases ──────────────────────────────────────────────────────────

const smsBody = {
  tool_name: 'record_contact_preference',
  call_sid: 'CA_sms_test',
  conversation_id: 'conv_sms_1',
  caller_id: '+17025550100',
  method: 'sms',
  destination: '+17025550100',
  consent: true,
};

test('sms method with PMA_SMS_ENABLED=true sends exactly one text and returns notificationSent true', async () => {
  calls.length = 0;
  delete storeOverrides.claimSms;
  delete smsOverrides.sendCaseConfirmation;
  process.env.PMA_SMS_ENABLED = 'true';
  process.env.PMA_SMS_MESSAGING_SERVICE_SID = 'MG_test';
  const res = await post(smsBody, { 'x-pma-tool-key': KEY });
  delete process.env.PMA_SMS_ENABLED;
  delete process.env.PMA_SMS_MESSAGING_SERVICE_SID;
  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.success, true);
  assert.equal(out.notificationSent, true);
  assert.equal(out.notificationState, 'SENT');
  assert.equal(calls.filter((c) => c[0] === 'sendCaseConfirmation').length, 1);
  assert.ok(calls.some((c) => c[0] === 'recordSms' && c[1].outcome === 'SENT'));
});

test('PMA_SMS_ENABLED not set returns notificationState DISABLED without calling send', async () => {
  calls.length = 0;
  delete storeOverrides.claimSms;
  delete smsOverrides.sendCaseConfirmation;
  delete process.env.PMA_SMS_ENABLED;
  const res = await post(smsBody, { 'x-pma-tool-key': KEY });
  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.success, true);
  assert.equal(out.notificationSent, false);
  assert.equal(out.notificationState, 'DISABLED');
  assert.equal(calls.filter((c) => c[0] === 'sendCaseConfirmation').length, 0);
});

test('email method does not trigger SMS send', async () => {
  calls.length = 0;
  delete smsOverrides.sendCaseConfirmation;
  process.env.PMA_SMS_ENABLED = 'true';
  const emailBody = { ...smsBody, method: 'email', destination: 'test@example.com' };
  const res = await post(emailBody, { 'x-pma-tool-key': KEY });
  delete process.env.PMA_SMS_ENABLED;
  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.success, true);
  assert.equal(calls.filter((c) => c[0] === 'sendCaseConfirmation').length, 0);
  assert.equal(out.notificationSent, false);
});

test('claim returning ALREADY_SENT short-circuits send and returns that state', async () => {
  calls.length = 0;
  storeOverrides.claimSms = async () => ({ success: false, state: 'ALREADY_SENT' });
  delete smsOverrides.sendCaseConfirmation;
  process.env.PMA_SMS_ENABLED = 'true';
  process.env.PMA_SMS_MESSAGING_SERVICE_SID = 'MG_test';
  const res = await post(smsBody, { 'x-pma-tool-key': KEY });
  delete process.env.PMA_SMS_ENABLED;
  delete process.env.PMA_SMS_MESSAGING_SERVICE_SID;
  delete storeOverrides.claimSms;
  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.success, true);
  assert.equal(out.notificationSent, false);
  assert.equal(out.notificationState, 'ALREADY_SENT');
  assert.equal(calls.filter((c) => c[0] === 'sendCaseConfirmation').length, 0);
});

test('Twilio error code 21610 records OPTED_OUT and preference still succeeds', async () => {
  calls.length = 0;
  delete storeOverrides.claimSms;
  smsOverrides.sendCaseConfirmation = async () => {
    throw Object.assign(new Error('OPTED_OUT'), { code: 21610, twilioCode: 21610 });
  };
  process.env.PMA_SMS_ENABLED = 'true';
  process.env.PMA_SMS_MESSAGING_SERVICE_SID = 'MG_test';
  const res = await post(smsBody, { 'x-pma-tool-key': KEY });
  delete process.env.PMA_SMS_ENABLED;
  delete process.env.PMA_SMS_MESSAGING_SERVICE_SID;
  delete smsOverrides.sendCaseConfirmation;
  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.success, true);
  assert.equal(out.notificationSent, false);
  assert.equal(out.notificationState, 'OPTED_OUT');
  assert.ok(calls.some((c) => c[0] === 'recordSms' && c[1].outcome === 'OPTED_OUT'));
});

test('Twilio generic error records FAILED and preference still succeeds', async () => {
  calls.length = 0;
  delete storeOverrides.claimSms;
  smsOverrides.sendCaseConfirmation = async () => {
    throw Object.assign(new Error('network error'), { code: 'ECONNRESET' });
  };
  process.env.PMA_SMS_ENABLED = 'true';
  process.env.PMA_SMS_MESSAGING_SERVICE_SID = 'MG_test';
  const res = await post(smsBody, { 'x-pma-tool-key': KEY });
  delete process.env.PMA_SMS_ENABLED;
  delete process.env.PMA_SMS_MESSAGING_SERVICE_SID;
  delete smsOverrides.sendCaseConfirmation;
  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.success, true);
  assert.equal(out.notificationSent, false);
  assert.equal(out.notificationState, 'FAILED');
  assert.ok(calls.some((c) => c[0] === 'recordSms' && c[1].outcome === 'FAILED'));
});

test('staff notifications fire for maintenance and manager numbers after successful claim', async () => {
  calls.length = 0;
  delete storeOverrides.claimSms;
  delete smsOverrides.sendCaseConfirmation;
  process.env.PMA_SMS_ENABLED = 'true';
  process.env.PMA_SMS_MESSAGING_SERVICE_SID = 'MG_test';
  process.env.PMA_SMS_MAINTENANCE_NUMBER = '+15550000001';
  process.env.PMA_SMS_MANAGER_NUMBER = '+15550000002';
  const res = await post(smsBody, { 'x-pma-tool-key': KEY });
  delete process.env.PMA_SMS_ENABLED;
  delete process.env.PMA_SMS_MESSAGING_SERVICE_SID;
  delete process.env.PMA_SMS_MAINTENANCE_NUMBER;
  delete process.env.PMA_SMS_MANAGER_NUMBER;
  assert.equal(res.statusCode, 200);
  const staffCalls = calls.filter((c) => c[0] === 'sendStaffNotification');
  assert.equal(staffCalls.length, 2);
  const tos = staffCalls.map((c) => c[1].to);
  assert.ok(tos.includes('+15550000001'));
  assert.ok(tos.includes('+15550000002'));
});

// ── Email test cases ─────────────────────────────────────────────────────────

const emailBody = {
  tool_name: 'record_contact_preference',
  call_sid: 'CA_email_test',
  conversation_id: 'conv_email_1',
  caller_id: '+17025550100',
  method: 'email',
  destination: 'tenant@example.com',
  consent: true,
};

test('email method with PMA_EMAIL_ENABLED=true sends confirmation and returns notificationSent true', async () => {
  calls.length = 0;
  delete storeOverrides.claimEmail;
  delete emailOverrides.sendCaseConfirmation;
  process.env.PMA_EMAIL_ENABLED = 'true';
  process.env.RESEND_API_KEY = 're_test_key';
  const res = await post(emailBody, { 'x-pma-tool-key': KEY });
  delete process.env.PMA_EMAIL_ENABLED;
  delete process.env.RESEND_API_KEY;
  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.success, true);
  assert.equal(out.notificationSent, true);
  assert.equal(out.notificationState, 'SENT');
  assert.equal(calls.filter((c) => c[0] === 'email_sendCaseConfirmation').length, 1);
  assert.ok(calls.some((c) => c[0] === 'recordEmail' && c[1].outcome === 'SENT'));
});

test('email method with PMA_EMAIL_ENABLED not set returns notificationState DISABLED', async () => {
  calls.length = 0;
  delete storeOverrides.claimEmail;
  delete emailOverrides.sendCaseConfirmation;
  delete process.env.PMA_EMAIL_ENABLED;
  const res = await post(emailBody, { 'x-pma-tool-key': KEY });
  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.success, true);
  assert.equal(out.notificationSent, false);
  assert.equal(out.notificationState, 'DISABLED');
  assert.equal(calls.filter((c) => c[0] === 'email_sendCaseConfirmation').length, 0);
});

test('email claim returning ALREADY_SENT short-circuits send', async () => {
  calls.length = 0;
  storeOverrides.claimEmail = async () => ({ success: false, state: 'ALREADY_SENT' });
  delete emailOverrides.sendCaseConfirmation;
  process.env.PMA_EMAIL_ENABLED = 'true';
  process.env.RESEND_API_KEY = 're_test_key';
  const res = await post(emailBody, { 'x-pma-tool-key': KEY });
  delete process.env.PMA_EMAIL_ENABLED;
  delete process.env.RESEND_API_KEY;
  delete storeOverrides.claimEmail;
  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.success, true);
  assert.equal(out.notificationSent, false);
  assert.equal(out.notificationState, 'ALREADY_SENT');
  assert.equal(calls.filter((c) => c[0] === 'email_sendCaseConfirmation').length, 0);
});

test('email send failure records FAILED and preference still succeeds', async () => {
  calls.length = 0;
  delete storeOverrides.claimEmail;
  emailOverrides.sendCaseConfirmation = async () => {
    throw Object.assign(new Error('network error'), { code: 'ECONNRESET' });
  };
  process.env.PMA_EMAIL_ENABLED = 'true';
  process.env.RESEND_API_KEY = 're_test_key';
  const res = await post(emailBody, { 'x-pma-tool-key': KEY });
  delete process.env.PMA_EMAIL_ENABLED;
  delete process.env.RESEND_API_KEY;
  delete emailOverrides.sendCaseConfirmation;
  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.success, true);
  assert.equal(out.notificationSent, false);
  assert.equal(out.notificationState, 'FAILED');
  assert.ok(calls.some((c) => c[0] === 'recordEmail' && c[1].outcome === 'FAILED'));
});

test('email staff notifications fire after successful claim', async () => {
  calls.length = 0;
  delete storeOverrides.claimEmail;
  delete emailOverrides.sendCaseConfirmation;
  process.env.PMA_EMAIL_ENABLED = 'true';
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.PMA_EMAIL_MAINTENANCE_ADDRESS = 'maintenance@example.com';
  process.env.PMA_EMAIL_MANAGER_ADDRESS = 'manager@example.com';
  const res = await post(emailBody, { 'x-pma-tool-key': KEY });
  delete process.env.PMA_EMAIL_ENABLED;
  delete process.env.RESEND_API_KEY;
  delete process.env.PMA_EMAIL_MAINTENANCE_ADDRESS;
  delete process.env.PMA_EMAIL_MANAGER_ADDRESS;
  assert.equal(res.statusCode, 200);
  const staffCalls = calls.filter((c) => c[0] === 'email_sendStaffNotification');
  assert.equal(staffCalls.length, 2);
  const tos = staffCalls.map((c) => c[1].to);
  assert.ok(tos.includes('maintenance@example.com'));
  assert.ok(tos.includes('manager@example.com'));
});

// ── get_case_status test cases ───────────────────────────────────────────────

const statusBody = {
  tool_name: 'get_case_status',
  call_sid: 'CA_status_test',
  conversation_id: 'conv_status_1',
  caller_id: '+17025550100',
};

test('get_case_status found by caller ID returns case details', async () => {
  calls.length = 0;
  delete storeOverrides.lookupCase;
  const res = await post(statusBody, { 'x-pma-tool-key': KEY });
  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.success, true);
  assert.equal(out.caseNumber, 'INC-1');
  assert.equal(out.status, 'OPEN');
  const lookup = calls.find((c) => c[0] === 'lookupCase')[1];
  assert.equal(lookup.caller_number, '+17025550100');
  assert.equal(lookup.case_number, null);
});

test('get_case_status passes case_number when caller provides it', async () => {
  calls.length = 0;
  delete storeOverrides.lookupCase;
  const res = await post({ ...statusBody, case_number: 'PMA-ABC123' }, { 'x-pma-tool-key': KEY });
  assert.equal(res.statusCode, 200);
  const lookup = calls.find((c) => c[0] === 'lookupCase')[1];
  assert.equal(lookup.case_number, 'PMA-ABC123');
});

test('get_case_status with invalid caller_id passes null caller_number', async () => {
  calls.length = 0;
  delete storeOverrides.lookupCase;
  const res = await post({ ...statusBody, caller_id: 'not-e164' }, { 'x-pma-tool-key': KEY });
  assert.equal(res.statusCode, 200);
  const lookup = calls.find((c) => c[0] === 'lookupCase')[1];
  assert.equal(lookup.caller_number, null);
});

test('get_case_status MULTIPLE_CASES returns state to Ava', async () => {
  calls.length = 0;
  storeOverrides.lookupCase = async () => ({ success: false, state: 'MULTIPLE_CASES', count: 3 });
  const res = await post(statusBody, { 'x-pma-tool-key': KEY });
  delete storeOverrides.lookupCase;
  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.success, false);
  assert.equal(out.state, 'MULTIPLE_CASES');
  assert.equal(out.count, 3);
});

test('get_case_status NOT_FOUND returns not-found state', async () => {
  calls.length = 0;
  storeOverrides.lookupCase = async () => ({ success: false, state: 'NOT_FOUND' });
  const res = await post(statusBody, { 'x-pma-tool-key': KEY });
  delete storeOverrides.lookupCase;
  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.success, false);
  assert.equal(out.state, 'NOT_FOUND');
});

// ── Language capture ──────────────────────────────────────────────────────────

test('create_incident passes language=es from body to store args', async () => {
  calls.length = 0;
  delete storeOverrides.createIncident;
  const res = await post({ ...incidentBody, language: 'es' }, { 'x-pma-tool-key': KEY });
  assert.equal(res.statusCode, 200);
  const inc = calls.find((c) => c[0] === 'createIncident')[1];
  assert.equal(inc.args.language, 'es');
});

test('create_incident omits language key for unknown locale', async () => {
  calls.length = 0;
  delete storeOverrides.createIncident;
  const res = await post({ ...incidentBody, language: 'fr' }, { 'x-pma-tool-key': KEY });
  assert.equal(res.statusCode, 200);
  const inc = calls.find((c) => c[0] === 'createIncident')[1];
  assert.ok(!Object.prototype.hasOwnProperty.call(inc.args, 'language'));
});

test('sms claim language=es is forwarded to sendCaseConfirmation', async () => {
  calls.length = 0;
  storeOverrides.claimSms = async () => ({ success: true, destination: '+17025550100', caseNumber: 'INC-1', requestId: 'req_1', language: 'es' });
  delete smsOverrides.sendCaseConfirmation;
  process.env.PMA_SMS_ENABLED = 'true';
  process.env.PMA_SMS_MESSAGING_SERVICE_SID = 'MG_test';
  await post(smsBody, { 'x-pma-tool-key': KEY });
  delete process.env.PMA_SMS_ENABLED;
  delete process.env.PMA_SMS_MESSAGING_SERVICE_SID;
  delete storeOverrides.claimSms;
  const smsCall = calls.find((c) => c[0] === 'sendCaseConfirmation');
  assert.ok(smsCall, 'sendCaseConfirmation must have been called');
  assert.equal(smsCall[1].language, 'es');
});

test('email claim language=es is forwarded to sendCaseConfirmation', async () => {
  calls.length = 0;
  storeOverrides.claimEmail = async () => ({ success: true, destination: 'tenant@example.com', caseNumber: 'INC-1', requestId: 'req_1', language: 'es' });
  delete emailOverrides.sendCaseConfirmation;
  process.env.PMA_EMAIL_ENABLED = 'true';
  process.env.RESEND_API_KEY = 're_test_key';
  await post(emailBody, { 'x-pma-tool-key': KEY });
  delete process.env.PMA_EMAIL_ENABLED;
  delete process.env.RESEND_API_KEY;
  delete storeOverrides.claimEmail;
  const emailCall = calls.find((c) => c[0] === 'email_sendCaseConfirmation');
  assert.ok(emailCall, 'email sendCaseConfirmation must have been called');
  assert.equal(emailCall[1].language, 'es');
});

// ── Processing pause ──────────────────────────────────────────────────────────

test('processing delay fires for non-urgent create_incident', async () => {
  calls.length = 0;
  delete storeOverrides.createIncident;
  process.env.PMA_CREATE_DELAY_MS = '150';
  const t0 = Date.now();
  const res = await post(incidentBody, { 'x-pma-tool-key': KEY });
  const elapsed = Date.now() - t0;
  process.env.PMA_CREATE_DELAY_MS = '0';
  assert.equal(res.statusCode, 200);
  assert.ok(elapsed >= 100, `expected >= 100ms delay, got ${elapsed}ms`);
});

test('processing delay is bypassed for urgent create_incident', async () => {
  calls.length = 0;
  storeOverrides.createIncident = async (a) => {
    calls.push(['createIncident', a]);
    return { success: true, state: 'CONFIRMED', caseNumber: 'INC-2', urgentReviewRequired: true };
  };
  process.env.PMA_CREATE_DELAY_MS = '500';
  const t0 = Date.now();
  const res = await post(incidentBody, { 'x-pma-tool-key': KEY });
  const elapsed = Date.now() - t0;
  process.env.PMA_CREATE_DELAY_MS = '0';
  delete storeOverrides.createIncident;
  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.urgentReviewRequired, true);
  assert.ok(elapsed < 400, `expected no delay for urgent, got ${elapsed}ms`);
});

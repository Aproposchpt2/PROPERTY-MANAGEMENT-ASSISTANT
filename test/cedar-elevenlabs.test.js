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
      recordPreference: async (a) => {
        calls.push(['recordPreference', a]);
        if (storeOverrides.recordPreference) return storeOverrides.recordPreference(a);
        return { success: true, state: 'RECORDED' };
      },
      recordFollowupPreference: async (a) => {
        calls.push(['recordFollowupPreference', a]);
        return storeOverrides.recordFollowupPreference
          ? storeOverrides.recordFollowupPreference(a)
          : { success: true, state: 'CONFIRMED', requestId: 'req_9', caseNumber: 'PMA-OLD', language: 'es' };
      },
      recordFollowupResult: async (a) => { calls.push(['recordFollowupResult', a]); return { success: true }; },
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
      issuePortalToken: async (a) => {
        calls.push(['issuePortalToken', a]);
        return storeOverrides.issuePortalToken ? storeOverrides.issuePortalToken(a) : { success: true, exists: false };
      },
    }),
  },
};

// Stub the pma-sms module so no SMS is sent and no Twilio client is loaded.
// Capture the real dedupe helper first: the handler uses it to decide how many
// staff texts to send, so the stub must run the real logic — a copy here would
// only test itself.
const { dedupePhoneNumbers } = require('../netlify/functions/lib/pma-sms.js');
const smsPath = path.join(__dirname, '../netlify/functions/lib/pma-sms.js');
require.cache[require.resolve(smsPath)] = {
  id: smsPath,
  filename: smsPath,
  loaded: true,
  exports: {
    sendCaseConfirmation: async (a) => {
      calls.push(['sendCaseConfirmation', a]);
      return smsOverrides.sendCaseConfirmation ? smsOverrides.sendCaseConfirmation(a) : { sid: 'SM_claim' };
    },
    sendStaffNotification: async (a) => { calls.push(['sendStaffNotification', a]); },
    sendEmergencyEscalation: async (a) => { calls.push(['sendEmergencyEscalation', a]); },
    dedupePhoneNumbers,
  },
};

// Stub the pma-email module.
const emailPath = path.join(__dirname, '../netlify/functions/lib/pma-email.js');
require.cache[require.resolve(emailPath)] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendCaseConfirmation: async (a) => {
      calls.push(['sendCaseConfirmation', a]);
      return smsOverrides.sendCaseConfirmation ? smsOverrides.sendCaseConfirmation(a) : { id: 'email_claim' };
    },
    sendStaffNotification: async (a) => { calls.push(['sendStaffNotification', a]); },
  },
};

const { handler } = require('../netlify/functions/cedar-elevenlabs.js');
const KEY = 'a'.repeat(32);

// POST the flat tool body ElevenLabs sends: top-level tool_name, call_sid,
// caller_id, and the tool's own fields as top-level parameters.
async function post(body, headers = {}) {
  const res = await handler({
    httpMethod: 'POST',
    body: JSON.stringify(body),
    headers: { 'x-pma-tool-key': KEY, ...headers },
  });
  assert.equal(res.statusCode, 200);
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
}

const incidentBody = {
  tool_name: 'create_incident',
  call_sid: 'CA_123',
  caller_id: '+17025550100',
  reportedName: 'Jane Doe',
  reportedAddress: '100 Main St',
  reportedUnit: 'Unit 5',
  description: 'Gas smell in the kitchen',
};

const smsBody = {
  tool_name: 'record_contact_preference',
  call_sid: 'CA_sms_test',
  caller_id: '+17025550100',
  method: 'sms',
  destination: '+17025550100',
  consent: true,
};

const emailBody = {
  tool_name: 'record_contact_preference',
  call_sid: 'CA_email_test',
  caller_id: '+17025550100',
  method: 'email',
  destination: 'tenant@example.com',
  consent: true,
};

const followupBody = {
  tool_name: 'record_contact_preference',
  call_sid: 'CA_followup_test',
  caller_id: '+17025550100',
  method: 'sms',
  destination: '+17025550100',
  consent: true,
  case_number: 'PMA-OLD',
};

const followupBodyEmail = {
  tool_name: 'record_contact_preference',
  call_sid: 'CA_followup_email',
  caller_id: '+17025550100',
  method: 'email',
  destination: 'tenant@example.com',
  consent: true,
  case_number: 'PMA-OLD',
};

test('create_incident success stores the case and returns reply', async () => {
  calls.length = 0;
  const res = await post(incidentBody);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.incident_number, 'INC-1');
  assert.equal(res.body.state, 'CREATED');
  const start = calls.find(c => c[0] === 'start');
  assert.deepEqual(start[1], { call_sid: 'CA_123', caller_number: '+17025550100' });
  const incident = calls.find(c => c[0] === 'createIncident');
  assert.deepEqual(incident[1], {
    session_id: 'sess_1',
    call_sid: 'CA_123',
    args: {
      reportedName: 'Jane Doe',
      reportedAddress: '100 Main St',
      reportedUnit: 'Unit 5',
      description: 'Gas smell in the kitchen',
    },
  });
});

test('create_incident urgentReviewRequired returns the flag', async () => {
  storeOverrides.createIncident = async () => ({
    success: true,
    state: 'CREATED',
    incident_number: 'INC-EMR-1',
    urgentReviewRequired: true,
    reply: 'Help is on the way.',
  });
  const res = await post(incidentBody);
  assert.equal(res.body.success, true);
  assert.equal(res.body.incident_number, 'INC-EMR-1');
  assert.equal(res.body.urgentReviewRequired, true);
  delete storeOverrides.createIncident;
});

test('emergency escalation fires sendEmergencyEscalation to both staff numbers when urgentReviewRequired', async () => {
  calls.length = 0;
  process.env.PMA_SMS_ENABLED = 'true';
  process.env.PMA_SMS_MAINTENANCE_NUMBER = '+17025550201';
  process.env.PMA_SMS_MANAGER_NUMBER = '+17025550202';
  storeOverrides.createIncident = async () => ({
    success: true,
    state: 'CREATED',
    caseNumber: 'INC-EMR-1',
    urgentReviewRequired: true,
    reply: 'Help is on the way.',
  });
  const res = await post(incidentBody, { 'x-pma-tool-key': KEY });
  await new Promise(r => setImmediate(r));
  assert.equal(res.statusCode, 200);
  const escalations = calls.filter(c => c[0] === 'sendEmergencyEscalation');
  assert.equal(escalations.length, 2, 'escalation must go to maintenance and manager numbers');
  assert.deepEqual(escalations.map(c => c[1].to), ['+17025550201', '+17025550202']);
  assert.equal(escalations[0][1].caseNumber, 'INC-EMR-1');
  delete storeOverrides.createIncident;
  delete process.env.PMA_SMS_ENABLED;
  delete process.env.PMA_SMS_MAINTENANCE_NUMBER;
  delete process.env.PMA_SMS_MANAGER_NUMBER;
});

test('emergency escalation fires once when maintenance and manager numbers are the same', async () => {
  calls.length = 0;
  process.env.PMA_SMS_ENABLED = 'true';
  process.env.PMA_SMS_MAINTENANCE_NUMBER = '+17025550201';
  process.env.PMA_SMS_MANAGER_NUMBER = '+17025550201';
  storeOverrides.createIncident = async () => ({
    success: true,
    state: 'CREATED',
    caseNumber: 'INC-EMR-1',
    urgentReviewRequired: true,
    reply: 'Help is on the way.',
  });
  const res = await post(incidentBody, { 'x-pma-tool-key': KEY });
  assert.equal(res.statusCode, 200);
  const escalations = calls.filter(c => c[0] === 'sendEmergencyEscalation');
  assert.equal(escalations.length, 1, 'the same number in both variables must get one emergency text, not two');
  assert.equal(escalations[0][1].to, '+17025550201');
  delete storeOverrides.createIncident;
  delete process.env.PMA_SMS_ENABLED;
  delete process.env.PMA_SMS_MAINTENANCE_NUMBER;
  delete process.env.PMA_SMS_MANAGER_NUMBER;
});

test('emergency escalation fires once when the two numbers are formatting variants of the same number', async () => {
  calls.length = 0;
  process.env.PMA_SMS_ENABLED = 'true';
  process.env.PMA_SMS_MAINTENANCE_NUMBER = '+1 702-555-0201';
  process.env.PMA_SMS_MANAGER_NUMBER = '17025550201';
  storeOverrides.createIncident = async () => ({
    success: true,
    state: 'CREATED',
    caseNumber: 'INC-EMR-1',
    urgentReviewRequired: true,
    reply: 'Help is on the way.',
  });
  const res = await post(incidentBody, { 'x-pma-tool-key': KEY });
  assert.equal(res.statusCode, 200);
  const escalations = calls.filter(c => c[0] === 'sendEmergencyEscalation');
  assert.equal(escalations.length, 1, 'formatting variants of the same number must get one emergency text, not two');
  delete storeOverrides.createIncident;
  delete process.env.PMA_SMS_ENABLED;
  delete process.env.PMA_SMS_MAINTENANCE_NUMBER;
  delete process.env.PMA_SMS_MANAGER_NUMBER;
});

test('get_case_status returns scheduled times in the property timezone', async () => {
  storeOverrides.lookupCase = async () => ({
    success: true,
    caseNumber: 'INC-1',
    status: 'OPEN',
    summary: 'Gas smell reported',
    category: 'gas',
    priority: 'high',
    createdAt: '2026-10-27T00:00:00Z',
    scheduledStart: '2026-10-28T16:00:00Z',
    scheduledEnd: '2026-10-28T19:00:00Z',
    propertyTimezone: 'America/Los_Angeles',
  });
  const res = await post({
    tool_name: 'get_case_status',
    call_sid: 'CA_status',
    caller_id: '+17025550100',
    case_number: 'INC-1',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.caseNumber, 'INC-1');
  assert.equal(res.body.scheduledStartLocal, '9 AM');
  assert.equal(res.body.scheduledEndLocal, '12 PM');
  assert.match(res.body.scheduledDayLocal, /Wednesday/);
  assert.equal(res.body.caseNumberSpoken, 'I, N, C, dash, 1');
  delete storeOverrides.lookupCase;
});

test('get_case_status success includes the case number spelled for read-back', async () => {
  const res = await post({
    tool_name: 'get_case_status',
    call_sid: 'CA_status',
    caller_id: '+17025550100',
    case_number: 'INC-1',
  });
  assert.equal(res.body.success, true);
  assert.equal(res.body.caseNumber, 'INC-1');
  assert.equal(res.body.caseNumberSpoken, 'I, N, C, dash, 1');
});

test('get_case_status with missing caller returns NOT_FOUND', async () => {
  storeOverrides.lookupCase = async () => ({ success: false, state: 'NOT_FOUND' });
  const res = await post({
    tool_name: 'get_case_status',
    call_sid: 'CA_status2',
    caller_id: '',
    case_number: 'INC-1',
  });
  assert.equal(res.body.success, false);
  assert.equal(res.body.state, 'NOT_FOUND');
  delete storeOverrides.lookupCase;
});

test('close_session closes the session', async () => {
  calls.length = 0;
  const res = await post({
    tool_name: 'close_session',
    call_sid: 'CA_close',
    caller_id: '+17025550100',
  });
  assert.equal(res.body.success, true);
  assert.equal(res.body.state, 'CLOSED');
  assert.ok(calls.some(c => c[0] === 'close'));
});

test('unauthenticated request is rejected with 401', async () => {
  const res = await handler({
    httpMethod: 'POST',
    body: JSON.stringify(incidentBody),
    headers: {},
  });
  assert.equal(res.statusCode, 401);
});

test('non-POST method returns 405', async () => {
  const res = await handler({
    httpMethod: 'GET',
    body: '',
    headers: {},
  });
  assert.equal(res.statusCode, 405);
});

test('invalid JSON body returns 400', async () => {
  const res = await handler({
    httpMethod: 'POST',
    body: '{invalid json',
    headers: { 'x-pma-tool-key': KEY },
  });
  assert.equal(res.statusCode, 400);
});

test('unknown tool returns UNSUPPORTED_TOOL', async () => {
  const res = await post({
    tool_name: 'do_something_else',
    call_sid: 'CA_unknown',
    caller_id: '+17025550100',
  });
  assert.equal(res.body.success, false);
  assert.equal(res.body.state, 'UNSUPPORTED_TOOL');
});

test('session_id is created lazily via start when not provided', async () => {
  calls.length = 0;
  const res = await post({
    tool_name: 'create_incident',
    call_sid: 'CA_lazy',
    caller_id: '+17025550100',
    reportedName: 'Lazy Session',
    reportedAddress: '1 Lazy Ln',
    description: 'Test lazy init',
  });
  assert.equal(res.body.success, true);
  const start = calls.find(c => c[0] === 'start');
  assert.deepEqual(start[1], { call_sid: 'CA_lazy', caller_number: '+17025550100' });
});

test('sms method with PMA_SMS_ENABLED=false records DISABLED without sending', async () => {
  calls.length = 0;
  delete process.env.PMA_SMS_ENABLED;
  const res = await post(smsBody, { 'x-pma-tool-key': KEY });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.notificationSent, false);
  assert.equal(res.body.notificationState, 'DISABLED');
  assert.ok(!calls.some(c => c[0] === 'sendCaseConfirmation'), 'no confirmation should be sent when disabled');
});

test('sms method with enabled flag sends exactly one text and records SENT', async () => {
  calls.length = 0;
  process.env.PMA_SMS_ENABLED = 'true';
  const res = await post(smsBody, { 'x-pma-tool-key': KEY });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.notificationSent, true);
  assert.equal(res.body.notificationState, 'SENT');
  const confirmations = calls.filter(c => c[0] === 'sendCaseConfirmation');
  assert.equal(confirmations.length, 1, 'exactly one confirmation SMS must be sent');
  assert.equal(confirmations[0][1].to, '+17025550100');
  assert.equal(confirmations[0][1].caseNumber, 'INC-1');
  const record = calls.find(c => c[0] === 'recordSms');
  assert.equal(record[1].outcome, 'SENT');
  delete process.env.PMA_SMS_ENABLED;
});

test('sms method with OPTED_OUT tenant records OPTED_OUT and does not throw', async () => {
  calls.length = 0;
  process.env.PMA_SMS_ENABLED = 'true';
  smsOverrides.sendCaseConfirmation = async () => { throw Object.assign(new Error('OPTED_OUT'), { code: 21610 }); };
  const res = await post(smsBody, { 'x-pma-tool-key': KEY });
  assert.equal(res.body.notificationSent, false);
  assert.equal(res.body.notificationState, 'OPTED_OUT');
  const record = calls.find(c => c[0] === 'recordSms');
  assert.equal(record[1].outcome, 'OPTED_OUT');
  delete smsOverrides.sendCaseConfirmation;
  delete process.env.PMA_SMS_ENABLED;
});

test('sms method sends confirmation when claimSms returns a different destination than caller', async () => {
  calls.length = 0;
  process.env.PMA_SMS_ENABLED = 'true';
  storeOverrides.claimSms = async () => ({ success: true, destination: '+17025550999', caseNumber: 'INC-2', requestId: 'req_2' });
  const res = await post(smsBody, { 'x-pma-tool-key': KEY });
  assert.equal(res.body.notificationSent, true);
  const confirmations = calls.filter(c => c[0] === 'sendCaseConfirmation');
  assert.equal(confirmations[0][1].to, '+17025550999');
  delete storeOverrides.claimSms;
  delete process.env.PMA_SMS_ENABLED;
});

test('sms method own-line guard redirects PMA line to caller number', async () => {
  calls.length = 0;
  process.env.PMA_SMS_ENABLED = 'true';
  storeOverrides.claimSms = async () => ({ success: true, destination: '+17025550100', caseNumber: 'INC-3', requestId: 'req_3' });
  const ownLineBody = {
    ...smsBody,
    destination: '+17252010584', // PMA's own line — must never be texted
  };
  const res = await post(ownLineBody, { 'x-pma-tool-key': KEY });
  assert.equal(res.body.notificationSent, true);
  const confirmations = calls.filter(c => c[0] === 'sendCaseConfirmation');
  assert.equal(confirmations[0][1].to, '+17025550100', 'own line must be replaced with caller number');
  delete storeOverrides.claimSms;
  delete process.env.PMA_SMS_ENABLED;
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
  assert.equal(res.body.notificationSent, true);
  const staffCalls = calls.filter(c => c[0] === 'sendStaffNotification');
  assert.equal(staffCalls.length, 2);
  assert.deepEqual(staffCalls.map(c => c[1].to), ['+15550000001', '+15550000002']);
  assert.equal(staffCalls[0][1].caseNumber, 'INC-1');
});

test('staff notification fires once when maintenance and manager numbers are the same', async () => {
  calls.length = 0;
  delete storeOverrides.claimSms;
  delete smsOverrides.sendCaseConfirmation;
  process.env.PMA_SMS_ENABLED = 'true';
  process.env.PMA_SMS_MESSAGING_SERVICE_SID = 'MG_test';
  process.env.PMA_SMS_MAINTENANCE_NUMBER = '+17025550201';
  process.env.PMA_SMS_MANAGER_NUMBER = '+17025550201';
  const res = await post(smsBody, { 'x-pma-tool-key': KEY });
  delete process.env.PMA_SMS_ENABLED;
  delete process.env.PMA_SMS_MESSAGING_SERVICE_SID;
  delete process.env.PMA_SMS_MAINTENANCE_NUMBER;
  delete process.env.PMA_SMS_MANAGER_NUMBER;
  assert.equal(res.statusCode, 200);
  const staffCalls = calls.filter(c => c[0] === 'sendStaffNotification');
  assert.equal(staffCalls.length, 1, 'the same number in both variables must get one staff text, not two');
  assert.equal(staffCalls[0][1].to, '+17025550201');
  assert.equal(calls.filter(c => c[0] === 'sendCaseConfirmation').length, 1, 'the tenant confirmation must still send exactly once');
});

test('staff notification fires once when the two numbers are formatting variants of the same number', async () => {
  calls.length = 0;
  delete storeOverrides.claimSms;
  delete smsOverrides.sendCaseConfirmation;
  process.env.PMA_SMS_ENABLED = 'true';
  process.env.PMA_SMS_MESSAGING_SERVICE_SID = 'MG_test';
  process.env.PMA_SMS_MAINTENANCE_NUMBER = '+1 702-555-0201';
  process.env.PMA_SMS_MANAGER_NUMBER = '(702) 555-0201';
  const res = await post(smsBody, { 'x-pma-tool-key': KEY });
  delete process.env.PMA_SMS_ENABLED;
  delete process.env.PMA_SMS_MESSAGING_SERVICE_SID;
  delete process.env.PMA_SMS_MAINTENANCE_NUMBER;
  delete process.env.PMA_SMS_MANAGER_NUMBER;
  assert.equal(res.statusCode, 200);
  const staffCalls = calls.filter(c => c[0] === 'sendStaffNotification');
  assert.equal(staffCalls.length, 1, 'formatting variants of the same number must get one staff text, not two');
});

test('email method sends tenant email and staff emails', async () => {
  calls.length = 0;
  process.env.PMA_EMAIL_ENABLED = 'true';
  const res = await post(emailBody, { 'x-pma-tool-key': KEY });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.notificationSent, true);
  assert.equal(res.body.notificationState, 'SENT');
  assert.equal(calls.filter(c => c[0] === 'sendCaseConfirmation').length, 1);
  assert.equal(calls.filter(c => c[0] === 'sendStaffNotification').length, 2);
  delete process.env.PMA_EMAIL_ENABLED;
});

test('follow-up sms with no incident on this call returns followupContact result', async () => {
  calls.length = 0;
  storeOverrides.recordPreference = async () => { throw Object.assign(new Error('PMA_RPC_42501'), { code: '42501' }); };
  const res = await post(followupBody);
  assert.equal(res.body.success, true);
  assert.equal(res.body.state, 'CONFIRMED');
  assert.equal(res.body.notificationSent, false, 'sms disabled so no confirmation should be sent');
  delete storeOverrides.recordPreference;
});

test('follow-up sms sends confirmation to the tenant when enabled', async () => {
  calls.length = 0;
  process.env.PMA_SMS_ENABLED = 'true';
  storeOverrides.recordPreference = async () => { throw Object.assign(new Error('PMA_RPC_42501'), { code: '42501' }); };
  const res = await post(followupBody);
  assert.equal(res.body.success, true);
  assert.equal(res.body.notificationSent, true);
  assert.equal(res.body.notificationState, 'SENT');
  const confirmations = calls.filter(c => c[0] === 'sendCaseConfirmation');
  assert.equal(confirmations.length, 1, 'exactly one follow-up confirmation must be sent');
  assert.equal(confirmations[0][1].to, '+17025550100');
  assert.equal(confirmations[0][1].caseNumber, 'PMA-OLD');
  assert.equal(confirmations[0][1].language, 'es');
  assert.equal(confirmations[0][1].portalLink, 'https://pma.stellaruc.com/status?t=portal_token_123');
  assert.ok(!calls.some(c => c[0] === 'sendStaffNotification'), 'follow-up must NOT notify staff again');
  delete storeOverrides.recordPreference;
  delete process.env.PMA_SMS_ENABLED;
});

test('follow-up email sends confirmation to the tenant when enabled', async () => {
  calls.length = 0;
  process.env.PMA_EMAIL_ENABLED = 'true';
  storeOverrides.recordPreference = async () => { throw Object.assign(new Error('PMA_RPC_42501'), { code: '42501' }); };
  const res = await post(followupBodyEmail);
  assert.equal(res.body.success, true);
  assert.equal(res.body.notificationSent, true);
  assert.equal(res.body.notificationState, 'SENT');
  assert.equal(calls.filter(c => c[0] === 'sendCaseConfirmation').length, 1);
  delete storeOverrides.recordPreference;
  delete process.env.PMA_EMAIL_ENABLED;
});

test('ElevenLabs signature verification rejects a bad signature', async () => {
  const res = await handler({
    httpMethod: 'POST',
    body: JSON.stringify(incidentBody),
    headers: { 'elevenlabs-signature': 't=1234567890,v0=badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbad' },
  });
  assert.equal(res.statusCode, 401);
});

test('ElevenLabs signature verification accepts a valid signature', async () => {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  const body = JSON.stringify(incidentBody);
  const ts = Math.floor(Date.now() / 1000);
  const mac = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  const res = await handler({
    httpMethod: 'POST',
    body,
    headers: { 'elevenlabs-signature': `t=${ts},v0=${mac}` },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).success, true);
});

test('valid signature overrides missing tool key', async () => {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  const body = JSON.stringify(incidentBody);
  const ts = Math.floor(Date.now() / 1000);
  const mac = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  const res = await handler({
    httpMethod: 'POST',
    body,
    headers: { 'elevenlabs-signature': `t=${ts},v0=${mac}` },
  });
  assert.equal(res.statusCode, 200);
});

test('stale signature is rejected', async () => {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  const body = JSON.stringify(incidentBody);
  const ts = Math.floor(Date.now() / 1000) - 301;
  const mac = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  const res = await handler({
    httpMethod: 'POST',
    body,
    headers: { 'elevenlabs-signature': `t=${ts},v0=${mac}` },
  });
  assert.equal(res.statusCode, 401);
});

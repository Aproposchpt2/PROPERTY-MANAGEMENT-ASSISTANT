'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ── Twilio stub ──────────────────────────────────────────────────────────────
const twilioMessages = [];
let twilioShouldFail = false;
let twilioShouldTimeout = false;

require.cache[require.resolve('twilio')] = {
  id: 'twilio',
  filename: 'twilio',
  loaded: true,
  exports: function twilio() {
    return {
      messages: {
        create: async (params) => {
          twilioMessages.push(params);
          if (twilioShouldTimeout) {
            await new Promise(r => setTimeout(r, 10000));
          }
          if (twilioShouldFail) {
            throw Object.assign(new Error('TWILIO_ERROR'), { code: 20003 });
          }
          return { sid: 'SM_test_' + Date.now() };
        },
      },
    };
  },
};

const { sendEmergencyEscalation, sendStaffNotification } = require('../netlify/functions/lib/pma-sms.js');

const baseEnv = {
  TWILIO_ACCOUNT_SID: 'ACtest',
  TWILIO_AUTH_TOKEN: 'auth_test',
  PMA_SMS_MESSAGING_SERVICE_SID: 'MG_test',
};

// Reset helpers before each test
function reset() {
  twilioMessages.length = 0;
  twilioShouldFail = false;
  twilioShouldTimeout = false;
}

// ── sendEmergencyEscalation ──────────────────────────────────────────────────

test('sendEmergencyEscalation sends SMS to the given number with 🚨 prefix', async () => {
  reset();
  await sendEmergencyEscalation({
    to: '+17025550999',
    caseNumber: 'INC-EMR-1',
    address: '100 Main St',
    description: 'Gas smell on floor 3',
    callerPhone: '+17025550100',
    env: baseEnv,
  });
  assert.equal(twilioMessages.length, 1);
  const msg = twilioMessages[0];
  assert.equal(msg.to, '+17025550999');
  assert.match(msg.body, /🚨 EMERGENCY/, 'body must start with emergency marker');
  assert.match(msg.body, /INC-EMR-1/, 'body must include case number');
  assert.match(msg.body, /100 Main St/, 'body must include address');
  assert.match(msg.body, /Gas smell on floor 3/, 'body must include description');
  assert.match(msg.body, /\+17025550100/, 'body must include caller phone');
});

test('sendEmergencyEscalation truncates description to 120 chars', async () => {
  reset();
  const longDesc = 'A'.repeat(200);
  await sendEmergencyEscalation({
    to: '+17025550999',
    caseNumber: 'INC-EMR-2',
    description: longDesc,
    env: baseEnv,
  });
  assert.equal(twilioMessages.length, 1);
  const body = twilioMessages[0].body;
  // Description in the message body must not exceed 120 chars of the original
  assert.match(body, /A{120}(?!A)/, 'description should be capped at 120 chars');
});

test('sendEmergencyEscalation is best-effort: does not throw on Twilio error', async () => {
  reset();
  twilioShouldFail = true;
  await assert.doesNotReject(
    () => sendEmergencyEscalation({ to: '+17025550999', caseNumber: 'INC-EMR-3', env: baseEnv }),
    'sendEmergencyEscalation must never throw'
  );
});

test('sendEmergencyEscalation is a no-op when `to` is falsy', async () => {
  reset();
  await sendEmergencyEscalation({ to: null, caseNumber: 'INC-EMR-4', env: baseEnv });
  assert.equal(twilioMessages.length, 0, 'no SMS should be sent when to is null');
});

test('sendEmergencyEscalation is a no-op when SMS creds are absent', async () => {
  reset();
  await sendEmergencyEscalation({
    to: '+17025550999',
    caseNumber: 'INC-EMR-5',
    env: { TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 'auth' }, // no messaging service or from number
  });
  assert.equal(twilioMessages.length, 0, 'no SMS should be sent when creds are absent');
});

test('sendEmergencyEscalation uses FROM number when messaging service SID is absent', async () => {
  reset();
  await sendEmergencyEscalation({
    to: '+17025550999',
    caseNumber: 'INC-EMR-6',
    env: { ...baseEnv, PMA_SMS_MESSAGING_SERVICE_SID: undefined, PMA_SMS_FROM_NUMBER: '+17025550000' },
  });
  assert.equal(twilioMessages.length, 1);
  assert.equal(twilioMessages[0].from, '+17025550000');
  assert.equal(twilioMessages[0].messagingServiceSid, undefined);
});

test('sendEmergencyEscalation omits optional fields gracefully when not provided', async () => {
  reset();
  await sendEmergencyEscalation({
    to: '+17025550999',
    caseNumber: 'INC-EMR-7',
    env: baseEnv,
    // no address, description, or callerPhone
  });
  assert.equal(twilioMessages.length, 1);
  const body = twilioMessages[0].body;
  assert.match(body, /INC-EMR-7/);
  assert.doesNotMatch(body, /undefined/);
  assert.doesNotMatch(body, /null/);
});

// ── sendStaffNotification (regression) ──────────────────────────────────────

test('sendStaffNotification sends generic new-case message', async () => {
  reset();
  await sendStaffNotification({ to: '+17025550201', caseNumber: 'INC-100', env: baseEnv });
  assert.equal(twilioMessages.length, 1);
  const body = twilioMessages[0].body;
  assert.match(body, /INC-100/);
  assert.doesNotMatch(body, /🚨/, 'staff notification must NOT use emergency formatting');
});

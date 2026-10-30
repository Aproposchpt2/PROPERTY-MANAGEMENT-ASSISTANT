'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { handler, _test } = require('../netlify/functions/pma-intake');

const headers = { origin: 'https://pma.stellaruc.com', host: 'pma.stellaruc.com' };
const valid = {
  name: 'Ana Ruiz', businessName: 'Desert Ridge Apartments', phone: '(702) 555-0142',
  email: 'Ana@Example.com', smsConsent: true, clientToken: 'abc12345-token',
};
const post = (body, h = headers) => handler({ httpMethod: 'POST', headers: h, body: JSON.stringify(body) });

let sent;
beforeEach(() => {
  sent = [];
  process.env.RESEND_API_KEY = 're_test';
  process.env.RESEND_FROM_EMAIL = 'Stellar <noreply@stellaruc.com>';
  delete process.env.PMA_INTAKE_TO_EMAIL;
  delete process.env.OWNER_NOTIFICATION_EMAIL;
  global.fetch = async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 200 }; };
});

test('valid submission emails the owner and succeeds', async () => {
  const res = await post(valid);
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.resend.com/emails');
  assert.deepEqual(sent[0].body.to, ['jmitchell@aproposgroupllc.com']);
  assert.equal(sent[0].body.reply_to, 'ana@example.com');
  assert.match(sent[0].body.subject, /Desert Ridge Apartments/);
  assert.match(sent[0].body.text, /Phone: \+17025550142/);
  assert.match(sent[0].body.text, /SMS consent: Yes/);
});

test('rejects cross-origin and non-POST requests', async () => {
  assert.equal((await post(valid, { origin: 'https://evil.example', host: 'pma.stellaruc.com' })).statusCode, 403);
  assert.equal((await handler({ httpMethod: 'GET', headers })).statusCode, 405);
  assert.equal(sent.length, 0);
});

test('validates required fields', async () => {
  assert.equal((await post({ ...valid, name: ' ' })).statusCode, 400);
  assert.equal((await post({ ...valid, businessName: '' })).statusCode, 400);
  assert.equal((await post({ ...valid, phone: 'call me' })).statusCode, 400);
  assert.equal((await post({ ...valid, email: 'nope' })).statusCode, 400);
  assert.equal((await post({ ...valid, clientToken: 'x' })).statusCode, 400);
  assert.equal(sent.length, 0);
});

test('honeypot submissions are accepted silently without email', async () => {
  const res = await post({ ...valid, website: 'spam.example' });
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 0);
});

test('fails honestly when email cannot be sent', async () => {
  global.fetch = async () => ({ ok: false, status: 422 });
  assert.equal((await post(valid)).statusCode, 500);
  delete process.env.RESEND_API_KEY;
  assert.equal((await post(valid)).statusCode, 500);
});

test('phone normalization matches stellaruc.com intake', () => {
  assert.equal(_test.normalizePhone('702-555-0142'), '+17025550142');
  assert.equal(_test.normalizePhone('1 702 555 0142'), '+17025550142');
  assert.equal(_test.normalizePhone('+44 20 7946 0958'), '+442079460958');
  assert.equal(_test.normalizePhone('abc'), null);
});

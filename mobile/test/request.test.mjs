import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactError, detailsError, normalizePhone, statusTokenFrom } from '../src/lib/request.ts';

const ok = { description: 'Sink leaking', name: 'Dana Ruiz', address: '1200 Desert Palm Dr', unit: '14B' };

test('details: all four fields required, same minimums as the server', () => {
  assert.equal(detailsError(ok), null);
  assert.match(detailsError({ ...ok, description: 'x' }), /Describe/);
  assert.match(detailsError({ ...ok, name: 'D' }), /name/);
  assert.match(detailsError({ ...ok, address: '12' }), /address/);
  assert.match(detailsError({ ...ok, unit: '  ' }), /unit/);
});

test('phone: US/Canada only, same rule as the server', () => {
  assert.equal(normalizePhone('(702) 555-0100'), '+17025550100');
  assert.equal(normalizePhone('1 702 555 0100'), '+17025550100');
  assert.equal(normalizePhone('+44 7700 900123'), null);
  assert.equal(normalizePhone('555-0100'), null);
});

test('contact: phone, email when chosen, and consent', () => {
  assert.equal(contactError('7025550100', 'sms', '', true), null);
  assert.match(contactError('123', 'sms', '', true), /mobile/);
  assert.match(contactError('7025550100', 'email', 'nope', true), /email/);
  assert.equal(contactError('7025550100', 'email', 'a@b.co', true), null);
  assert.match(contactError('7025550100', 'sms', '', false), /Agree/);
});

test('status token from the server is checked before use', () => {
  assert.equal(statusTokenFrom({ statusToken: 'AbCdEfGhIjKlMnOpQrSt_-' }), 'AbCdEfGhIjKlMnOpQrSt_-');
  assert.equal(statusTokenFrom({ statusToken: null }), null);
  assert.equal(statusTokenFrom({ statusToken: '../../x' }), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterCases, formatMoney, hourLabel, needsApproval, nextDays, savedMessage, visitWindow, windowAvailable, eventLabel,
} from '../src/lib/cases.ts';

const c = (id, approvalState = null, status = 'Assigned') => ({ id, caseNumber: id, createdAt: '', updatedAt: null, priority: 'normal', status, approvalState });

test('approval filter shows only pending cost approvals', () => {
  const list = [c('a', 'PENDING'), c('b', 'APPROVED'), c('c'), c('d', 'PENDING', 'Scheduled')];
  assert.deepEqual(filterCases(list, 'Approval').map(x => x.id), ['a', 'd']);
  assert.equal(needsApproval({ approvalState: 'NOT_REQUIRED' }), false);
});

test('visit days start today and run 7 days at local midnight', () => {
  const now = new Date(2026, 10, 8, 15, 30);
  const days = nextDays(now);
  assert.equal(days.length, 7);
  assert.equal(days[0].getDate(), 8);
  assert.equal(days[0].getHours(), 0);
  assert.equal(days[6].getDate(), 14);
  assert.equal(nextDays(new Date(2026, 11, 30))[3].getMonth(), 0); // crosses into January
});

test('visit window is two local hours and past windows are unavailable', () => {
  const day = new Date(2026, 10, 9);
  const w = visitWindow(day, 14);
  assert.equal(new Date(w.end) - new Date(w.start), 2 * 3600 * 1000);
  assert.equal(new Date(w.start).getHours(), 14);
  const now = new Date(2026, 10, 9, 13, 0);
  assert.equal(windowAvailable(day, 10, now), false); // 10–12 already over
  assert.equal(windowAvailable(day, 12, now), true);  // 12–2 still running
  assert.equal(windowAvailable(new Date(2026, 10, 10), 8, now), true);
});

test('labels', () => {
  assert.equal(hourLabel(8), '8am');
  assert.equal(hourLabel(12), '12pm');
  assert.equal(hourLabel(16), '4pm');
  assert.equal(formatMoney(450), '$450.00');
  assert.equal(formatMoney(null), '');
  assert.equal(eventLabel('resident_update_sent'), 'Update sent to resident');
});

test('save messages say whether the resident was messaged', () => {
  assert.equal(savedMessage(false), 'Case updated.');
  assert.match(savedMessage(true), /status page/);
  assert.match(savedMessage(true, { state: 'SENT', method: 'sms' }), /by text/);
  assert.match(savedMessage(true, { state: 'SENT', method: 'email' }), /by email/);
  assert.match(savedMessage(true, { state: 'OPTED_OUT', method: 'sms' }), /opted out/);
  assert.match(savedMessage(true, { state: 'DISABLED', method: 'sms' }), /turned off/);
  assert.match(savedMessage(true, { state: 'FAILED', method: 'email' }), /could not be sent/);
});

test('notification tap opens only a well-formed case id', async () => {
  const { notificationCaseId } = await import('../src/lib/cases.ts');
  assert.equal(notificationCaseId({ requestId: '3f2b8c1e-9a4d-4e2b-8f6a-1c2d3e4f5a6b', kind: 'emergency' }), '3f2b8c1e-9a4d-4e2b-8f6a-1c2d3e4f5a6b');
  assert.equal(notificationCaseId({ requestId: '../../admin' }), null);
  assert.equal(notificationCaseId({ kind: 'test' }), null);
  assert.equal(notificationCaseId(null), null);
  assert.equal(notificationCaseId('x'), null);
});

test('waiting statuses show as In Progress on the resident tracker', async () => {
  const { statusStep } = await import('../src/lib/cases.ts');
  for (const s of ['Waiting on Parts', 'Waiting on Tenant Access', 'On Hold']) assert.equal(statusStep(s), statusStep('In Progress'));
  assert.equal(statusStep('In Progress'), 3);
});

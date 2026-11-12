import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caseCounts, filterCases, isUrgent, parseStatusToken, statusStep, eventLabel } from '../src/lib/cases.ts';

const c = (status, priority = 'normal') => ({ id: status + priority, caseNumber: '1', createdAt: '2026-11-01T00:00:00Z', updatedAt: null, status, priority });
const sample = [c('New', 'emergency'), c('New'), c('Assigned', 'high'), c('In Progress'), c('Completed', 'emergency'), c('Closed')];

test('dashboard counts match the live lifecycle', () => {
  assert.deepEqual(caseCounts(sample), { active: 4, new: 2, urgent: 2, resolved: 2 });
  assert.deepEqual(caseCounts([]), { active: 0, new: 0, urgent: 0, resolved: 0 });
});

test('resolved urgent cases are not counted or listed as urgent', () => {
  assert.equal(filterCases(sample, 'Urgent').length, 2);
  assert.ok(filterCases(sample, 'Urgent').every(x => x.status !== 'Completed'));
});

test('queue filters', () => {
  assert.equal(filterCases(sample, 'All').length, 6);
  assert.equal(filterCases(sample, 'New').length, 2);
  assert.equal(filterCases(sample, 'Resolved').length, 2);
  assert.equal(filterCases(sample, 'Scheduled').length, 0);
});

test('urgency is case-insensitive and null-safe', () => {
  assert.equal(isUrgent('EMERGENCY'), true);
  assert.equal(isUrgent('normal'), false);
  assert.equal(isUrgent(null), false);
});

test('status link parsing accepts full links and bare tokens', () => {
  const tok = 'AbCdEfGhIjKlMnOpQrSt_-';
  assert.equal(parseStatusToken(`https://pma.stellaruc.com/status?t=${tok}`), tok);
  assert.equal(parseStatusToken(` pma://status?t=${tok}&x=1 `), tok);
  assert.equal(parseStatusToken(tok), tok);
  assert.equal(parseStatusToken(''), null);
  assert.equal(parseStatusToken('https://pma.stellaruc.com/status'), null);
  assert.equal(parseStatusToken('short'), null);
  assert.equal(parseStatusToken('https://x/status?t=%E0%A4%A'), null);
  assert.equal(parseStatusToken('bad token with spaces and <script>'), null);
});

test('lifecycle steps and event labels', () => {
  assert.equal(statusStep('New'), 0);
  assert.equal(statusStep('Closed'), 5);
  assert.equal(statusStep('Unknown'), -1);
  assert.equal(eventLabel('vendor_assigned'), 'Service provider assigned');
  assert.equal(eventLabel('some_new_event'), 'Some new event');
});

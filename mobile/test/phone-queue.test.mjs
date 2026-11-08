import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterCases, PHONE_FILTERS, caseCounts } from '../src/lib/cases.ts';
import { MANAGER_STATUSES } from '../src/lib/manager-entries.ts';

const sample = MANAGER_STATUSES.map((status, i) => ({
  id: String(i), status, priority: status === 'Completed' ? 'emergency' : status === 'Waiting on Parts' ? 'HIGH' : 'normal',
  caseNumber: String(i), createdAt: '', updatedAt: null,
}));

test('phone queue keeps waiting and on-hold cases open; completed includes closed', () => {
  assert.deepEqual(PHONE_FILTERS, ['Open', 'Emergency', 'Scheduled', 'Completed']);
  assert.deepEqual(filterCases(sample, 'Open').map(c => c.status), MANAGER_STATUSES.slice(0, -2));
  assert.deepEqual(filterCases(sample, 'Completed').map(c => c.status), ['Completed', 'Closed']);
  assert.deepEqual(caseCounts(sample), { active: 7, new: 1, urgent: 1, resolved: 2 });
});

test('emergency and scheduled phone views respect priority and lifecycle', () => {
  assert.deepEqual(filterCases(sample, 'Emergency').map(c => c.status), ['Waiting on Parts']);
  assert.deepEqual(filterCases(sample, 'Scheduled').map(c => c.status), ['Scheduled']);
  assert.deepEqual(filterCases([], 'Open'), []);
});

test('approval queue and badge predicate agree, including after approval refresh', () => {
  const cases = sample.map((c, i) => ({ ...c, approvalState: i < 2 ? 'PENDING' : 'NOT_REQUIRED' }));
  assert.equal(filterCases(cases, 'Approval').length, 2);
  cases[0].approvalState = 'APPROVED';
  assert.equal(filterCases(cases, 'Approval').length, 1);
});

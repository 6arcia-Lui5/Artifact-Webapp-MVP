import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModerationParams, validateModerationDecision, validateRoleChange, moderationError } from '../lib/moderationApi.js';

const reviewer = { userId: 'reviewer', role: 'reviewer', canReview: true, canManageRoles: false };
const admin = { userId: 'admin', role: 'admin', canReview: true, canManageRoles: true };
const record = { userId: 'contributor', revision: 4 };

test('reviewers can decide others but cannot decide their own submissions', () => {
  assert.equal(validateModerationDecision({ record, access: reviewer, status: 'approved', notes: 'Original text checked against the supplied photograph.' }), '');
  for (const status of ['approved', 'changes_requested']) {
    assert.match(validateModerationDecision({ record: { ...record, userId: reviewer.userId }, access: reviewer, status, notes: 'Inspected' }), /cannot decide their own/);
  }
  assert.match(validateModerationDecision({ record, access: { ...reviewer, canReview: false }, status: 'approved', notes: '' }), /permission/);
});

test('own admin approvals need a documented reason and change requests need actionable notes', () => {
  const own = { ...record, userId: admin.userId };
  assert.match(validateModerationDecision({ record: own, access: admin, status: 'approved', notes: '  ' }), /Document your reason/);
  assert.equal(validateModerationDecision({ record: own, access: admin, status: 'approved', notes: 'Only available administrator; original checked against the museum source.' }), '');
  assert.match(validateModerationDecision({ record, access: reviewer, status: 'changes_requested', notes: '' }), /Explain the changes/);
  assert.match(validateModerationDecision({ record, access: reviewer, status: 'approved', notes: '  ' }), /factual review note/);
  assert.match(validateModerationDecision({ record, access: reviewer, status: 'approved', notes: 'x'.repeat(10001) }), /10000 characters/);
  assert.match(validateModerationDecision({ record: { ...record, revision: null }, access: reviewer, status: 'approved', notes: '' }), /revision/);
});

test('role changes require admin capability and never allow admin assignment or self-promotion', () => {
  const target = { userId: 'another', role: 'contributor' };
  assert.equal(validateRoleChange({ access: admin, target, role: 'reviewer' }), '');
  assert.match(validateRoleChange({ access: reviewer, target, role: 'reviewer' }), /Only administrators/);
  assert.match(validateRoleChange({ access: admin, target, role: 'admin' }), /server/);
  assert.match(validateRoleChange({ access: admin, target: { userId: admin.userId, role: 'contributor' }, role: 'reviewer' }), /cannot be changed/);
  assert.match(validateRoleChange({ access: admin, target: { ...target, role: 'admin' }, role: 'contributor' }), /cannot be changed/);
});

test('queue URL parsing bounds pagination and keeps editorial status separate from scholarly status', () => {
  assert.deepEqual(parseModerationParams('status=changes_requested&page=3&pageSize=48'), { status: 'changes_requested', page: 3, pageSize: 48 });
  assert.deepEqual(parseModerationParams('status=uncertain&page=100001&pageSize=999'), { status: 'pending', page: 1, pageSize: 100 });
});

test('stale moderation responses tell reviewers to inspect current revisions and preserve their notes', () => {
  assert.match(moderationError({ response: { status: 409 } }), /Reload the queue and inspect/);
  assert.match(moderationError({ response: { status: 409 } }), /notes have been kept/);
});

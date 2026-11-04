import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisStatus, comparisonLabel } from '../lib/analysisStatus.js';

test('a skipped comparison never reports an all-clear result', () => {
  assert.equal(analysisStatus({ flagged: false }), 'Suggestions ready');
  assert.equal(analysisStatus({ comparison: { date: { compared: false }, region: { compared: false } } }), 'Suggestions ready');
  assert.equal(analysisStatus({ comparison: { date: { compared: true }, region: { compared: false } } }), 'Partial comparison');
  assert.equal(analysisStatus({ comparison: { date: { compared: true }, region: { compared: true } } }), 'No differences flagged');
  assert.equal(analysisStatus({ flagged: true, comparison: { date: { compared: true } } }), 'Review suggested');
});

test('field labels preserve absent, unsupported and unrecognized comparisons', () => {
  assert.equal(comparisonLabel({ compared: true }), 'Compared with catalog');
  for (const reason of ['missing', 'unrecognized', 'outside_range']) assert.match(comparisonLabel({ compared: false, reason }), /^Not compared:/);
  assert.equal(comparisonLabel(undefined), 'Not compared');
});

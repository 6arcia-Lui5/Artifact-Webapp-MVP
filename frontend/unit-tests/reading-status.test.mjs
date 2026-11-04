import test from 'node:test';
import assert from 'node:assert/strict';
import { readingStatus } from '../lib/readingStatus.js';

test('usable, uncertain, absent and incomplete readings have distinct review states', () => {
  const statuses = ['readers_agree', 'readers_disagree', 'single_reader', 'comparison_incomplete', 'uncertain_marks', 'no_text'];
  assert.equal(new Set(statuses.map(readingStatus)).size, statuses.length);
  assert.equal(readingStatus('single_reader'), 'One reading available');
  assert.equal(readingStatus('no_text'), 'No readable text found');
  assert.equal(readingStatus(undefined), 'Review this reading');
});

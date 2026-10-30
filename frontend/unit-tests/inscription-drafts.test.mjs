import test from 'node:test';
import assert from 'node:assert/strict';
import { addPhotoDraft } from '../lib/inscriptionDrafts.js';
const draft = { content: 'D M', language: 'Latin', script: 'Latin', translation: '' };
const blank = { clientKey: 'empty', content: '', language: '', script: '', translation: '', serifsPresent: false, stopmarksPresent: false };

test('photo draft fills the untouched placeholder instead of leaving a required blank entry', () => {
  const result = addPhotoDraft([blank], draft, () => 'new');
  assert.equal(result.length, 1);
  assert.equal(result[0].clientKey, 'empty');
  assert.equal(result[0].content, 'D M');
  assert.equal(blank.content, '');
});
test('saved and partially edited inscriptions are preserved when a photo draft is added', () => {
  const existing = [{ ...blank, id: 'saved' }, { ...blank, clientKey: 'typed', language: 'Greek' }];
  const result = addPhotoDraft(existing, draft, () => 'new');
  assert.equal(result.length, 3);
  assert.deepEqual(result.slice(0, 2), existing);
  assert.equal(result[2].clientKey, 'new');
  assert.equal(result[2].id, undefined);
});
test('photo insertion respects the maximum without dropping any existing entry', () => {
  const existing = Array.from({ length: 30 }, (_, i) => ({ ...blank, clientKey: String(i) }));
  assert.equal(addPhotoDraft(existing, draft), existing);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeRecordFields, hasIncompleteMetadata, prepareRecordDraft, prepareInscriptionDraft } from '../lib/recordDraft.js';

test('unknown source metadata opens the editor in draft mode', () => {
  const complete = { ...Object.fromEntries(completeRecordFields.map(key => [key, 'Known'])), inscribed: false, imagery: false };
  assert.equal(hasIncompleteMetadata(undefined), false);
  assert.equal(hasIncompleteMetadata(complete), false);
  assert.equal(hasIncompleteMetadata({ ...complete, dimensions: null }), true);
  assert.equal(hasIncompleteMetadata({ ...complete, museumCountry: '  ' }), true);
  assert.equal(hasIncompleteMetadata({ ...complete, imagery: null }), true);
});

test('draft payload retains unknowns as null without mutating text or the form', () => {
  const values = { itemName: 'Ancient ring', objectTypeId: '', museumCountry: '  ', dimensions: null, materials: 'Gold', inscribed: true, productionPlace: '', bibliography: 'Source\nCitation' };
  const draft = prepareRecordDraft(values, true);
  assert.equal(draft.saveAsDraft, true);
  assert.equal(draft.objectTypeId, null);
  assert.equal(draft.museumCountry, null);
  assert.equal(draft.dimensions, null);
  assert.equal(draft.materials, 'Gold');
  assert.equal(draft.bibliography, 'Source\nCitation');
  assert.equal(draft.productionPlace, null);
  assert.equal(draft.inscribed, true);
  assert.equal(values.objectTypeId, '');
  assert.equal(prepareRecordDraft(values, false).objectTypeId, '');
});

test('draft edits preserve unknown flags and normalize explicit date ranges without inventing dates', () => {
  const values = { itemName: 'Undated fragment', inscribed: null, imagery: null, dateStart: '', dateEnd: null };
  assert.deepEqual(prepareRecordDraft(values, true), { ...values, dateStart: null, saveAsDraft: true });
  const dated = prepareRecordDraft({ ...values, dateStart: '-100', dateEnd: '0' }, true);
  assert.equal(dated.dateStart, -100);
  assert.equal(dated.dateEnd, 0);
  assert.equal(values.dateStart, '');
});

test('published literal inscriptions retain unknown metadata and markings through draft edits', () => {
  const original = { id: 'saved-entry', content: '\u03c7\u03b1\u1fd6\u03c1\u03b5\nD M', language: null, script: null, translation: null, serifsPresent: null, stopmarksPresent: null };
  assert.deepEqual(prepareInscriptionDraft(original, true), original);
  const form = { ...original, language: '', script: '' };
  assert.deepEqual(prepareInscriptionDraft(form, true), original);
  const known = { ...original, language: 'Greek', script: 'Greek', serifsPresent: false, stopmarksPresent: true };
  assert.deepEqual(prepareInscriptionDraft(known, true), known);
  assert.equal(form.language, '');
  assert.equal(prepareInscriptionDraft({ ...known, translation: undefined }, false).translation, '');
});

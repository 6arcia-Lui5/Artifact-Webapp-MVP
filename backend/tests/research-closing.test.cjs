const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readInscriptions } = require('../dist/lib/inscriptionValidation');
const { restoreInscriptions } = require('../dist/research/validation');
const original = '  \u03c7\u03b1\u1fd6\u03c1\u03b5\nD M  ';
const unknown = { content: original, language: null, script: null,
  translation: '  Literal translation\nsecond line  ', serifsPresent: null, stopmarksPresent: null };

test('explicit draft inscription roundtrip preserves unknown source facts and literal Unicode', () => {
  const result = readInscriptions({ inscribed: true, inscriptions: [unknown] }, { draft: true });
  assert.deepEqual(result, { values: [unknown] });
  assert.deepEqual(restoreInscriptions(result.values), [unknown]);
  const blank = readInscriptions({ inscribed: true, inscriptions: [{ ...unknown, language: ' ', script: '' }] }, { draft: true });
  assert.deepEqual(blank.values, [unknown]);
  const explicit = { ...unknown, language: 'Greek', script: 'Greek', serifsPresent: false, stopmarksPresent: true };
  assert.deepEqual(readInscriptions({ inscribed: true, inscriptions: [explicit] }, { draft: true }).values, [explicit]);
});

test('complete inscription mode remains strict and draft mode rejects malformed source facts', () => {
  assert.match(readInscriptions({ inscribed: true, inscriptions: [unknown] }).error, /language is required/);
  for (const patch of [{ content: ' ' }, { content: 'a'.repeat(10001) }, { language: 42 },
    { script: {} }, { language: 'a'.repeat(10001) }, { serifsPresent: 'false' }, { stopmarksPresent: 0 }]) {
    assert(readInscriptions({ inscribed: true, inscriptions: [{ ...unknown, ...patch }] }, { draft: true }).error);
  }
  const id = 'a4dde13d-dff2-4edc-aa94-99a091a53abc';
  assert.match(readInscriptions({ inscribed: true, inscriptions: [{ ...unknown, id }, { ...unknown, id }] }, { draft: true }).error, /repeated/);
  for (const flags of [{ serifsPresent: 'false' }, { stopmarksPresent: undefined }])
    assert.throws(() => restoreInscriptions([{ ...unknown, ...flags }]), /Invalid inscription snapshot/);
  const complete = readInscriptions({ inscribed: true, inscriptions: [{ content: original, language: 'Greek', script: 'Greek' }] });
  assert.equal(complete.values[0].serifsPresent, false);
  assert.equal(complete.values[0].stopmarksPresent, false);
});

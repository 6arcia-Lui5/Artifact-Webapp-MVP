import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findTermFamily, uniqueTerms, termSearchUrl } from '../lib/museumTerms.js';
import { parseCatalogParams, updateCatalogParams } from '../src/components/research/catalogParams.js';

// Use the backend's canonical published glossary, not a separately maintained copy.
const glossary = JSON.parse(fs.readFileSync(new URL('../../backend/src/research/museumTerms.json', import.meta.url), 'utf8'));

test('term browser links retain every published alias and explicit opt-in on reload', () => {
  for (const family of glossary.concepts) {
    for (const entry of family.terms) {
      const url = new URL(termSearchUrl(entry.term), 'https://catalog.example');
      assert.equal(url.pathname, '/search');
      const params = parseCatalogParams(url.search);
      assert.equal(params.q, entry.term);
      assert.equal(params.expandTerms, '1');
      assert.equal(findTermFamily(glossary, params.q).id, family.id);
    }
  }
  assert.deepEqual(uniqueTerms(glossary.concepts[0]), ['ring', 'bague', 'anello']);
});

test('matching is NFC/case-aware and cannot imply translation of unlisted words or provisional terms', () => {
  assert.equal(findTermFamily(glossary, 'Anha\u0308nger').id, 'pendant');
  assert.equal(findTermFamily(glossary, ' ANHÄNGER ').id, 'pendant');
  for (const query of ['wine', 'gold bague', 'bague*', null]) assert.equal(findTermFamily(glossary, query), undefined);
  const provisional = structuredClone(glossary);
  provisional.concepts[0].status = 'provisional';
  assert.equal(findTermFamily(provisional, 'bague'), undefined);
});

test('pagination, sort and filters preserve expansion while a filter change resets the page', () => {
  const original = new URLSearchParams('q=bague&expandTerms=1&language=Latin&museum=Met&page=3&sort=title');
  const page = updateCatalogParams(original, { page: 4 });
  assert.equal(parseCatalogParams(page).expandTerms, '1');
  assert.equal(parseCatalogParams(page).language, 'Latin');
  assert.equal(parseCatalogParams(page).page, 4);
  const filtered = updateCatalogParams(page, { material: 'gold' });
  assert.equal(parseCatalogParams(filtered).page, 1);
  assert.equal(parseCatalogParams(filtered).expandTerms, '1');
  assert.equal(parseCatalogParams(filtered).q, 'bague');
  const disabled = updateCatalogParams(filtered, { expandTerms: '' });
  assert.equal(parseCatalogParams(disabled).expandTerms, undefined);
  assert.equal(parseCatalogParams('q=ring&expandTerms=true').expandTerms, undefined);
  assert.equal(original.get('page'), '3');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalogParams, validateDateRange, updateCatalogParams, formatYear } from '../src/components/research/catalogParams.js';

test('catalog URLs retain text, structured facets, signed years and pagination on reload', () => {
  const params = parseCatalogParams('q=Greek+translation&museum=Met&language=Greek&script=Attic&objectTypeId=type-1&reviewStatus=uncertain&sourceProvider=met&dateFrom=-500&dateTo=200&page=3&pageSize=48&sort=title');
  assert.deepEqual(params, { q: 'Greek translation', museum: 'Met', language: 'Greek', script: 'Attic', objectTypeId: 'type-1', reviewStatus: 'uncertain', sourceProvider: 'met', dateFrom: '-500', dateTo: '200', page: 3, pageSize: 48, sort: 'title' });
  assert.equal(validateDateRange(params), '');
});

test('pagination is bounded and malformed URL settings receive safe defaults', () => {
  assert.deepEqual(parseCatalogParams('page=-1&pageSize=999&sort=unknown&reviewStatus=admin&mine=1'), { page: 1, pageSize: 100, sort: 'newest' });
  assert.deepEqual(parseCatalogParams('page=1.2&pageSize=nope'), { page: 1, pageSize: 24, sort: 'newest' });
  assert.equal(parseCatalogParams('page=100000').page, 100000);
  assert.equal(parseCatalogParams('page=100001').page, 1);
});

test('date validation rejects reversed and noninteger ranges while retaining BCE and zero', () => {
  assert.equal(validateDateRange({ dateFrom: '-500', dateTo: '-100' }), '');
  assert.equal(validateDateRange({ dateFrom: '0', dateTo: '0' }), '');
  assert.equal(validateDateRange({ dateFrom: '', dateTo: '-100' }), '');
  for (const value of ['-500 BCE', '1.2', '2e3', 'Infinity', '9007199254740992']) assert.match(validateDateRange({ dateFrom: value }), /whole signed years/);
  assert.match(validateDateRange({ dateFrom: '200', dateTo: '-100' }), /earlier/);
  assert.equal(parseCatalogParams('dateFrom=invalid').dateFrom, 'invalid');
});

test('changing filters resets the page, pagination retains filters, and inputs are not mutated', () => {
  const original = new URLSearchParams('q=coin&museum=Met&page=5&sort=oldest');
  const changed = updateCatalogParams(original, { q: 'inscription', museum: '' });
  assert.equal(changed.get('page'), '1');
  assert.equal(changed.get('q'), 'inscription');
  assert.equal(changed.has('museum'), false);
  assert.equal(changed.get('sort'), 'oldest');
  assert.equal(original.get('q'), 'coin');
  const nextPage = updateCatalogParams(original, { page: 6 });
  assert.equal(nextPage.get('museum'), 'Met');
  assert.equal(nextPage.get('page'), '6');
});

test('year validation matches server boundaries before a catalog request can be enabled', () => {
  assert.equal(validateDateRange({ dateFrom: '-1000000', dateTo: '1000000' }), '');
  assert.equal(validateDateRange({ dateFrom: '1000000', dateTo: '1000000' }), '');
  assert.equal(validateDateRange({ dateFrom: '-1000000', dateTo: '-1000000' }), '');
  for (const value of ['-1000001', '1000001', '00000000']) {
    assert.match(validateDateRange({ dateFrom: value }), /from -1000000 to 1000000/);
    assert.match(validateDateRange({ dateTo: value }), /from -1000000 to 1000000/);
  }
});

test('display years preserve missing dates and distinguish BCE and CE', () => {
  assert.equal(formatYear(null), '');
  assert.equal(formatYear(-500), '500 BCE');
  assert.equal(formatYear(200), '200 CE');
  assert.equal(formatYear(0), '0 CE');
});

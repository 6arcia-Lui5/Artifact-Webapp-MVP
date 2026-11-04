const { test } = require('node:test');
const assert = require('node:assert/strict');
const { museumTerms, museumTermFamily, museumSearchAliases } = require('../dist/research/museumTerms');
const { parseSearch } = require('../dist/research/validation');
const { appendVisibility } = require('../dist/research/access');

test('every published alias has museum-object evidence and expands only when requested', () => {
    assert.equal(museumTerms.clientReviewStatus, 'Not yet reviewed by Holly');
    assert.equal(museumTerms.concepts.length, 2);
    for (const family of museumTerms.concepts) {
        assert.equal(family.status, 'source-attested');
        assert.deepEqual(family.terms.map(term => term.language), ['en', 'fr', 'de', 'it']);
        const expected = museumSearchAliases(family.terms[0].term, true);
        for (const entry of family.terms) {
            assert(entry.source.objectId && entry.source.field && entry.source.title);
            assert(['www.metmuseum.org', 'collections.louvre.fr', 'www.khm.at', 'catalogo.beniculturali.it'].includes(new URL(entry.source.url).hostname));
            assert.equal(museumTermFamily(entry.term).id, family.id);
            assert.deepEqual(parseSearch({ q: entry.term }, 'owner').values, [entry.term]);
            assert.deepEqual(parseSearch({ q: entry.term, expandTerms: '0' }, 'owner').values, [entry.term]);
            assert.deepEqual(parseSearch({ q: entry.term, expandTerms: '1' }, 'owner').values, expected);
        }
    }
    assert.deepEqual(museumSearchAliases('Ring', true), ['ring', 'bague', 'anello']);
});

test('query recognition handles case and Unicode NFC without changing saved text or arbitrary phrases', () => {
    assert.equal(museumTermFamily(' ANHÄNGER ').id, 'pendant');
    assert.equal(museumTermFamily('Anha\u0308nger').id, 'pendant');
    assert.deepEqual(museumSearchAliases('Anha\u0308nger', true), ['pendant', 'pendentif', 'Anhänger', 'pendente']);
    for (const query of ['wine', 'vin', 'coin pendant', 'gold bague', 'bague*', 'anhaenger', 'pendentifs']) {
        assert.equal(museumTermFamily(query), undefined);
        assert.deepEqual(parseSearch({ q: query, expandTerms: '1' }, 'owner').values, [query]);
    }
    assert.deepEqual(parseSearch({ q: 'Anha\u0308nger' }, 'owner').values, ['Anha\u0308nger']);
});

test('provisional families cannot participate in automatic expansion', () => {
    // The source-attested status is the gate, not membership of the JSON file.
    const family = museumTerms.concepts[0];
    const previous = family.status;
    try {
        family.status = 'provisional';
        assert.equal(museumTermFamily('bague'), undefined);
        assert.deepEqual(museumSearchAliases('bague', true), ['bague']);
    } finally { family.status = previous; }
});

test('OR expansion remains parenthesized and filters/visibility apply to every alias', () => {
    const query = { q: 'bague', expandTerms: '1', museum: 'Test museum', material: 'gold', language: 'Latin',
        script: 'Latin', sourceProvider: 'met', dateFrom: '-500', dateTo: '200', mine: '1', sort: 'title', page: '2' };
    const access = { userId: 'owner', role: 'contributor' };
    const search = appendVisibility(parseSearch(query, access.userId), access);
    assert.match(search.where, /^WHERE \(r.search_vector @@ plainto_tsquery\('simple',\$1\) OR .*\) AND r.museum_name=/);
    assert.equal((search.where.match(/ OR /g) || []).length, 3); // two alias joins, one visibility join
    assert.match(search.where, /i.language=/);
    assert.match(search.where, /i.script=/);
    assert.match(search.where, /r.date_end>=/);
    assert.match(search.where, /r.date_start<=/);
    assert.match(search.where, /AND \(r.moderation_status='approved' OR r.user_id=\$\d+\)$/);
    assert(search.values.includes('Latin'));
    assert.equal(search.page, 2);
    const exported = appendVisibility(parseSearch({ ...query, format: 'json', page: '1' }, 'owner'), access);
    assert.equal(exported.where, search.where);
    assert.deepEqual(exported.values, search.values);
});

test('invalid expansion settings are rejected and injection strings stay bound literals', () => {
    for (const expandTerms of ['true', 'yes', '2', '', '1 OR true', ['1'], { value: '1' }])
        assert.throws(() => parseSearch({ q: 'ring', expandTerms }, 'owner'), error => error.status === 400);
    const attack = "bague') OR true --";
    const search = parseSearch({ q: attack, expandTerms: '1', museum: attack }, 'owner');
    assert(!search.where.includes(attack));
    assert.deepEqual(search.values, [attack, attack]);
    assert.equal((search.where.match(/plainto_tsquery/g) || []).length, 1);
    assert.deepEqual(parseSearch({ expandTerms: '1' }, 'owner').values, []);
});

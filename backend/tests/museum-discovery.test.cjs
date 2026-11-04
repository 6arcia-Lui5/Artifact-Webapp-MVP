const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { randomUUID } = require('node:crypto');
for (const [name, exports] of [['@clerk/express', { getAuth: req => ({ userId: req.headers['x-user'] }) }], ['../dist/config/env', { ENV: { NODE_ENV: 'test', ALLOWED_CLERK_USER_IDS: 'owner' } }]]) {
  const filename = require.resolve(name);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const { discoveryQueries, discoveryRoots, discoveryLimits, searchMuseums } = require('../dist/research/discovery');
const { requireSiteAccess } = require('../dist/middleware/requireSiteAccess');
const { createResearchRouter } = require('../dist/research/router');

test('discovery generates explicit spelling, reversed-order, hyphen and finite root queries', () => {
  assert.deepEqual(discoveryQueries('Coin-Pendant').queries, ['coin pendant', 'coin-pendant', 'pendant coin', 'pendant-coin']);
  assert.deepEqual(discoveryQueries('jewelry').queries, ['jewelry', 'jewellery']);
  assert.deepEqual(discoveryQueries('jewellery').queries, ['jewellery', 'jewelry']);
  for (const [root, terms] of Object.entries(discoveryRoots)) {
    const plan = discoveryQueries(root);
    assert.deepEqual(plan.queries, terms);
    assert(plan.queries.every(query => !query.includes('*')));
  }
  assert.equal(discoveryQueries('fake').queries[0], 'fake');
  assert.equal(discoveryQueries('forg* jewelry').queries.length, 8);
  assert.equal(discoveryQueries('forg* jewelry').limited, true);
  assert(discoveryQueries('monnaie française').queries.includes('monnaie française'));
  for (const invalid of ['', ' ', '*', 'unknown*', 'a/b', 'x'.repeat(81), 'one two three four five', ['coin'], null]) assert.throws(() => discoveryQueries(invalid));
});

test('cold Met search stays within 20 requests, 12 objects, two concurrent requests and fixed allowlisted endpoints', async () => {
  let active = 0, maximum = 0, calls = 0;
  const fetcher = async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert(options.signal instanceof AbortSignal);
    const target = new URL(url);
    assert.equal(target.hostname, 'collectionapi.metmuseum.org');
    active++; maximum = Math.max(maximum, active); calls++;
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    if (target.pathname.endsWith('/search')) {
      assert.equal(target.pathname, '/public/collection/v1.1/search');
      assert.equal(target.searchParams.get('offset'), '0');
      assert.equal(target.searchParams.get('limit'), '12');
      const seed = calls * 100;
      return Response.json({ total: 500, objectIDs: Array.from({ length: 15 }, (_, i) => seed + i) });
    }
    assert.match(target.pathname, /^\/public\/collection\/v1\/objects\/\d+$/);
    return Response.json({ objectID: Number(target.pathname.split('/').at(-1)), title: 'Coin pendant' });
  };
  for (let run = 0; run < 2; run++) {
    calls = 0;
    const result = await searchMuseums('met', 'coin jewelry', fetcher);
    assert.equal(result.queries.length, 8);
    assert.equal(result.items.length, 12);
    assert.equal(result.requests, 20);
    assert.equal(calls, 20);
    assert.equal(result.partial, true);
    assert(result.warnings.some(message => message.includes('limited sample')));
    assert(result.queries.every(query => query.returned === 12 && query.limited));
  }
  assert.equal(maximum, 2);
});

test('duplicate museum identities merge query provenance and fetch each detail only once', async () => {
  let details = 0;
  const result = await searchMuseums('met', 'coin pendant', async url => {
    if (url.includes('/search?')) return Response.json({ total: 2, objectIDs: [1, 1] });
    details++;
    return Response.json({ objectID: 1, title: 'Pendant', primaryImageSmall: 'https://images.metmuseum.org/example.jpg' });
  });
  assert.equal(details, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].sourceUrl, 'https://www.metmuseum.org/art/collection/search/1');
  assert.equal(new Set(result.items[0].matches).size, 4);
  assert.equal(result.items[0].matches.length, 4);
  assert(!('data' in result.items[0]));
  assert(!Number.isNaN(Date.parse(result.items[0].retrievedAt)));
});

test('Cleveland uses bounded q/skip/limit/fields and no extra object requests', async () => {
  let calls = 0;
  const result = await searchMuseums('cleveland', 'jewelry', async url => {
    calls++;
    const target = new URL(url);
    assert.equal(target.origin, 'https://openaccess-api.clevelandart.org');
    assert.equal(target.pathname, '/api/artworks/');
    assert.equal(target.searchParams.get('skip'), '0');
    assert.equal(target.searchParams.get('limit'), '12');
    assert(target.searchParams.get('fields').includes('images'));
    return Response.json({ info: { total: 1 }, data: [{ id: 3, title: 'Jewelry', accession_number: 'A3', share_license_status: 'CC0', images: { web: { url: 'https://openaccess-cdn.clevelandart.org/a.jpg' } } }] });
  });
  assert.equal(calls, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].matches.length, 2);
  assert.equal(result.items[0].imageSourceUrl, 'https://openaccess-cdn.clevelandart.org/a.jpg');
  assert.equal(result.partial, false);
});

test('empty results do not fetch details; partial source failure preserves successful matches', async () => {
  let calls = 0;
  const empty = await searchMuseums('met', 'fake', async () => { calls++; return Response.json({ total: 0, objectIDs: null }); });
  assert.equal(calls, 1); assert.equal(empty.items.length, 0); assert.equal(empty.partial, false);
  const partial = await searchMuseums('cleveland', 'jewelry', async url => {
    if (new URL(url).searchParams.get('q') === 'jewellery') return new Response('fail', { status: 503 });
    return Response.json({ info: { total: 1 }, data: [{ id: 1, title: 'Ring' }] });
  });
  assert.equal(partial.items.length, 1);
  assert.equal(partial.partial, true);
  assert.match(partial.queries[1].error, /failed/);
});

test('shared deadline cancels active requests and prevents remaining calls; unsafe or malformed objects stay out', async () => {
  let calls = 0;
  const deadline = await searchMuseums('met', 'coin jewelry', (_url, options) => {
    calls++;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  }, { deadlineMs: 10 });
  assert.equal(calls, 2);
  assert(deadline.queries.every(query => query.error));
  assert(deadline.warnings.some(message => message.includes('time limit')));
  const unsafe = await searchMuseums('cleveland', 'fake', async () => Response.json({ info: { total: 2 }, data: [
    { id: 1, title: 'Bad image', images: { web: { url: 'https://evil.example/a.jpg' } } }, { id: 2, title: 'Safe object' },
  ] }));
  assert.deepEqual(unsafe.items.map(item => item.objectId), ['2']);
  assert.equal(unsafe.partial, true);
  const malformed = await searchMuseums('met', 'fake', async () => Response.json({ total: 1, objectIDs: ['../secret'] }));
  assert.equal(malformed.items.length, 0); assert.equal(malformed.partial, true);
  await assert.rejects(() => searchMuseums('https://evil.example', 'fake'));
  assert.equal(discoveryLimits.maxRequests, 20);
});

test('authenticated route searches without writes then selected ID enters existing preview without importing', async () => {
  const originalFetch = global.fetch;
  let upstream = 0, previewWrites = 0, recordWrites = 0;
  const query = async (sql, args = []) => {
    if (sql.startsWith('SELECT role')) return { rows: [] };
    if (sql.startsWith('SELECT count(*) FROM research_imports')) return { rows: [{ count: 0 }] };
    if (sql.startsWith('INSERT INTO research_imports')) { previewWrites++; return { rows: [{ id: randomUUID(), user_id: args[0], source_type: args[1], source_provider: args[2], payload: JSON.parse(args[3]), status: 'preview' }] }; }
    if (sql.startsWith('INSERT INTO records')) recordWrites++;
    return { rows: [], rowCount: 0 };
  };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  const app = express(); app.use(express.json()); app.use(requireSiteAccess); app.use('/api/research', createResearchRouter(pool));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/research`;
  global.fetch = async (url, options) => {
    upstream++;
    assert.equal(new URL(url).hostname, 'collectionapi.metmuseum.org');
    return Response.json(url.includes('/search?') ? { total: 1, objectIDs: [1] } : { objectID: 1, title: 'Coin' });
  };
  try {
    const search = `${base}/discovery/search?provider=met&q=fake`;
    assert.equal((await originalFetch(search)).status, 401);
    assert.equal((await originalFetch(search, { headers: { 'x-user': 'stranger' } })).status, 403);
    assert.equal(upstream, 0);
    for (const suffix of ['&q=other', '&limit=100', '&provider=other']) assert.equal((await originalFetch(search + suffix, { headers: { 'x-user': 'owner' } })).status, 400);
    const response = await originalFetch(search, { headers: { 'x-user': 'owner' } });
    assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
    const result = await response.json();
    assert.equal(result.items[0].objectId, '1'); assert.equal(previewWrites, 0); assert.equal(recordWrites, 0);
    const preview = await originalFetch(`${base}/imports/preview`, { method: 'POST', headers: { 'x-user': 'owner', 'content-type': 'application/json' }, body: JSON.stringify({ sourceProvider: result.provider, objectIds: result.items.map(item => item.objectId) }) });
    assert.equal(preview.status, 201, await preview.clone().text());
    const job = await preview.json();
    assert.equal(job.rows[0].data.itemName, 'Coin'); assert.equal(previewWrites, 1); assert.equal(recordWrites, 0);
  } finally { global.fetch = originalFetch; await new Promise(resolve => server.close(resolve)); }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { Pool } = require('pg');
const clerk = require.resolve('@clerk/express');
require.cache[clerk] = { id: clerk, filename: clerk, loaded: true, exports: { getAuth: req => ({ userId: req.headers['x-owner'] }) } };
const { createResearchRouter } = require('../dist/research/router');
const { configureApprovedAccounts } = require('../dist/middleware/siteAccounts');
const { discoveryInput } = require('../dist/research/discoveries');

test('discovery IDs have bounded canonical provider identity and reject malformed input', () => {
  assert.deepEqual(discoveryInput({ sourceProvider: 'met', objectIds: ['0000777', '777', '8'] }), { provider: 'met', ids: ['777', '8'] });
  for (const body of [null, { sourceProvider: 'other', objectIds: ['1'] }, { sourceProvider: 'met', objectIds: ['0'] },
    { sourceProvider: 'met', objectIds: ['../1'] }, { sourceProvider: 'met', objectIds: Array(26).fill('1') },
    { sourceProvider: 'met', objectIds: [1] }, { sourceProvider: 'met', objectIds: ['12345678901'] }]) {
    assert.throws(() => discoveryInput(body), /museum/);
  }
});

test('real PostgreSQL discovery decisions survive fresh server and pool with bounded isolated storage', {
  skip: process.env.DISCOVERY_TEST_RUN !== '1' || !process.env.DATABASE_URL,
}, async t => {
  const schema = `discovery_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
  assert.match(schema, /^discovery_test_\d{13}_[a-f0-9]{12}$/);
  const direct = new URL(process.env.DATABASE_URL);
  if (direct.hostname.endsWith('.neon.tech')) direct.hostname = direct.hostname.replace('-pooler.', '.');
  // Drop inherited options so no external DATABASE_SCHEMA/search_path can select public writes.
  direct.searchParams.delete('options');
  const admin = new Pool({ connectionString: direct.toString(), max: 1, connectionTimeoutMillis: 10000 });
  const makePool = () => new Pool({ connectionString: direct.toString(), options: `-c search_path=${schema},pg_catalog`, max: 4, connectionTimeoutMillis: 10000 });
  let pool, server, created = false;
  const realFetch = globalThis.fetch;
  const museumCalls = [];
  const start = async () => {
    const app = express(); app.use(express.json());
    app.use('/api/research', createResearchRouter(pool));
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  };
  const stop = async () => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); server = null; } };
  const send = async (method, route, body, owner = 'owner') => {
    const response = await realFetch(`http://127.0.0.1:${server.address().port}/api/research${route}`, {
      method, headers: { ...(owner ? { 'x-owner': owner } : {}), 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  globalThis.fetch = async (url, options) => {
    const u = new URL(String(url));
    if (['collectionapi.metmuseum.org', 'openaccess-api.clevelandart.org'].includes(u.hostname)) {
      museumCalls.push(u.href);
      if (u.hostname === 'collectionapi.metmuseum.org' && u.pathname.endsWith('/search')) return Response.json({ total: 1, objectIDs: [777] });
      const id = u.pathname.split('/').at(-1);
      if (id === '404') return new Response('missing', { status: 404 });
      if (id === '405') return Response.json({ objectID: 406, title: 'Wrong ID' });
      if (u.hostname === 'collectionapi.metmuseum.org') return Response.json({ objectID: Number(id), title: `Museum object ${id}`, objectName: 'Pendant', accessionNumber: `M.${id}`, objectDate: '2nd century CE', medium: 'Gold', isPublicDomain: true, primaryImageSmall: '', creditLine: 'Museum' });
      return Response.json({ data: { id: Number(id), title: `Cleveland object ${id}`, type: 'Coin', accession_number: `C.${id}`, share_license_status: 'CC0' } });
    }
    throw new Error('Unexpected network destination');
  };
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    // Read baseline definitions only; no data, migrations or writes touch public.
    for (const table of ['users', 'collections', 'object_types', 'records', 'inscriptions']) {
      await admin.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    pool = makePool();
    assert.equal((await pool.query('SELECT current_schema() AS name')).rows[0].name, schema);
    const migrationFiles = fs.readdirSync(path.join(__dirname, '../migrations')).filter(file => /^\d+_[a-z_]+\.sql$/.test(file)).sort();
    for (let pass = 0; pass < 2; pass++) {
      for (const file of migrationFiles) await pool.query(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'));
    }
    assert.equal((await pool.query("SELECT version FROM research_migrations WHERE version='discovery_decisions_003'")).rowCount, 1);
    for (const user of ['owner', 'other', 'quota']) await pool.query('INSERT INTO users(id,email,name) VALUES($1,$2,$1)', [user, `${user}@example.test`]);
    configureApprovedAccounts(['owner', 'other', 'quota', 'new-account']);
    await start();
    let id, revision;
    await t.test('new approved profiles fail clearly before museum fetch until connected', async () => {
      const calls = museumCalls.length;
      const result = await send('POST', '/discoveries', { sourceProvider: 'met', objectIds: ['777'] }, 'new-account');
      assert.equal(result.status, 409); assert.match(result.body.error, /profile is not connected/);
      assert.equal(museumCalls.length, calls);
    });
    await t.test('trusted fetch, per-row errors, canonical IDs and compact facts', async () => {
      const result = await send('POST', '/discoveries', { sourceProvider: 'met', objectIds: ['0000777', '777', '404', '405'], title: 'Forged', decision: 'kept', userId: 'other' });
      assert.equal(result.status, 201); assert.equal(result.body.added, 1); assert.equal(result.body.errors.length, 2);
      const list = await send('GET', '/discoveries'); assert.equal(list.status, 200);
      assert.equal(list.body.total, 1); assert.equal(list.body.counts.pending, 1);
      const item = list.body.items[0]; id = item.id; revision = item.revision;
      assert.equal(item.sourceObjectId, '777'); assert.equal(item.title, 'Museum object 777'); assert.equal(item.decision, 'pending');
      assert.equal(item.license, 'CC0'); assert.equal(item.objectType, 'Pendant'); assert.equal(item.dateLabel, '2nd century CE');
      assert(!JSON.stringify(item).includes('image')); assert(!JSON.stringify(item).includes('Forged'));
      assert(museumCalls.every(url => /https:\/\/(collectionapi.metmuseum.org|openaccess-api.clevelandart.org)\//.test(url)));
      assert.equal((await pool.query('SELECT count(*) FROM records')).rows[0].count, '0');
    });
    await t.test('decisions are private, revisions conflict safely and repeated adds preserve them', async () => {
      assert.equal((await send('GET', `/discoveries/${id}`, undefined, 'other')).status, 404);
      assert.equal((await send('PATCH', `/discoveries/${id}`, { decision: 'kept', expectedRevision: revision }, 'other')).status, 404);
      assert.equal((await send('POST', `/discoveries/${id}/undo`, { expectedRevision: revision }, 'other')).status, 404);
      assert.equal((await send('GET', '/discoveries', undefined, '')).status, 401);
      assert.equal((await send('GET', '/discoveries', undefined, 'unapproved')).status, 403);
      assert.equal((await send('PATCH', `/discoveries/${id}`, { decision: 'approved', expectedRevision: revision })).status, 400);
      assert.equal((await send('PATCH', `/discoveries/${id}`, { decision: 'kept' })).status, 400);
      const first = await send('PATCH', `/discoveries/${id}`, { decision: 'kept', expectedRevision: revision });
      assert.equal(first.status, 200); assert.equal(first.body.item.previousDecision, 'pending'); revision = first.body.item.revision;
      assert.equal((await send('PATCH', `/discoveries/${id}`, { decision: 'dismissed', expectedRevision: revision - 1 })).status, 409);
      const calls = museumCalls.length;
      const repeat = await send('POST', '/discoveries', { sourceProvider: 'met', objectIds: ['000777'] });
      assert.equal(repeat.body.existing, 1); assert.equal(repeat.body.added, 0); assert.equal(museumCalls.length, calls);
      assert.equal((await send('GET', `/discoveries/${id}`)).body.item.revision, revision);
      const competing = await Promise.all(['kept', 'dismissed'].map(decision => send('PATCH', `/discoveries/${id}`, { decision, expectedRevision: revision })));
      // The same-decision request is an idempotent no-op; dismissal still wins with no overwritten change.
      assert(competing.every(r => [200, 409].includes(r.status)));
      const current = (await send('GET', `/discoveries/${id}`)).body.item;
      assert.equal(current.decision, 'dismissed'); assert.equal(current.previousDecision, 'kept'); revision = current.revision;
      assert.equal((await send('GET', '/discoveries')).body.total, 0);
      assert.equal((await send('GET', '/discoveries?status=dismissed')).body.total, 1);
    });
    await t.test('fresh server and connection pool retain dismissal and one-step undo', async () => {
      await stop(); await pool.end(); pool = makePool(); await start();
      let current = (await send('GET', `/discoveries/${id}`)).body.item;
      assert.equal(current.decision, 'dismissed'); assert.equal(current.previousDecision, 'kept');
      const undone = await send('POST', `/discoveries/${id}/undo`, { expectedRevision: current.revision });
      assert.equal(undone.status, 200); assert.equal(undone.body.item.decision, 'kept');
      assert.equal(undone.body.item.previousDecision, null); revision = undone.body.item.revision;
      assert.equal((await send('POST', `/discoveries/${id}/undo`, { expectedRevision: revision })).status, 409);
      const noOp = await send('PATCH', `/discoveries/${id}`, { decision: 'kept', expectedRevision: revision });
      assert.equal(noOp.body.item.revision, revision);
      assert.equal((await send('GET', '/discoveries?status=kept')).body.total, 1);
    });
    await t.test('two competing changed decisions cannot overwrite each other', async () => {
      await send('POST', '/discoveries', { sourceProvider: 'met', objectIds: ['888'] });
      const item = (await send('GET', '/discoveries?status=pending')).body.items.find(r => r.sourceObjectId === '888');
      const responses = await Promise.all(['kept', 'dismissed'].map(decision => send('PATCH', `/discoveries/${item.id}`, { decision, expectedRevision: 1 })));
      assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
      assert.equal((await send('GET', `/discoveries/${item.id}`)).body.item.revision, 2);
    });
    await t.test('provider/user identity is distinct and preview/import stay separate from decisions', async () => {
      assert.equal((await send('POST', '/discoveries', { sourceProvider: 'cleveland', objectIds: ['777'] })).body.added, 1);
      assert.equal((await send('POST', '/discoveries', { sourceProvider: 'met', objectIds: ['777'] }, 'other')).body.added, 1);
      assert.equal((await send('GET', '/discoveries?status=all')).body.total, 3);
      assert.equal((await send('GET', '/discoveries?status=all', undefined, 'other')).body.total, 1);
      const preview = await send('POST', '/imports/preview', { sourceProvider: 'met', objectIds: ['777'] });
      assert.equal(preview.status, 201); assert.equal((await pool.query('SELECT count(*) FROM records')).rows[0].count, '0');
      const imported = await send('POST', `/imports/${preview.body.id}/commit`, { rowNumbers: [1] });
      assert.equal(imported.status, 200); assert.equal(imported.body.importedCount, 1);
      const recordId = imported.body.recordIds[0];
      const sameImport = await send('POST', `/imports/${preview.body.id}/commit`, { rowNumbers: [1] });
      assert.equal(sameImport.body.importedCount, 1); assert.equal((await pool.query('SELECT count(*) FROM records')).rows[0].count, '1');
      const dismissed = await send('PATCH', `/discoveries/${id}`, { decision: 'dismissed', expectedRevision: revision });
      await send('POST', `/discoveries/${id}/undo`, { expectedRevision: dismissed.body.item.revision });
      assert.equal((await pool.query('SELECT id FROM records WHERE id=$1', [recordId])).rowCount, 1);
    });
    await t.test('quota, page bounds and concurrent inserts retain bounded rows', async () => {
      await pool.query(`INSERT INTO research_discoveries(user_id,source_provider,source_object_id,title,source_url,retrieved_at)
        SELECT 'quota','met',g::text,'Quota fixture','https://www.metmuseum.org/art/collection/search/'||g,now() FROM generate_series(1,999) g`);
      const outcomes = await Promise.all(['1000', '1001'].map(objectId => send('POST', '/discoveries', { sourceProvider: 'met', objectIds: [objectId] }, 'quota')));
      assert.deepEqual(outcomes.map(r => r.status).sort(), [201, 429]);
      const listing = await send('GET', '/discoveries?status=all&page=40', undefined, 'quota');
      assert.equal(listing.body.total, 1000); assert.equal(listing.body.items.length, 25);
      assert.equal((await send('GET', '/discoveries?page=41')).status, 400);
      assert.equal((await send('GET', '/discoveries?status=approved')).status, 400);
      const repeated = await send('POST', '/discoveries', { sourceProvider: 'met', objectIds: ['1'] }, 'quota');
      assert.equal(repeated.status, 201); assert.equal(repeated.body.existing, 1);
      const bytes = await pool.query("SELECT max(octet_length(title||source_url)) AS max FROM research_discoveries");
      assert(Number(bytes.rows[0].max) <= 8192);
    });
    await t.test('foreign key and compact constraints reject invalid persistent data', async () => {
      await assert.rejects(pool.query("INSERT INTO research_discoveries(user_id,source_provider,source_object_id,title,source_url,retrieved_at) VALUES('missing','met','1','test','https://example.org',now())"), error => error.code === '23503');
      await assert.rejects(pool.query("UPDATE research_discoveries SET title=repeat('x',501) WHERE id=$1", [id]), error => error.code === '23514');
      await assert.rejects(pool.query("UPDATE research_discoveries SET source_object_id='000777' WHERE id=$1", [id]), error => error.code === '23514');
      const before = (await pool.query('SELECT revision FROM research_discoveries WHERE id=$1', [id])).rows[0].revision;
      const failing = await pool.connect();
      try {
        await failing.query('BEGIN');
        await failing.query("UPDATE research_discoveries SET decision='dismissed',revision=revision+1 WHERE id=$1", [id]);
        await assert.rejects(failing.query("UPDATE research_discoveries SET decision='invalid' WHERE id=$1", [id]));
        await failing.query('ROLLBACK');
      } finally { failing.release(); }
      assert.equal((await pool.query('SELECT revision FROM research_discoveries WHERE id=$1', [id])).rows[0].revision, before);
    });
    await t.test('keyword rediscovery reads private durable decisions without writes or resetting them', async () => {
      const before = (await send('GET', `/discoveries/${id}`)).body.item;
      const dismissed = await send('PATCH', `/discoveries/${id}`, { decision: 'dismissed', expectedRevision: before.revision });
      assert.equal(dismissed.status, 200);
      const rowsBefore = (await pool.query('SELECT count(*) FROM research_discoveries')).rows[0].count;
      const recordsBefore = (await pool.query('SELECT count(*) FROM records')).rows[0].count;
      await stop(); await pool.end(); pool = makePool(); await start();
      const search = await send('GET', '/discovery/search?provider=met&q=fake');
      assert.equal(search.status, 200); assert.equal(search.body.items.length, 1);
      const item = search.body.items[0];
      assert.equal(item.objectId, '777'); assert.equal(item.researchList.id, id);
      assert.equal(item.researchList.decision, 'dismissed'); assert.equal(item.researchList.previousDecision, 'kept');
      assert.equal(item.researchList.revision, dismissed.body.item.revision);
      const other = await send('GET', '/discovery/search?provider=met&q=fake', undefined, 'other');
      assert.equal(other.status, 200); assert.equal(other.body.items[0].researchList.decision, 'pending');
      assert.notEqual(other.body.items[0].researchList.id, id);
      const unsaved = await send('GET', '/discovery/search?provider=met&q=fake', undefined, 'new-account');
      assert.equal(unsaved.status, 200); assert.equal(unsaved.body.items[0].researchList, null);
      await pool.query("INSERT INTO users(id,email,name) VALUES('new-account','new-account@example.test','New account')");
      const savedFromSearch = await send('POST', '/discoveries', { sourceProvider: unsaved.body.provider, objectIds: unsaved.body.items.map(r => r.objectId) }, 'new-account');
      assert.equal(savedFromSearch.status, 201); assert.equal(savedFromSearch.body.added, 1);
      const savedItem = (await send('GET', '/discoveries', undefined, 'new-account')).body.items[0];
      assert.equal(savedItem.decision, 'pending');
      const keptFromSearch = await send('PATCH', `/discoveries/${savedItem.id}`, { decision: 'kept', expectedRevision: savedItem.revision }, 'new-account');
      assert.equal(keptFromSearch.status, 200);
      const remembered = await send('GET', '/discovery/search?provider=met&q=fake', undefined, 'new-account');
      assert.equal(remembered.body.items[0].researchList.decision, 'kept');
      const addedAgain = await send('POST', '/discoveries', { sourceProvider: search.body.provider, objectIds: search.body.items.map(r => r.objectId) });
      assert.equal(addedAgain.status, 201); assert.equal(addedAgain.body.existing, 1); assert.equal(addedAgain.body.added, 0);
      assert.equal((await send('GET', `/discoveries/${id}`)).body.item.revision, dismissed.body.item.revision);
      const undone = await send('POST', `/discoveries/${id}/undo`, { expectedRevision: item.researchList.revision });
      assert.equal(undone.status, 200); assert.equal(undone.body.item.decision, 'kept');
      const restored = await send('GET', '/discovery/search?provider=met&q=fake');
      assert.equal(restored.body.items[0].researchList.decision, 'kept');
      assert.equal(Number((await pool.query('SELECT count(*) FROM research_discoveries')).rows[0].count), Number(rowsBefore) + 1);
      assert.equal((await pool.query('SELECT count(*) FROM records')).rows[0].count, recordsBefore);
    });
  } finally {
    globalThis.fetch = realFetch;
    await stop();
    if (pool) await pool.end();
    if (created) {
      assert.match(schema, /^discovery_test_\d{13}_[a-f0-9]{12}$/);
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      assert.equal((await admin.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema])).rowCount, 0);
    }
    await admin.end();
  }
});

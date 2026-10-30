const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { randomUUID } = require('node:crypto');
for (const [name, exports] of [['@clerk/express', { getAuth: req => ({ userId: req.headers['x-user'] }) }], ['../dist/config/env', { ENV: { NODE_ENV: 'test', ALLOWED_CLERK_USER_IDS: 'owner,reader' } }]]) {
    const filename = require.resolve(name);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const { requireSiteAccess } = require('../dist/middleware/requireSiteAccess');
const { createResearchRouter } = require('../dist/research/router');
function fixture() {
    let state = { jobs: [], records: [], collections: [], members: [], writes: 0 };
    let tail = Promise.resolve(), failAfterRecords = null;
    const query = async (sql, v = []) => {
        let rows = [], rowCount = 0;
        const row = r => {
            rows = r ? [structuredClone(r)] : [];
            rowCount = rows.length;
        };
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.includes('set_config') || sql.includes('pg_advisory_xact_lock'))
            return { rows, rowCount };
        if (sql.startsWith('INSERT INTO research_images') || sql.startsWith('INSERT INTO research_history') || sql.startsWith('INSERT INTO inscriptions') || sql.startsWith('UPDATE records SET updated_at')) {
            state.writes++;
            return { rows: [{}], rowCount: 1 };
        }
        if (sql.startsWith('DELETE FROM research_imports'))
            return { rows, rowCount };
        if (sql.startsWith('SELECT count(*) FROM research_imports'))
            row({ count: state.jobs.filter(j => j.user_id === v[0]).length });
        else if (sql.startsWith('INSERT INTO research_imports')) {
            const j = { id: randomUUID(), user_id: v[0], source_type: v[1], source_provider: v[2], payload: JSON.parse(v[3]), status: 'preview', created_at: new Date().toISOString() };
            state.jobs.push(j);
            row(j);
        }
        else if (sql.startsWith('SELECT * FROM research_imports WHERE id='))
            row(state.jobs.find(j => j.id === v[0] && j.user_id === v[1]));
        else if (sql.startsWith('SELECT * FROM research_imports WHERE user_id=')) {
            rows = structuredClone(state.jobs.filter(j => j.user_id === v[0]));
            rowCount = rows.length;
        }
        else if (sql.startsWith('UPDATE research_imports')) {
            const j = state.jobs.find(j => j.id === v[0]);
            j.payload = JSON.parse(v[1]);
            j.status = v[2];
            row(j);
        }
        else if (sql.startsWith('SELECT id FROM records WHERE source_provider='))
            row(state.records.find(r => r.source_provider === v[0] && r.source_object_id === v[1]));
        else if (sql.startsWith('SELECT id FROM records WHERE lower(museum_name)='))
            row(state.records.find(r => r.museum_name?.toLowerCase() === v[0].toLowerCase() && r.museum_number === v[1]));
        else if (sql.startsWith('SELECT id FROM records WHERE hhw_identifier='))
            row(state.records.find(r => r.hhw_identifier === v[0]));
        else if (sql.startsWith('INSERT INTO records(')) {
            if (failAfterRecords !== null && --failAfterRecords === 0) {
                failAfterRecords = null;
                throw Error('Injected database failure');
            }
            const keys = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',');
            const r = { id: randomUUID(), ...Object.fromEntries(keys.map((k, i) => [k, v[i]])) };
            state.records.push(r);
            state.writes++;
            row(r);
        }
        else if (sql.startsWith('SELECT * FROM collections WHERE id='))
            row(state.collections.find(c => c.id === v[0]));
        else if (sql.startsWith('SELECT * FROM records WHERE id='))
            row(state.records.find(r => r.id === v[0]));
        else if (sql.startsWith('SELECT c.*')) {
            const items = state.collections.filter(c => !v[0] || c.id === v[0]).map(c => ({ ...c, userId: c.user_id, recordCount: state.members.filter(m => m.collection_id === c.id).length }));
            rows = structuredClone(items);
            rowCount = rows.length;
        }
        else if (sql.startsWith('INSERT INTO collections')) {
            const c = { id: randomUUID(), title: v[0], description: v[1], time_period: v[2], image_url: v[3], user_id: v[4] };
            state.collections.push(c);
            row(c);
        }
        else if (sql.startsWith('SELECT count(*) FROM records WHERE id='))
            row({ count: state.records.filter(r => v[0].includes(r.id)).length });
        else if (sql.startsWith('INSERT INTO research_memberships')) {
            for (const id of new Set(v[1]))
                if (!state.members.some(m => m.collection_id === v[0] && m.record_id === id)) {
                    state.members.push({ collection_id: v[0], record_id: id });
                    rowCount++;
                }
        }
        else if (sql.startsWith('SELECT count(*) FROM research_memberships'))
            row({ count: state.members.filter(m => m.collection_id === v[0]).length });
        else if (sql.startsWith('UPDATE records SET collection_id=NULL')) {
            rowCount = 0;
        }
        else if (sql.startsWith('DELETE FROM collections')) {
            state.collections = state.collections.filter(c => c.id !== v[0]);
            state.members = state.members.filter(m => m.collection_id !== v[0]);
            rowCount = 1;
        }
        else if (sql.startsWith('UPDATE collections')) {
            rowCount = 1;
        }
        else
            throw Error('Unhandled fixture SQL ' + sql);
        return { rows, rowCount };
    };
    return { query, injectRecordFailure(count) {
            failAfterRecords = count;
        }, get state() {
            return state;
        }, async connect() {
            const previous = tail;
            let unlock;
            tail = new Promise(r => unlock = r);
            await previous;
            const snapshot = structuredClone(state);
            return { async query(sql, v) {
                    if (sql === 'ROLLBACK') {
                        state = snapshot;
                        return { rows: [], rowCount: 0 };
                    }
                    return query(sql, v);
                }, release() {
                    unlock();
                } };
        } };
}
let server, base, pool;
before(async () => {
    pool = fixture();
    const app = express();
    app.use(express.json());
    app.use(requireSiteAccess);
    app.use('/api/research', createResearchRouter(pool));
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + server.address().port + '/api/research';
});
after(async () => {
    await new Promise(resolve => server.close(resolve));
});
const request = (url, options = {}, user = 'owner') => fetch(base + url, { ...options, headers: { 'x-user': user, ...options.headers } });
const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function preview(csv) {
    const f = new FormData();
    f.set('file', new Blob([csv], { type: 'text/csv' }), 'records.csv');
    const r = await request('/imports/preview', { method: 'POST', body: f });
    assert.equal(r.status, 201, await r.clone().text());
    return r.json();
}
test('research API uses the existing approved-account gate for every route', async () => {
    for (const route of ['/sources', '/collections', '/imports', '/records']) {
        assert.equal((await request(route, {}, '')).status, 401);
        assert.equal((await request(route, {}, 'outsider')).status, 403);
    }
    assert.equal((await request('/sources', {}, 'reader')).status, 200);
});
test('persisted preview writes no artifacts, flags repeated rows, and owner-only jobs reload', async () => {
    const p = await preview('Title,Museum,Accession Number,Materials\nCoin,Met,A1,\nSecond coin,Met,A1,\n');
    assert.equal(p.summary.total, 2);
    assert.equal(p.summary.duplicates, 1);
    assert.equal(p.rows[0].data.materials, null);
    assert.equal(pool.state.writes, 0);
    assert.equal((await request('/imports/' + p.id, {}, 'reader')).status, 404);
    assert.equal((await request('/imports/' + p.id + '/commit', { method: 'POST', ...json({}) }, 'reader')).status, 404);
    const reload = await (await request('/imports/' + p.id)).json();
    assert.equal(reload.rows[0].data.itemName, 'Coin');
    const committed = await (await request('/imports/' + p.id + '/commit', { method: 'POST', ...json({ skipDuplicates: true }) })).json();
    assert.equal(committed.importedCount, 1);
    assert.equal(committed.skippedCount, 1);
    assert.equal(committed.remaining, 0);
    assert.equal(pool.state.writes, 1);
    const retry = await (await request('/imports/' + p.id + '/commit', { method: 'POST', ...json({}) })).json();
    assert.equal(retry.recordIds.length, 0);
    assert.equal(pool.state.writes, 1);
});
test('chunked concurrent commits resume without duplicate artifacts or replacing researcher edits', async () => {
    const input = 'Title,HHW\n' + Array.from({ length: 40 }, (_, i) => 'Row ' + i + ',JOB-' + i).join('\n');
    const p = await preview(input);
    const [a, b] = await Promise.all([request('/imports/' + p.id + '/commit', { method: 'POST', ...json({}) }), request('/imports/' + p.id + '/commit', { method: 'POST', ...json({}) })]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const result = await b.json();
    assert.equal(result.importedCount, 40);
    assert.equal(result.remaining, 0);
    assert.equal(pool.state.records.filter(r => r.hhw_identifier?.startsWith('JOB-')).length, 40);
    const original = pool.state.records.find(r => r.hhw_identifier === 'JOB-0');
    original.item_name = 'Researcher correction';
    const duplicate = await preview('Title,HHW\nOverwrite attempt,JOB-0');
    assert.equal(duplicate.rows[0].duplicate, true);
    const r = await (await request('/imports/' + duplicate.id + '/commit', { method: 'POST', ...json({}) })).json();
    assert.equal(r.importedCount, 0);
    assert.equal(r.skippedCount, 1);
    assert.equal(original.item_name, 'Researcher correction');
});
test('invalid rows retain errors while selected commits leave remaining valid work visible', async () => {
    const p = await preview('Title,HHW\nFirst,SELECT-A\n,SELECT-B\nThird,SELECT-C');
    assert.equal(p.summary.invalid, 1);
    const result = await (await request('/imports/' + p.id + '/commit', { method: 'POST', ...json({ rowNumbers: [2] }) })).json();
    assert.equal(result.importedCount, 1);
    assert.equal(result.errorCount, 1);
    assert.equal(result.remaining, 1);
    assert.equal(result.status, 'partial');
    const reload = await (await request('/imports/' + p.id)).json();
    assert(reload.rows[1].errors.length);
    assert.equal(reload.progress.remaining, 1);
    assert.equal((await request('/imports/' + p.id + '/commit', { method: 'POST', ...json({ skipDuplicates: false }) })).status, 400);
});
test('collections have creator metadata, accept readable foreign records and reject non-owner mutations', async () => {
    const r = await request('/collections', { method: 'POST', ...json({ title: 'Study collection', userId: 'reader' }) });
    assert.equal(r.status, 201);
    const collection = await r.json();
    assert.equal(collection.userId, 'owner');
    const foreign = { id: randomUUID(), user_id: 'reader', item_name: 'Foreign artifact' };
    pool.state.records.push(foreign);
    assert.equal((await request('/collections/' + collection.id + '/records', { method: 'POST', ...json({ recordIds: [foreign.id] }) }, 'reader')).status, 403);
    const added = await request('/collections/' + collection.id + '/records', { method: 'POST', ...json({ recordIds: [foreign.id, foreign.id] }) });
    assert.equal(added.status, 200);
    assert.equal((await added.json()).added, 1);
    assert.equal(foreign.user_id, 'reader');
    assert.equal((await request('/collections/' + collection.id, { method: 'DELETE' }, 'reader')).status, 403);
    assert.equal((await request('/collections/' + collection.id, { method: 'DELETE' })).status, 204);
    assert(pool.state.records.some(r => r.id === foreign.id));
});
test('unowned legacy collections stay readable and immutable; restore refuses missing/concurrent revision guards', async () => {
    const legacy = { id: randomUUID(), title: 'Legacy', user_id: null };
    pool.state.collections.push(legacy);
    assert.equal((await request('/collections/' + legacy.id)).status, 200);
    assert.equal((await request('/collections/' + legacy.id, { method: 'PATCH', ...json({ title: 'Claim' }) })).status, 403);
    const record = { id: randomUUID(), user_id: 'owner', revision: 5 };
    pool.state.records.push(record);
    const restore = '/records/' + record.id + '/history/' + randomUUID() + '/restore';
    assert.equal((await request(restore, { method: 'POST', ...json({}) })).status, 400);
    assert.equal((await request(restore, { method: 'POST', ...json({ expectedRevision: 4 }) })).status, 409);
    assert.equal((await request(restore, { method: 'POST', ...json({ expectedRevision: 5 }) }, 'reader')).status, 403);
});
test('museum commits retain durable source provenance and source image links without fetching originals', async () => {
    const realFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, options) => {
        if (String(url).startsWith('https://collectionapi.metmuseum.org/')) {
            calls.push(String(url));
            return Response.json({ objectID: 777, title: 'Imported museum coin', objectName: 'Coin', isPublicDomain: true, primaryImageSmall: 'https://images.metmuseum.org/CRDImages/gr/web-large/777.jpg', creditLine: 'Museum credit' });
        }
        return realFetch(url, options);
    };
    try {
        const previewResponse = await request('/imports/preview', { method: 'POST', ...json({ sourceProvider: 'met', objectIds: ['777'] }) });
        assert.equal(previewResponse.status, 201);
        const p = await previewResponse.json();
        assert.equal(p.rows[0].data.imagery, null);
        const result = await request('/imports/' + p.id + '/commit', { method: 'POST', ...json({}) });
        assert.equal(result.status, 200, await result.clone().text());
        const imported = pool.state.records.find(r => r.source_object_id === '777');
        assert.equal(imported.source_provenance.credit, 'Museum credit');
        assert.equal(imported.source_provenance.importJobId, p.id);
        assert.equal(imported.user_id, 'owner');
        assert.equal(imported.review_status, undefined);
        assert.equal(calls.length, 1);
        assert(calls[0].endsWith('/objects/777'));
    }
    finally {
        globalThis.fetch = realFetch;
    }
});
test('unexpected chunk failure rolls back artifacts and persisted progress, then retries cleanly', async () => {
    const p = await preview('Title,HHW\nRetry one,FAIL-1\nRetry two,FAIL-2\nRetry three,FAIL-3');
    const before = pool.state.records.length;
    pool.injectRecordFailure(2);
    const failed = await request('/imports/' + p.id + '/commit', { method: 'POST', ...json({}) });
    assert.equal(failed.status, 500);
    assert.equal(pool.state.records.length, before);
    const reload = await (await request('/imports/' + p.id)).json();
    assert.equal(reload.progress.imported, 0);
    assert.equal(reload.progress.remaining, 3);
    const retry = await (await request('/imports/' + p.id + '/commit', { method: 'POST', ...json({}) })).json();
    assert.equal(retry.importedCount, 3);
    assert.equal(retry.remaining, 0);
    assert.equal(pool.state.records.length, before + 3);
});

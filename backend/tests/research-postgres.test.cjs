const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { parseSearch } = require('../dist/research/validation');
const { recordSelect, transaction, event } = require('../dist/research/database');
const { reserve } = require('../dist/research/images');
const { prepareExport } = require('../dist/research/export');
const schema = process.env.RESEARCH_TEST_SCHEMA;
const enabled = Boolean(process.env.DATABASE_URL && schema);
async function withResearchHttp(pool, owner, callback) {
    const http = require('node:http');
    const express = require('express');
    const filename = require.resolve('@clerk/express');
    const previous = require.cache[filename];
    require.cache[filename] = {
        id: filename, filename, loaded: true,
        exports: { getAuth: req => ({ userId: req.headers['x-research-owner'] }) },
    };
    const { createResearchRouter } = require('../dist/research/router');
    if (previous)
        require.cache[filename] = previous;
    else
        delete require.cache[filename];
    const app = express();
    app.use(express.json());
    app.use('/api/research', createResearchRouter(pool));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const send = (method, route, body) => {
        const multipart = body instanceof FormData;
        return fetch(`http://127.0.0.1:${server.address().port}/api/research${route}`, {
            method,
            headers: { 'x-research-owner': owner, ...(multipart ? {} : { 'content-type': 'application/json' }) },
            ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
        });
    };
    try {
        await callback(send);
    }
    finally {
        await new Promise(resolve => server.close(resolve));
    }
}
// This suite never creates a schema or runs a migration. The parent must explicitly
// supply an empty disposable schema with baseline + 001 already applied.
test('real PostgreSQL research semantics in explicitly supplied disposable schema', { skip: !enabled }, async (t) => {
    assert.match(schema, /^(research_test|test_research)_[a-z0-9_]{8,48}$/);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=' + schema + ',pg_catalog' });
    const owner = 'research-test-' + randomUUID(), ids = [randomUUID(), randomUUID(), randomUUID()], collection = randomUUID();
    try {
        assert.equal(Number((await pool.query('SELECT count(*) FROM records')).rows[0].count), 0, 'Use a fresh isolated schema');
        assert.equal((await pool.query("SELECT version FROM research_migrations WHERE version='research_catalog_001'")).rowCount, 1);
        await pool.query('INSERT INTO records(id,user_id,item_name,museum_name,materials,date_start,date_end,source_provider,source_object_id) VALUES($1,$4,$5,$6,$7,-50,-40,$8,$9),($2,$4,$10,$6,NULL,NULL,NULL,NULL,NULL),($3,$4,$11,$6,$7,10,20,NULL,NULL)', [...ids, owner, 'Bronze coin', 'Test Museum', 'bronze', 'met', '123', 'Stone tablet', 'Other coin']);
        await pool.query('INSERT INTO inscriptions(record_id,content,translation,language,script,serifs_present,stopmarks_present) VALUES($1,$2,$3,$4,$4,false,false)', [ids[1], '\u03c7\u03b1\u1fd6\u03c1\u03b5', 'salutation peace', 'Greek']);
        await t.test('full text searches metadata, literal original text and translation independently', async () => {
            for (const [q, expected] of [['bronze', ids[0]], ['\u03c7\u03b1\u1fd6\u03c1\u03b5', ids[1]], ['salutation', ids[1]], ['tablet peace', ids[1]]]) {
                const s = parseSearch({ q }, owner);
                const rows = (await pool.query('SELECT r.id FROM records r ' + s.where, s.values)).rows;
                assert(rows.some(r => r.id === expected));
            }
            const s = parseSearch({ q: "' OR true --" }, owner);
            assert.equal((await pool.query('SELECT r.id FROM records r ' + s.where, s.values)).rowCount, 0);
        });
        await t.test('signed date overlap excludes unknown dates and sort ties use identifiers', async () => {
            const s = parseSearch({ dateFrom: '-100', dateTo: '0' }, owner);
            assert.deepEqual((await pool.query('SELECT r.id FROM records r ' + s.where + ' ORDER BY ' + s.order, s.values)).rows.map(r => r.id), [ids[0]]);
            const all = parseSearch({ sort: 'title' }, owner);
            const rows = (await pool.query(recordSelect + ' ORDER BY ' + all.order)).rows;
            assert.equal(rows.length, 3);
            assert.equal(rows[1].inscriptions.length + rows[2].inscriptions.length, 1);
        });
        await t.test('many-to-many membership does not transfer ownership or delete artifacts', async () => {
            await pool.query('INSERT INTO collections(id,title,description,time_period,user_id) VALUES($1,$2,$3,$3,$4)', [collection, 'Research', '', owner]);
            await pool.query('INSERT INTO research_memberships VALUES($1,$2),($1,$3) ON CONFLICT DO NOTHING', [collection, ids[0], ids[1]]);
            const s = parseSearch({ collectionId: collection }, owner);
            assert.equal((await pool.query('SELECT r.id FROM records r ' + s.where, s.values)).rowCount, 2);
            await pool.query('DELETE FROM collections WHERE id=$1', [collection]);
            assert.equal((await pool.query('SELECT id FROM records WHERE id=ANY($1::uuid[])', [ids])).rowCount, 3);
        });
        await t.test('source identities are unique and inscription edits create nullable snapshots and parent revisions', async () => {
            await assert.rejects(() => pool.query('INSERT INTO records(user_id,item_name,source_provider,source_object_id) VALUES($1,$2,$3,$4)', [owner, 'duplicate', 'met', '123']), e => e.code === '23505');
            const before = (await pool.query('SELECT revision FROM records WHERE id=$1', [ids[1]])).rows[0].revision;
            await pool.query('UPDATE inscriptions SET translation=$2 WHERE record_id=$1', [ids[1], 'new translation']);
            const after = (await pool.query('SELECT revision FROM records WHERE id=$1', [ids[1]])).rows[0].revision;
            assert(after > before);
            const snapshot = (await pool.query('SELECT snapshot FROM research_history WHERE record_id=$1 ORDER BY sequence DESC LIMIT 1', [ids[1]])).rows[0].snapshot;
            assert.equal(snapshot.inscriptions[0].translation, 'new translation');
            assert.equal(snapshot.record.museum_country, null);
        });
        await t.test('bounded cursor exports execute and preserve text in JSON', async () => {
            const c = await pool.connect();
            try {
                await c.query('BEGIN');
                const bytes = await prepareExport(c, parseSearch({}, owner), 'json');
                assert.equal(JSON.parse(bytes).length, 3);
                assert(bytes.includes(Buffer.from('\u03c7\u03b1\u1fd6\u03c1\u03b5')));
                await c.query('ROLLBACK');
            }
            finally {
                c.release();
            }
        });
        await t.test('real competing reservations cannot exceed persistent quota', async () => {
            const blobs = [randomUUID(), randomUUID()];
            const old = Number((await pool.query('SELECT used_bytes FROM research_storage WHERE id=1')).rows[0].used_bytes);
            try {
                const results = await Promise.allSettled(blobs.map(b => reserve(pool, owner, b, 'local', 6, old + 10)));
                assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
                assert.equal(Number((await pool.query('SELECT used_bytes FROM research_storage WHERE id=1')).rows[0].used_bytes), old + 6);
            }
            finally {
                const r = await pool.query('DELETE FROM research_blobs WHERE id=ANY($1::uuid[]) RETURNING byte_size', [blobs]);
                await pool.query('UPDATE research_storage SET used_bytes=used_bytes-$1 WHERE id=1', [r.rows.reduce((n, r) => n + Number(r.byte_size), 0)]);
            }
        });
        await t.test('catalog primary image is null or compact, with no multiplied rows or exposed storage keys', async () => {
            const id = ids[0];
            const blob = randomUUID();
            const image = randomUUID();
            const externalUrl = 'https://museum.example/selected.jpg';
            const load = async () => (await pool.query(recordSelect + ' WHERE r.id=$1', [id])).rows;
            try {
                assert.equal((await load())[0].primaryImage, null);
                await pool.query(`INSERT INTO research_images(record_id,source_url,caption)
    VALUES($1,$2,'Unselected'),($1,$3,'Also unselected')`, [id, externalUrl, 'https://museum.example/other.jpg']);
                assert.equal((await load())[0].primaryImage, null);
                await pool.query(`INSERT INTO research_images(id,record_id,source_url,is_primary,caption)
    VALUES($1,$2,$3,true,'Selected')`, [image, id, externalUrl]);
                const external = await load();
                assert.equal(external.length, 1);
                assert.deepEqual(external[0].primaryImage, {
                    id: image, url: externalUrl, thumbnailUrl: externalUrl, storageKind: 'external', caption: 'Selected',
                });
                await reserve(pool, owner, blob, 'local', 2, 5 * 1024 ** 3);
                await pool.query("UPDATE research_blobs SET state='ready',mime='image/png' WHERE id=$1", [blob]);
                await pool.query('UPDATE research_images SET is_primary=false WHERE record_id=$1', [id]);
                await pool.query('UPDATE research_images SET source_url=NULL,blob_id=$2,is_primary=true WHERE id=$1', [image, blob]);
                const stored = await load();
                assert.equal(stored.length, 1);
                const url = `/api/research/records/${id}/images/${image}/file`;
                assert.deepEqual(stored[0].primaryImage, {
                    id: image, url, thumbnailUrl: url + '?thumbnail=1', storageKind: 'local', caption: 'Selected',
                });
                assert.equal((await pool.query(recordSelect)).rowCount, 3);
                await pool.query('UPDATE research_images SET is_primary=false WHERE id=$1', [image]);
                assert.equal((await load())[0].primaryImage, null);
            }
            finally {
                await pool.query('DELETE FROM research_images WHERE record_id=$1', [id]);
                const removed = await pool.query('DELETE FROM research_blobs WHERE id=$1 RETURNING byte_size', [blob]);
                if (removed.rowCount)
                    await pool.query('UPDATE research_storage SET used_bytes=used_bytes-$1 WHERE id=1', [removed.rows[0].byte_size]);
            }
        });
        await t.test('substantive record edits invalidate review while notes, images and no-op edits preserve it', async () => {
            const id = ids[2];
            const oldDate = '2001-01-01T00:00:00.000Z';
            const load = async () => (await pool.query('SELECT * FROM records WHERE id=$1', [id])).rows[0];
            const mark = () => pool.query(`UPDATE records SET review_status='reviewed',review_notes='Keep this guidance',
   reviewer_id=$2,reviewed_at=$3 WHERE id=$1`, [id, owner, oldDate]);
            await mark();
            await pool.query('UPDATE records SET review_notes=$2 WHERE id=$1', [id, 'Updated review notes']);
            assert.equal((await load()).review_status, 'reviewed');
            assert.equal((await load()).reviewed_at.toISOString(), oldDate);
            await transaction(pool, owner, c => event(c, id, owner, 'image_update', 'Changed image caption'));
            await pool.query('UPDATE records SET image_source_url=$2,item_name=item_name WHERE id=$1', [id, 'https://museum.example/replacement.jpg']);
            assert.equal((await load()).review_status, 'reviewed');
            assert.equal((await load()).reviewed_at.toISOString(), oldDate);
            await transaction(pool, owner, c => c.query('UPDATE records SET item_name=$2 WHERE id=$1', [id, 'Substantive correction']));
            const changed = await load();
            assert.equal(changed.review_status, 'draft');
            assert.equal(changed.reviewed_at, null);
            assert.equal(changed.reviewer_id, null);
            assert.equal(changed.review_notes, 'Updated review notes');
            const audit = (await pool.query(`SELECT actor_id,snapshot FROM research_history
   WHERE record_id=$1 AND snapshot IS NOT NULL ORDER BY sequence DESC LIMIT 1`, [id])).rows[0];
            assert.equal(audit.actor_id, owner);
            assert.equal(audit.snapshot.record.review_status, 'draft');
            assert.equal(audit.snapshot.record.item_name, 'Substantive correction');
        });
        await t.test('inscription insert, substantive update and delete invalidate review atomically after the child write', async () => {
            const id = ids[0];
            const child = randomUUID();
            const mark = () => pool.query(`UPDATE records SET review_status='reviewed',reviewer_id=$2,
   reviewed_at='2001-01-01' WHERE id=$1`, [id, owner]);
            const load = async () => (await pool.query('SELECT * FROM records WHERE id=$1', [id])).rows[0];
            await mark();
            await transaction(pool, owner, c => c.query(`INSERT INTO inscriptions(id,record_id,content,language,script,
   translation,serifs_present,stopmarks_present) VALUES($1,$2,'D M','Latin','Latin',NULL,false,false)`, [child, id]));
            assert.equal((await load()).review_status, 'draft');
            await mark();
            await pool.query('UPDATE inscriptions SET content=content WHERE id=$1', [child]);
            assert.equal((await load()).review_status, 'reviewed');
            const revision = (await load()).revision;
            await transaction(pool, owner, c => c.query('UPDATE inscriptions SET translation=$2 WHERE id=$1', [child, 'To the spirits']));
            assert.equal((await load()).review_status, 'draft');
            assert((await load()).revision > revision);
            const changed = (await pool.query(`SELECT actor_id,snapshot FROM research_history
   WHERE record_id=$1 ORDER BY sequence DESC LIMIT 1`, [id])).rows[0];
            assert.equal(changed.actor_id, owner);
            assert.equal(changed.snapshot.record.review_status, 'draft');
            assert.equal(changed.snapshot.inscriptions[0].translation, 'To the spirits');
            await mark();
            await transaction(pool, owner, c => c.query('DELETE FROM inscriptions WHERE id=$1', [child]));
            assert.equal((await load()).review_status, 'draft');
            assert.equal((await load()).reviewed_at, null);
            const deleted = (await pool.query(`SELECT snapshot FROM research_history WHERE record_id=$1
   ORDER BY sequence DESC LIMIT 1`, [id])).rows[0].snapshot;
            assert.deepEqual(deleted.inscriptions, []);
            assert.equal(deleted.record.review_status, 'draft');
        });
        await t.test('HTTP review notes preserve review time; explicit review timestamps and guarded restore use real triggers', async () => {
            const id = ids[2];
            await withResearchHttp(pool, owner, async (send) => {
                const marked = await send('PATCH', `/records/${id}/review`, { reviewStatus: 'reviewed', notes: 'Explicit assessment' });
                assert.equal(marked.status, 200, await marked.clone().text());
                const reviewed = (await marked.json()).record;
                assert.equal(reviewed.reviewStatus, 'reviewed');
                assert.equal(reviewed.reviewerId, owner);
                assert(reviewed.reviewedAt);
                assert.notEqual(reviewed.reviewedAt, '2001-01-01T00:00:00.000Z');
                const notes = await send('PATCH', `/records/${id}/review`, { notes: 'Notes without re-review' });
                assert.equal(notes.status, 200);
                const noted = (await notes.json()).record;
                assert.equal(noted.reviewStatus, 'reviewed');
                assert.equal(noted.reviewedAt, reviewed.reviewedAt);
                assert.equal(noted.reviewerId, reviewed.reviewerId);
                const snapshot = (await pool.query(`SELECT id FROM research_history WHERE record_id=$1
    AND snapshot IS NOT NULL ORDER BY sequence DESC LIMIT 1`, [id])).rows[0];
                await pool.query('UPDATE records SET item_name=$2 WHERE id=$1', [id, 'Newer text before restore']);
                await send('PATCH', `/records/${id}/review`, { reviewStatus: 'reviewed' });
                const current = (await pool.query('SELECT revision FROM records WHERE id=$1', [id])).rows[0];
                const route = `/records/${id}/history/${snapshot.id}/restore`;
                assert.equal((await send('POST', route, { expectedRevision: current.revision - 1 })).status, 409);
                const restored = await send('POST', route, { expectedRevision: current.revision });
                assert.equal(restored.status, 200, await restored.clone().text());
                const result = (await restored.json()).record;
                assert.equal(result.itemName, noted.itemName);
                assert.equal(result.reviewStatus, 'draft');
                assert.equal(result.reviewedAt, null);
                assert.equal(result.reviewerId, null);
                assert.equal(result.userId, owner);
                const last = (await pool.query('SELECT actor_id,action FROM research_history WHERE record_id=$1 ORDER BY sequence DESC LIMIT 1', [id])).rows[0];
                assert.equal(last.action, 'restore');
                assert.equal(last.actor_id, owner);
            });
        });
        await t.test('spreadsheet HTTP preview and commit persist literal Unicode inscriptions without pseudo metadata columns', async () => {
            await withResearchHttp(pool, owner, async (send) => {
                const literal = '  \u03c7\u03b1\u1fd6\u03c1\u03b5\nD M  ';
                const translated = ' Greetings\nTo the spirits ';
                const quote = value => '"' + value.replace(/"/g, '""') + '"';
                const csv = 'Title,Text,Language,Writing,Translated\n' +
                    ['Literal import', literal, 'Greek', 'Greek', translated].map(quote).join(',') +
                    '\nTranslation only,,,,A translation';
                const form = new FormData();
                form.set('file', new Blob([csv], { type: 'text/csv' }), 'literal.csv');
                form.set('mapping', JSON.stringify({ Text: 'inscriptionContent', Language: 'inscriptionLanguage',
                    Writing: 'inscriptionScript', Translated: 'inscriptionTranslation' }));
                const preview = await send('POST', '/imports/preview', form);
                assert.equal(preview.status, 201, await preview.clone().text());
                const job = await preview.json();
                try {
                    assert.equal(job.summary.invalid, 1);
                    const commit = await send('POST', `/imports/${job.id}/commit`, {});
                    assert.equal(commit.status, 200, await commit.clone().text());
                    const result = await commit.json();
                    assert.equal(result.importedCount, 1);
                    assert.equal(result.errorCount, 1);
                    const row = (await pool.query(recordSelect + ' WHERE r.id=$1', [result.recordIds[0]])).rows[0];
                    assert.equal(row.museum_name, null);
                    assert.equal(row.materials, null);
                    assert.equal(row.inscriptions.length, 1);
                    assert.equal(row.inscriptions[0].content, literal);
                    assert.equal(row.inscriptions[0].translation, translated);
                    assert.equal(row.inscriptions[0].language, 'Greek');
                    assert.equal(row.review_status, 'draft');
                    assert.equal('inscriptionContent' in row, false);
                }
                finally {
                    await pool.query('DELETE FROM research_imports WHERE id=$1 AND user_id=$2', [job.id, owner]);
                }
            });
        });
    }
    finally {
        await pool.query('DELETE FROM records WHERE user_id=$1', [owner]);
        await pool.query('DELETE FROM collections WHERE user_id=$1', [owner]);
        await pool.query('DELETE FROM research_history WHERE owner_id=$1', [owner]);
        await pool.end();
    }
});

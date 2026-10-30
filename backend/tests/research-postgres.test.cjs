const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const clerkFilename = require.resolve('@clerk/express');
require.cache[clerkFilename] = { id: clerkFilename, filename: clerkFilename, loaded: true,
    exports: { getAuth: req => ({ userId: req.headers['x-research-owner'] }) } };
const { parseSearch } = require('../dist/research/validation');
const { recordSelect, transaction, event } = require('../dist/research/database');
const { reserve } = require('../dist/research/images');
const { prepareExport } = require('../dist/research/export');
const schema = process.env.RESEARCH_TEST_SCHEMA;
const enabled = Boolean(process.env.DATABASE_URL && schema);
async function withResearchHttp(pool, owner, callback, allowed = [owner], legacy = false) {
    const http = require('node:http');
    const express = require('express');
    const filename = require.resolve('@clerk/express');
    const previous = require.cache[filename];
    require.cache[filename] = {
        id: filename, filename, loaded: true,
        exports: { getAuth: req => ({ userId: req.headers['x-research-owner'] }) },
    };
    const { createResearchRouter } = require('../dist/research/router');
    require('../dist/middleware/siteAccounts').configureApprovedAccounts(allowed);
    if (previous)
        require.cache[filename] = previous;
    else
        delete require.cache[filename];
    const app = express();
    app.use(express.json());
    app.use(require('../dist/research/access').catalogContext(pool));
    app.use('/api/research', createResearchRouter(pool));
    if (legacy) {
        const configFilename = require.resolve('../dist/config/env');
        require.cache[configFilename] = { id: configFilename, filename: configFilename, loaded: true, exports: { ENV: {} } };
        app.use('/api/records', require('../dist/routes/recordRoutes').default);
        app.use('/api/collections', require('../dist/routes/collectionRoutes').default);
        app.use('/api/ml', require('../dist/routes/mlRoutes').default);
    }
    app.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.message }));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const send = (method, route, body, user = owner) => {
        const multipart = body instanceof FormData;
        return fetch(`http://127.0.0.1:${server.address().port}${route.startsWith('/api/') ? '' : '/api/research'}${route}`, {
            method,
            headers: { 'x-research-owner': user, ...(multipart ? {} : { 'content-type': 'application/json' }) },
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
// supply an empty disposable schema with baseline + 001 + 002 already applied.
test('real PostgreSQL research semantics in explicitly supplied disposable schema', { skip: !enabled }, async (t) => {
    assert.match(schema, /^(research_test|test_research)_[a-z0-9_]{8,48}$/);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=' + schema + ',pg_catalog' });
    const owner = 'research-test-' + randomUUID(), ids = [randomUUID(), randomUUID(), randomUUID()], collection = randomUUID();
    try {
        assert.equal(Number((await pool.query('SELECT count(*) FROM records')).rows[0].count), 0, 'Use a fresh isolated schema');
        assert.equal((await pool.query("SELECT version FROM research_migrations WHERE version='research_catalog_001'")).rowCount, 1);
        assert.equal((await pool.query("SELECT version FROM research_migrations WHERE version='catalog_moderation_002'")).rowCount, 1);
        await pool.query('INSERT INTO users(id,email,name) VALUES($1,$2,$1)', [owner, owner + '@example.test']);
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
        await t.test('publication defaults and invalidation are enforced by database triggers independently of API payloads', async () => {
            const id = randomUUID();
            const child = randomUUID();
            const approve = () => transaction(pool, 'fixture-reviewer', c => c.query(`UPDATE records SET moderation_status='approved',
                moderation_notes='Durable decision',moderated_by='fixture-reviewer',moderated_at=clock_timestamp() WHERE id=$1`, [id]));
            const load = async () => (await pool.query('SELECT * FROM records WHERE id=$1', [id])).rows[0];
            try {
                await pool.query("INSERT INTO records(id,user_id,item_name,moderation_status) VALUES($1,$2,'Pending default','approved')", [id, owner]);
                assert.equal((await load()).moderation_status, 'pending');
                await approve();
                await pool.query("UPDATE records SET item_name=item_name,review_notes='Notes only',review_status='uncertain' WHERE id=$1", [id]);
                await transaction(pool, 'fixture-admin', c => event(c, id, 'fixture-admin', 'image_update', 'Image metadata only'));
                assert.equal((await load()).moderation_status, 'approved');
                await pool.query("UPDATE records SET item_name='Changed text' WHERE id=$1", [id]);
                let changed = await load();
                assert.equal(changed.moderation_status, 'pending');
                assert.equal(changed.moderation_notes, null);
                assert.equal(changed.moderated_by, null);
                assert.equal(changed.moderated_at, null);
                await approve();
                await pool.query(`INSERT INTO inscriptions(id,record_id,content,language,script,translation,serifs_present,stopmarks_present)
                    VALUES($1,$2,'D M','Latin','Latin',NULL,false,false)`, [child, id]);
                assert.equal((await load()).moderation_status, 'pending');
                await approve();
                await pool.query('UPDATE inscriptions SET content=content WHERE id=$1', [child]);
                assert.equal((await load()).moderation_status, 'approved');
                await pool.query("UPDATE inscriptions SET translation='Literal translation' WHERE id=$1", [child]);
                assert.equal((await load()).moderation_status, 'pending');
                await approve();
                await pool.query('DELETE FROM inscriptions WHERE id=$1', [child]);
                assert.equal((await load()).moderation_status, 'pending');
                const decisions = (await pool.query(`SELECT snapshot FROM research_history WHERE record_id=$1
                    AND snapshot->'record'->>'moderation_status'='approved'`, [id])).rows;
                assert(decisions.some(h => h.snapshot.record.moderation_notes === 'Durable decision'));
                const imageEvent = (await pool.query("SELECT owner_id,actor_id FROM research_history WHERE record_id=$1 AND action='image_update'", [id])).rows[0];
                assert.equal(imageEvent.owner_id, owner);
                assert.equal(imageEvent.actor_id, 'fixture-admin');
            }
            finally {
                await pool.query('DELETE FROM records WHERE id=$1', [id]);
                await pool.query('DELETE FROM research_history WHERE record_id=$1', [id]);
            }
        });
        await t.test('real legacy/research visibility, role changes, decisions, admin edits and restore stay coherent', async () => {
            const other = 'test-other-' + randomUUID(), reviewer = 'test-reviewer-' + randomUUID();
            const admin = 'test-admin-' + randomUUID(), revoked = 'test-revoked-' + randomUUID();
            const accounts = [owner, other, reviewer, admin, revoked];
            const hidden = randomUUID(), published = randomUUID(), ownReview = randomUUID(), ownAdmin = randomUUID();
            const artifactIds = [hidden, published, ownReview, ownAdmin];
            const col = randomUUID(), image = randomUUID();
            const priorAdmins = process.env.CATALOG_ADMIN_USER_IDS;
            process.env.CATALOG_ADMIN_USER_IDS = admin;
            const dbFilename = require.resolve('../dist/db/index');
            const { drizzle } = require('drizzle-orm/node-postgres');
            require.cache[dbFilename] = { id: dbFilename, filename: dbFilename, loaded: true,
                exports: { pool, db: drizzle({ client: pool, schema: require('../dist/db/schema') }) } };
            try {
                for (const user of accounts.slice(1))
                    await pool.query('INSERT INTO users(id,email,name) VALUES($1,$2,$1)', [user, user + '@example.test']);
                await pool.query(`INSERT INTO records(id,user_id,item_name,museum_name,review_status)
                    VALUES($1,$5,'Visibility private needle','Private museum','uncertain'),
                    ($2,$5,'Visibility public needle','Public museum','uncertain'),
                    ($3,$6,'Reviewer own submission',NULL,'draft'),($4,$7,'Admin own submission',NULL,'draft')`, [hidden, published, ownReview, ownAdmin, owner, reviewer, admin]);
                await pool.query("UPDATE records SET moderation_status='approved' WHERE id=$1", [published]);
                await pool.query(`INSERT INTO inscriptions(record_id,content,language,script,translation,serifs_present,stopmarks_present)
                    VALUES($1,'PRIVATE INSCRIPTION','Latin','Latin','Private translation',false,false)`, [hidden]);
                await pool.query('UPDATE records SET inscribed=true WHERE id=$1', [hidden]);
                await pool.query("INSERT INTO research_images(id,record_id,source_url,caption) VALUES($1,$2,'https://museum.example/private.jpg','Private image caption')", [image, hidden]);
                await pool.query("INSERT INTO collections(id,user_id,title,description,time_period) VALUES($1,$2,'Visibility collection','','')", [col, other]);
                await pool.query('INSERT INTO research_memberships VALUES($1,$2),($1,$3)', [col, hidden, published]);
                await withResearchHttp(pool, owner, async (send) => {
                    for (const route of [`/api/records/${hidden}`, `/api/ml/records/${hidden}/check`,
                        `/records/${hidden}/images`, `/records/${hidden}/images/${image}/file`, `/records/${hidden}/history`]) {
                        const response = await send('GET', route, undefined, other);
                        assert.equal(response.status, 404, route + ': ' + await response.clone().text());
                    }
                    for (const route of ['/api/records', '/api/records/search?query=Visibility',
                        `/api/collections/${col}`, `/collections/${col}`,
                        '/records?q=Visibility', '/facets', `/export?format=json&ids=${hidden},${published}`]) {
                        const response = await send('GET', route, undefined, other);
                        assert.equal(response.status, 200, route + ': ' + await response.clone().text());
                        const body = await response.text();
                        assert(!body.includes(hidden), route);
                        assert(!body.includes('Private museum'), route);
                        assert(!body.includes('PRIVATE INSCRIPTION'), route);
                    }
                    const legacyCollection = await (await send('GET', `/api/collections/${col}`, undefined, other)).json();
                    assert.equal(legacyCollection.recordCount, 1);
                    assert.equal(legacyCollection.records.length, 1);
                    assert.equal((await send('POST', `/collections/${col}/records`, { recordIds: [hidden] }, other)).status, 404);
                    assert.equal((await send('PATCH', `/roles/${reviewer}`, { role: 'reviewer' }, owner)).status, 403);
                    assert.equal((await send('PATCH', `/roles/${reviewer}`, { role: 'reviewer' }, admin)).status, 200);
                    assert.equal((await (await send('GET', '/access', undefined, reviewer)).json()).role, 'reviewer');
                    const rolesList = await (await send('GET', '/roles', undefined, admin)).json();
                    assert.equal(rolesList.items.length, 5);
                    assert.equal((await send('PATCH', `/roles/${admin}`, { role: 'reviewer' }, admin)).status, 400);
                    assert.equal((await send('PATCH', `/roles/${other}`, { role: 'admin' }, admin)).status, 400);
                    const ownRevision = (await pool.query('SELECT revision FROM records WHERE id=$1', [ownReview])).rows[0].revision;
                    assert.equal((await send('POST', `/records/${ownReview}/moderate`, { status: 'approved', notes: 'Own decision', expectedRevision: ownRevision }, reviewer)).status, 403);
                    const revision = (await pool.query('SELECT revision FROM records WHERE id=$1', [hidden])).rows[0].revision;
                    const decision = { status: 'approved', notes: 'Publication decision without scholarly verification', expectedRevision: revision };
                    const decisions = await Promise.all([send('POST', `/records/${hidden}/moderate`, decision, reviewer), send('POST', `/records/${hidden}/moderate`, decision, reviewer)]);
                    assert.deepEqual(decisions.map(r => r.status).sort(), [200, 409]);
                    const approved = (await pool.query('SELECT * FROM records WHERE id=$1', [hidden])).rows[0];
                    assert.equal(approved.user_id, owner);
                    assert.equal(approved.review_status, 'uncertain');
                    assert.equal(approved.moderated_by, reviewer);
                    assert.equal((await send('GET', `/api/records/${hidden}`, undefined, other)).status, 200);
                    const unchanged = await (await send('GET', `/api/records/${hidden}`, undefined, owner)).json();
                    const unchangedSave = await send('PUT', `/api/records/${hidden}`, { itemName: unchanged.itemName, inscribed: true, inscriptions: unchanged.inscriptions }, owner);
                    assert.equal(unchangedSave.status, 200, await unchangedSave.clone().text());
                    assert.equal((await unchangedSave.json()).moderationStatus, 'approved');
                    const snapshot = (await pool.query(`SELECT id FROM research_history WHERE record_id=$1 AND snapshot IS NOT NULL
                        ORDER BY sequence DESC LIMIT 1`, [hidden])).rows[0].id;
                    await pool.query("UPDATE records SET image_source_url='https://museum.example/current-image.jpg' WHERE id=$1", [hidden]);
                    const edit = await send('PUT', `/api/records/${hidden}`, { itemName: 'Administrator correction', userId: admin, moderationStatus: 'approved' }, admin);
                    assert.equal(edit.status, 200, await edit.clone().text());
                    const afterEdit = (await pool.query('SELECT * FROM records WHERE id=$1', [hidden])).rows[0];
                    assert.equal(afterEdit.user_id, owner);
                    assert.equal(afterEdit.moderation_status, 'pending');
                    const editAudit = (await pool.query('SELECT owner_id,actor_id FROM research_history WHERE record_id=$1 ORDER BY sequence DESC LIMIT 1', [hidden])).rows[0];
                    assert.equal(editAudit.owner_id, owner);
                    assert.equal(editAudit.actor_id, admin);
                    assert.equal((await send('POST', `/records/${hidden}/history/${snapshot}/restore`, { expectedRevision: afterEdit.revision }, reviewer)).status, 403);
                    const restored = await send('POST', `/records/${hidden}/history/${snapshot}/restore`, { expectedRevision: afterEdit.revision }, admin);
                    assert.equal(restored.status, 200, await restored.clone().text());
                    const restoredRecord = (await restored.json()).record;
                    assert.equal(restoredRecord.userId, owner);
                    assert.equal(restoredRecord.moderationStatus, 'pending');
                    assert.equal(restoredRecord.imageSourceUrl, 'https://museum.example/current-image.jpg');
                    const roleEvents = await pool.query('SELECT actor_id,target_id FROM research_role_history WHERE target_id=$1', [reviewer]);
                    assert(roleEvents.rows.some(r => r.actor_id === admin && r.target_id === reviewer));
                    assert.equal((await send('DELETE', `/api/records/${published}`, undefined, reviewer)).status, 403);
                    assert.equal((await send('DELETE', `/api/records/${published}`, undefined, admin)).status, 200);
                    assert.equal((await pool.query('SELECT id FROM records WHERE id=$1', [published])).rowCount, 0);
                    const deletion = (await pool.query("SELECT owner_id,actor_id FROM research_history WHERE record_id=$1 AND action='delete' ORDER BY sequence DESC LIMIT 1", [published])).rows[0];
                    assert.equal(deletion.owner_id, owner);
                    assert.equal(deletion.actor_id, admin);
                }, accounts, true);
                // Hold the same user lock as role PATCH. The request first sees the old
                // reviewer role, then waits for this revocation before its locked recheck.
                const roleLock = await pool.connect();
                let entered;
                const waiting = new Promise(resolve => entered = resolve);
                const wrappedPool = { query: pool.query.bind(pool), async connect() {
                        const client = await pool.connect();
                        return { query(sql, ...args) {
                                if (sql.startsWith('SELECT id FROM users') && sql.endsWith('FOR SHARE'))
                                    entered();
                                return client.query(sql, ...args);
                            }, release: () => client.release() };
                    } };
                try {
                    await roleLock.query('BEGIN');
                    await roleLock.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [reviewer]);
                    await withResearchHttp(wrappedPool, owner, async (send) => {
                        const revision = (await pool.query('SELECT revision FROM records WHERE id=$1', [hidden])).rows[0].revision;
                        const decision = send('POST', `/records/${hidden}/moderate`, { status: 'approved', notes: 'Revocation race', expectedRevision: revision }, reviewer);
                        let timer;
                        try {
                            await Promise.race([waiting, new Promise((_, reject) => {
                                    timer = setTimeout(() => reject(Error('Decision did not reach the role lock')), 3000);
                                })]);
                        }
                        finally {
                            clearTimeout(timer);
                        }
                        await roleLock.query("UPDATE research_roles SET role='contributor' WHERE user_id=$1", [reviewer]);
                        await roleLock.query('COMMIT');
                        assert.equal((await decision).status, 403);
                        assert.equal((await (await send('GET', '/access', undefined, reviewer)).json()).role, 'contributor');
                        assert.equal((await pool.query('SELECT moderation_status FROM records WHERE id=$1', [hidden])).rows[0].moderation_status, 'pending');
                    }, accounts);
                }
                finally {
                    await roleLock.query('ROLLBACK');
                    roleLock.release();
                }
            }
            finally {
                if (priorAdmins === undefined)
                    delete process.env.CATALOG_ADMIN_USER_IDS;
                else
                    process.env.CATALOG_ADMIN_USER_IDS = priorAdmins;
                await pool.query('DELETE FROM collections WHERE id=$1', [col]);
                await pool.query('DELETE FROM records WHERE id=ANY($1::uuid[])', [artifactIds]);
                await pool.query('DELETE FROM research_history WHERE record_id=ANY($1::uuid[])', [artifactIds]);
                await pool.query('DELETE FROM research_roles WHERE user_id=ANY($1::text[])', [accounts.slice(1)]);
                await pool.query('DELETE FROM research_role_history WHERE target_id=ANY($1::text[])', [accounts.slice(1)]);
                await pool.query('DELETE FROM users WHERE id=ANY($1::text[])', [accounts.slice(1)]);
            }
        });
        await t.test('raw image mutations invalidate editorial approval while retaining scholarly review and audit identities', async () => {
            const id = randomUUID(), image = randomUUID(), actor = 'image-editor-' + randomUUID();
            await pool.query('INSERT INTO records(id,user_id,item_name) VALUES($1,$2,$3)', [id, owner, 'Image trigger fixture']);
            const approve = () => pool.query("UPDATE records SET review_status='reviewed',reviewer_id=$2,reviewed_at='2026-01-01T00:00:00Z',moderation_status='approved',moderation_notes='Publication decision',moderated_by=$2,moderated_at=now() WHERE id=$1", [id, owner]);
            const state = async status => {
                const r = (await pool.query('SELECT * FROM records WHERE id=$1', [id])).rows[0];
                assert.equal(r.moderation_status, status);
                assert.equal(r.review_status, 'reviewed');
                assert.equal(r.reviewer_id, owner);
                assert.equal(r.reviewed_at.toISOString(), '2026-01-01T00:00:00.000Z');
                if (status === 'pending') {
                    assert.equal(r.moderated_by, null);
                    assert.equal(r.moderated_at, null);
                    assert.equal(r.moderation_notes, null);
                }
            };
            const mutate = sql => transaction(pool, actor, c => c.query(sql, [image]));
            await approve();
            await transaction(pool, actor, c => c.query('INSERT INTO research_images(id,record_id,source_url) VALUES($1,$2,$3)', [image, id, 'https://museum.example/original.jpg']));
            await state('pending');
            for (const sql of ["UPDATE research_images SET caption='Obverse' WHERE id=$1",
                "UPDATE research_images SET credit='Museum' WHERE id=$1",
                "UPDATE research_images SET license='CC0' WHERE id=$1",
                "UPDATE research_images SET source_url='https://museum.example/new.jpg' WHERE id=$1",
                'UPDATE research_images SET is_primary=true WHERE id=$1',
                'DELETE FROM research_images WHERE id=$1']) {
                await approve();
                await mutate(sql);
                await state('pending');
            }
            const audit = (await pool.query("SELECT owner_id,actor_id FROM research_history WHERE record_id=$1 AND action LIKE 'image_%'", [id])).rows;
            assert.equal(audit.length, 7);
            assert(audit.every(r => r.owner_id === owner && r.actor_id === actor));
            await pool.query('INSERT INTO research_images(id,record_id,source_url,is_primary) VALUES($1,$2,$3,true)', [image, id, 'https://museum.example/original.jpg']);
            await approve();
            await mutate('UPDATE research_images SET caption=caption,is_primary=is_primary WHERE id=$1');
            await state('approved');
            await withResearchHttp(pool, owner, async send => {
                const result = await send('PATCH', `/records/${id}/images/${image}`, { isPrimary: true });
                assert.equal(result.status, 200, await result.clone().text());
            });
            await state('approved');
            for (const [column, value] of [['image_source_url', 'https://museum.example/legacy.jpg'], ['image_type', 'photograph'], ['image_copyright_details', 'Museum credit']]) {
                await approve();
                await transaction(pool, actor, c => c.query(`UPDATE records SET ${column}=$2 WHERE id=$1`, [id, value]));
                await state('pending');
                await approve();
                await pool.query(`UPDATE records SET ${column}=$2 WHERE id=$1`, [id, value]);
                await state('approved');
            }
        });
        await t.test('legacy draft saves preserve imported NULL facts, guarded owner/admin edits and audited restore', async () => {
            const admin = 'closing-admin-' + randomUUID(), id = randomUUID();
            const beforeAdmins = process.env.CATALOG_ADMIN_USER_IDS;
            process.env.CATALOG_ADMIN_USER_IDS = admin;
            await pool.query('INSERT INTO users(id,email,name) VALUES($1,$2,$1)', [admin, admin + '@example.test']);
            await pool.query('INSERT INTO records(id,user_id,item_name,inscribed) VALUES($1,$2,$3,true)', [id, owner, 'Imported source']);
            await pool.query('INSERT INTO inscriptions(record_id,content,language,script,translation,serifs_present,stopmarks_present) VALUES($1,$2,NULL,NULL,NULL,NULL,NULL)', [id, '  \u03c7\u03b1\u1fd6\u03c1\u03b5\nLiteral original  ']);
            try {
                await withResearchHttp(pool, owner, async send => {
                    const get = async () => (await (await send('GET', `/api/records/${id}`)).json());
                    let current = await get();
                    const initialEntries = current.inscriptions;
                    const snapshot = (await pool.query('SELECT id FROM research_history WHERE record_id=$1 AND snapshot IS NOT NULL ORDER BY sequence DESC LIMIT 1', [id])).rows[0].id;
                    const save = await send('PUT', `/api/records/${id}`, { itemName: 'Corrected title', saveAsDraft: true, expectedRevision: current.revision, inscriptions: current.inscriptions });
                    assert.equal(save.status, 200, await save.clone().text());
                    current = await get();
                    assert.deepEqual(current.inscriptions, initialEntries);
                    assert.equal(current.museumName, null);
                    assert.equal((await send('PUT', `/api/records/${id}`, { inscriptions: current.inscriptions })).status, 400);
                    const metadata = await send('PUT', `/api/records/${id}`, { itemName: 'Administrator edit', expectedRevision: current.revision }, admin);
                    assert.equal(metadata.status, 200, await metadata.clone().text());
                    for (const user of [owner, admin]) {
                        for (const child of [false, true]) {
                            const stale = await send('PUT', `/api/records/${id}`, { itemName: 'Stale lost update', expectedRevision: current.revision,
                                ...(child ? { saveAsDraft: true, inscriptions: [{ ...current.inscriptions[0], content: 'Stale child' }] } : {}) }, user);
                            assert.equal(stale.status, 409, await stale.clone().text());
                            assert.match((await stale.json()).error, /latest record/);
                        }
                    }
                    let after = await get();
                    assert.equal(after.itemName, 'Administrator edit');
                    assert.equal(after.userId, owner);
                    assert.deepEqual(after.inscriptions, initialEntries);
                    const simultaneous = await Promise.all([owner, admin].map(user => send('PUT', `/api/records/${id}`, {
                        itemName: 'Concurrent ' + user, saveAsDraft: true, expectedRevision: after.revision,
                        inscriptions: [{ ...after.inscriptions[0], translation: 'Concurrent ' + user }],
                    }, user)));
                    assert.deepEqual(simultaneous.map(r => r.status).sort(), [200, 409]);
                    const winner = await simultaneous.find(r => r.status === 200).json();
                    after = await get();
                    assert.equal(after.itemName, winner.itemName);
                    assert.equal(after.inscriptions[0].translation, winner.itemName);
                    assert.equal(after.inscriptions[0].id, initialEntries[0].id);
                    await pool.query("UPDATE records SET review_status='reviewed',reviewer_id=$2,reviewed_at=now(),moderation_status='approved',moderation_notes='Ready',moderated_by=$2,moderated_at=now() WHERE id=$1", [id, owner]);
                    after = await get();
                    const legacyImage = await send('PUT', `/api/records/${id}`, {
                        imageSourceUrl: 'https://museum.example/admin-photo.jpg', expectedRevision: after.revision,
                    }, admin);
                    assert.equal(legacyImage.status, 200, await legacyImage.clone().text());
                    after = await get();
                    assert.equal(after.reviewStatus, 'reviewed');
                    assert.equal(after.reviewerId, owner);
                    assert.equal(after.moderationStatus, 'pending');
                    assert.equal(after.userId, owner);
                    const imageAudit = (await pool.query('SELECT owner_id,actor_id FROM research_history WHERE record_id=$1 ORDER BY sequence DESC LIMIT 1', [id])).rows[0];
                    assert.deepEqual(imageAudit, { owner_id: owner, actor_id: admin });
                    const restore = await send('POST', `/records/${id}/history/${snapshot}/restore`, { expectedRevision: after.revision }, admin);
                    assert.equal(restore.status, 200, await restore.clone().text());
                    const restored = (await restore.json()).record;
                    assert.equal(restored.userId, owner);
                    for (const key of ['language', 'script', 'translation', 'serifsPresent', 'stopmarksPresent']) assert.equal(restored.inscriptions[0][key], null);
                    assert.equal(restored.inscriptions[0].content, initialEntries[0].content);
                    assert.equal(restored.imageSourceUrl, 'https://museum.example/admin-photo.jpg');
                    const audit = (await pool.query("SELECT owner_id,actor_id FROM research_history WHERE record_id=$1 AND action='restore' ORDER BY sequence DESC LIMIT 1", [id])).rows[0];
                    assert.deepEqual(audit, { owner_id: owner, actor_id: admin });
                }, [owner, admin], true);
            } finally {
                if (beforeAdmins === undefined) delete process.env.CATALOG_ADMIN_USER_IDS;
                else process.env.CATALOG_ADMIN_USER_IDS = beforeAdmins;
                await pool.query('DELETE FROM users WHERE id=$1', [admin]);
            }
        });
        await t.test('selective unified-vector search returns the right record and records the planner’s chosen path', async () => {
            await pool.query(`INSERT INTO records(user_id,item_name,museum_name)
                SELECT $1,'Plan fixture '||g,CASE WHEN g=1500 THEN 'rarecatalogtoken' ELSE 'Common museum' END
                FROM generate_series(1,3000) g`, [owner]);
            await pool.query('ANALYZE records');
            const s = parseSearch({ q: 'rarecatalogtoken' }, owner);
            const explain = (await pool.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT r.id FROM records r ' + s.where, s.values)).rows[0]['QUERY PLAN'][0];
            const nodes = [];
            const visit = node => { nodes.push(node); for (const child of node.Plans ?? []) visit(child); };
            visit(explain.Plan);
            assert.equal(explain.Plan['Actual Rows'], 1);
            const found = (await pool.query('SELECT r.item_name FROM records r ' + s.where, s.values)).rows;
            assert.deepEqual(found.map(row => row.item_name), ['Plan fixture 1500']);
            // Small or freshly inserted tables may legitimately favor a heap scan.
            // Observe the real plan instead of forcing a physical execution choice.
            t.diagnostic(JSON.stringify({ fixtureRows: 3000, actualRows: explain.Plan['Actual Rows'],
                nodeTypes: nodes.map(n => n['Node Type']), executionMs: explain['Execution Time'],
                indexes: nodes.filter(n => n['Index Name']).map(n => n['Index Name']), sharedHitBlocks: explain.Plan['Shared Hit Blocks'] }));
        });
    }
    finally {
        await pool.query('DELETE FROM records WHERE user_id=$1', [owner]);
        await pool.query('DELETE FROM collections WHERE user_id=$1', [owner]);
        await pool.query('DELETE FROM research_history WHERE owner_id=$1', [owner]);
        await pool.query('DELETE FROM users WHERE id=$1', [owner]);
        await pool.end();
    }
});

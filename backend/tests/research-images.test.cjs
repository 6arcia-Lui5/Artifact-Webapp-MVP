const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { randomUUID } = require('node:crypto');
const { registerImages, reserve, cleanupBlob } = require('../dist/research/images');
const { LocalStorage } = require('../dist/research/storage');
const { ApiError, restoreInscriptions } = require('../dist/research/validation');
const id = randomUUID();
// Transactional state fixture: serializes connection transactions and rolls back a failed write.
// Real filesystem, decoder, multipart parser and HTTP router are exercised below.
function fixture() {
    let state = { used: 0, blobs: [], images: [], events: [] }, tail = Promise.resolve();
    const clone = () => structuredClone(state);
    const query = async (sql, v = []) => {
        let rows = [], rowCount = 0;
        const row = x => {
            rows = x ? [x] : [];
            rowCount = rows.length;
        };
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.includes('set_config'))
            return { rows, rowCount };
        if (sql.startsWith('SELECT * FROM records'))
            row({ id, user_id: 'owner' });
        else if (sql.startsWith('SELECT 1 FROM records'))
            row({ id });
        else if (sql.startsWith('UPDATE records'))
            row({ id });
        else if (sql.startsWith('UPDATE research_storage SET used_bytes=used_bytes+')) {
            if (state.used + v[0] <= v[1]) {
                state.used += v[0];
                row({ used_bytes: state.used });
            }
        }
        else if (sql.startsWith('UPDATE research_storage SET used_bytes=used_bytes-')) {
            state.used -= Number(v[0]);
            row({ used_bytes: state.used });
        }
        else if (sql.startsWith('SELECT used_bytes'))
            row({ used_bytes: state.used });
        else if (sql.startsWith('INSERT INTO research_blobs')) {
            state.blobs.push({ id: v[0], driver: v[1], original_key: v[2], thumbnail_key: v[3], byte_size: v[4], owner_id: v[5], state: 'reserved' });
            row(state.blobs.at(-1));
        }
        else if (sql.startsWith('UPDATE research_blobs')) {
            const b = state.blobs.find(b => b.id === v[0]);
            b.state = 'ready';
            b.mime = v[1];
            row(b);
        }
        else if (sql.startsWith('DELETE FROM research_blobs')) {
            const b = state.blobs.find(b => b.id === v[0]);
            if (b && !state.images.some(i => i.blob_id === b.id)) {
                state.blobs = state.blobs.filter(x => x !== b);
                row(b);
            }
        }
        else if (sql.startsWith('SELECT * FROM research_blobs'))
            row(state.blobs.find(b => b.id === v[0] && !state.images.some(i => i.blob_id === b.id)));
        else if (sql.startsWith('SELECT count(*) FROM research_images'))
            row({ count: state.images.filter(i => i.record_id === v[0]).length });
        else if (sql.startsWith('INSERT INTO research_images')) {
            const image = sql.includes('record_id,blob_id') ? { id: randomUUID(), record_id: v[0], blob_id: v[1], caption: v[2], credit: v[3], license: v[4], is_primary: false } : { id: randomUUID(), record_id: v[0], source_url: v[1], caption: v[2], credit: v[3], license: v[4], is_primary: v[5] };
            image.created_at = new Date().toISOString();
            state.images.push(image);
            row(image);
        }
        else if (sql.startsWith('DELETE FROM research_images')) {
            const image = state.images.find(i => i.record_id === v[0] && i.id === v[1]);
            if (image) {
                state.images = state.images.filter(x => x !== image);
                row(image);
            }
        }
        else if (sql.startsWith('SELECT i.*,b.driver')) {
            rows = state.images.filter(i => sql.includes('i.record_id=$1') ? i.record_id === v[0] && (!v[1] || i.id === v[1]) : i.id === v[0]).map(i => ({ ...i, ...state.blobs.find(b => b.id === i.blob_id), id: i.id }));
            rowCount = rows.length;
        }
        else if (sql.startsWith('INSERT INTO research_history')) {
            state.events.push(v);
            row({});
        }
        else
            throw Error('Unhandled fixture SQL: ' + sql);
        return { rows, rowCount };
    };
    return { query, get state() {
            return state;
        }, async connect() {
            const prev = tail;
            let unlock;
            tail = new Promise(r => unlock = r);
            await prev;
            let snapshot = clone();
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
let server, base, root, store, pool, png;
before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'research-http-'));
    store = new LocalStorage(root, 'test');
    pool = fixture();
    png = await sharp({ create: { width: 9, height: 7, channels: 3, background: 'blue' } }).png().toBuffer();
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        if (!['owner', 'reader'].includes(req.headers['x-user']))
            return res.status(401).json({ error: 'Unauthorized' });
        res.locals.userId = req.headers['x-user'];
        next();
    });
    const router = express.Router();
    registerImages(router, pool, store);
    app.use('/api/research', router);
    app.use((e, req, res, next) => res.status(e.status ?? 400).json({ error: e.message }));
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + server.address().port + '/api/research';
});
after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
});
const request = (url, options = {}, user = 'owner') => fetch(base + url, { ...options, headers: { 'x-user': user, ...options.headers } });
const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
test('persistent quota reservation races admit only the fitting upload and rollback rejected rows', async () => {
    const p = fixture();
    const results = await Promise.allSettled([reserve(p, 'owner', randomUUID(), 'local', 6, 10), reserve(p, 'owner', randomUUID(), 'local', 6, 10)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected')[0].reason.status, 413);
    assert.equal(p.state.used, 6);
    assert.equal(p.state.blobs.length, 1);
});
test('image routes enforce owner before multipart parsing, reject unauthenticated retrieval and unsafe links', async () => {
    assert.equal((await request('/records/' + id + '/images', { method: 'POST', ...json({ sourceUrl: 'https://museum.example/a' }) }, 'reader')).status, 403);
    assert.equal((await request('/records/' + id + '/images', {}, '')).status, 401);
    for (const sourceUrl of ['javascript:x', 'http://127.0.0.1/a', 'https://user:pass@museum.example'])
        assert.equal((await request('/records/' + id + '/images', { method: 'POST', ...json({ sourceUrl }) })).status, 400);
    assert.equal(pool.state.images.length, 0);
});
test('external attachments never fetch source URLs and record clear audit events', async () => {
    const r = await request('/records/' + id + '/images', { method: 'POST', ...json({ sourceUrl: 'https://museum.example/no-fetch', credit: 'Museum' }) });
    assert.equal(r.status, 201);
    const image = await r.json();
    assert.equal(image.storageKind, 'external');
    assert.equal(image.byteSize, 0);
    assert.equal(image.url, 'https://museum.example/no-fetch');
    assert(pool.state.events.some(e => e[2] === 'image_attach'));
    assert.equal((await request('/records/' + id + '/images/' + image.id, { method: 'DELETE' })).status, 204);
});
test('multipart original bytes survive upload/download, thumbnail is separate and deletion releases quota', async () => {
    const form = new FormData();
    form.set('rightsConfirmed', 'true');
    form.set('caption', 'Original');
    form.set('photo', new Blob([png], { type: 'image/png' }), 'not-a-storage-key.png');
    const r = await request('/records/' + id + '/images', { method: 'POST', body: form });
    assert.equal(r.status, 201, await r.clone().text());
    const image = await r.json();
    assert.equal(image.storageKind, 'local');
    assert(!JSON.stringify(image).includes(root));
    assert(image.byteSize > png.length);
    assert.equal(pool.state.used, image.byteSize);
    const retrieved = await request(image.url.replace('/api/research', ''));
    assert.equal(retrieved.status, 200);
    assert.deepEqual(Buffer.from(await retrieved.arrayBuffer()), png);
    assert.equal(retrieved.headers.get('cache-control'), 'private, no-store');
    const thumb = await request(image.thumbnailUrl.replace('/api/research', ''));
    assert.equal((await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).format, 'webp');
    assert.equal((await request('/records/' + id + '/images/' + image.id, { method: 'DELETE' })).status, 204);
    assert.equal(pool.state.used, 0);
    assert.equal(pool.state.blobs.length, 0);
    assert.equal((await fs.readdir(root, { recursive: true })).filter(p => p.endsWith('original') || p.endsWith('thumbnail')).length, 0);
});
test('multipart MIME spoof, missing rights and over-limit files never reserve storage', async () => {
    for (const [bytes, type, rights] of [[Buffer.from('<svg/>'), 'image/png', 'true'], [png, 'image/jpeg', 'true'], [png, 'image/png', 'false'], [Buffer.alloc(4 * 1024 * 1024 + 1), 'image/png', 'true']]) {
        const form = new FormData();
        form.set('photo', new Blob([bytes], { type }), 'file.png');
        form.set('rightsConfirmed', rights);
        const r = await request('/records/' + id + '/images', { method: 'POST', body: form });
        assert([400, 413].includes(r.status), await r.text());
    }
    assert.equal(pool.state.used, 0);
});
test('storage failure after original upload deletes both keys and releases reservation; failed cleanup retains bytes', async () => {
    const p = fixture(), blob = randomUUID();
    await reserve(p, 'owner', blob, 'r2', 100, 1000);
    const deleted = [];
    const adapter = { driver: 'r2', async delete(key) {
            deleted.push(key);
            if (key.endsWith('/thumbnail'))
                throw Error('R2 unavailable');
        } };
    await assert.rejects(() => cleanupBlob(p, adapter, 'owner', blob));
    assert.equal(deleted.length, 2);
    assert.equal(p.state.used, 100);
    assert.equal(p.state.blobs.length, 1);
    adapter.delete = async (key) => deleted.push(key);
    await cleanupBlob(p, adapter, 'owner', blob);
    assert.equal(p.state.used, 0);
    assert.equal(p.state.blobs.length, 0);
});
test('independently referenced blobs survive cleanup without leaking association metadata', async () => {
    const p = fixture(), blob = randomUUID();
    await reserve(p, 'owner', blob, 'r2', 100, 1000);
    p.state.images.push({ blob_id: blob });
    let deleted = 0;
    await cleanupBlob(p, { driver: 'r2', async delete() {
            deleted++;
        } }, 'owner', blob);
    assert.equal(deleted, 0);
    assert.equal(p.state.used, 100);
});
test('restore inscription whitelist drops foreign identifiers and preserves nullable source facts', () => {
    const result = restoreInscriptions([{ id: randomUUID(), record_id: randomUUID(), content: 'D M', language: null, script: null, translation: null, serifs_present: false, stopmarks_present: false, owner_id: 'attacker' }]);
    assert.deepEqual(result, [{ content: 'D M', language: null, script: null, translation: null, serifsPresent: false, stopmarksPresent: false }]);
    assert.throws(() => restoreInscriptions([{ content: '', language: null, script: null, translation: null }]));
});
test('thumbnail upload failure cleans the stored original and its persistent reservation', async () => {
    const originalPut = store.put.bind(store);
    let puts = 0;
    store.put = async (...args) => {
        if (++puts === 2)
            throw Error('Injected thumbnail write failure');
        return originalPut(...args);
    };
    try {
        const form = new FormData();
        form.set('rightsConfirmed', 'true');
        form.set('photo', new Blob([png], { type: 'image/png' }), 'file.png');
        const r = await request('/records/' + id + '/images', { method: 'POST', body: form });
        assert(r.status >= 400);
        assert.equal(puts, 2);
        assert.equal(pool.state.used, 0);
        assert.equal(pool.state.blobs.length, 0);
        assert.equal(pool.state.images.length, 0);
        const files = await fs.readdir(root, { recursive: true });
        assert.equal(files.filter(f => f.endsWith('original') || f.endsWith('thumbnail')).length, 0);
    }
    finally {
        store.put = originalPut;
    }
});

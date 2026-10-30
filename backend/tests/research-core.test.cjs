const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const sharp = require('sharp');
const { parseSearch, csvCell, sourceUrl, uuid } = require('../dist/research/validation');
const { recordValidationError, normalizeDraftFields } = require('../dist/lib/recordValidation');
const { validateImage } = require('../dist/research/imageValidation');
const { LocalStorage, R2Storage, createStorage, storageLimit, objectKey } = require('../dist/research/storage');
const { boundedJson, normalizeMuseum, museumRows } = require('../dist/research/sources');
const { spreadsheetRows } = require('../dist/research/spreadsheet');
const XLSX = require('xlsx');
test('search parser validates signed dates, repeated values, bounded paging and stable sorting', () => {
    const s = parseSearch({ q: '\u03c7\u03b1\u1fd6\u03c1\u03b5 bronze', dateFrom: '-500', dateTo: '100', page: '2', pageSize: '100', mine: '1', language: 'Greek', sort: 'title' }, 'owner');
    assert.equal(s.page, 2);
    assert.equal(s.pageSize, 100);
    assert.match(s.order, /r.id ASC/);
    assert(s.values.includes(-500));
    assert(s.values.includes('owner'));
    for (const q of [{ pageSize: '101' }, { page: '0' }, { q: ['x', 'y'] }, { dateFrom: '2.3' }, { dateFrom: '10', dateTo: '-10' }, { mine: 'true' }, { sort: 'DROP TABLE records' }, { objectTypeId: 'x' }, { reviewStatus: 'verified' }, { ids: Array(101).fill(randomUUID()).join(',') }])
        assert.throws(() => parseSearch(q, 'owner'));
    for (const sort of ['newest', 'oldest', 'title', 'updated'])
        assert.match(parseSearch({ sort }, 'x').order, /r.id/);
});
test('SQL payloads remain values and wildcard characters are literal full-text terms', () => {
    const attack = "' OR 1=1 -- %_";
    const s = parseSearch({ q: attack, museum: attack }, 'x');
    assert(!s.where.includes(attack));
    assert.equal(s.values[0], attack);
    assert.match(s.where, /plainto_tsquery/);
});
test('CSV cells neutralize formulas/control whitespace while JSON keeps original Unicode and line breaks', () => {
    for (const v of ['=HYPERLINK("x")', ' +1', '-4', '@SUM(A1)', '\tvalue', '\r=1', '\n=1'])
        assert(csvCell(v).startsWith('"\''));
    assert.equal(csvCell('\u03c7, "\u03b1"\n\u03b2'), '"\u03c7, ""\u03b1""\n\u03b2"');
    const input = { content: '=D M\n\u03c7\u03b1\u1fd6\u03c1\u03b5' };
    assert.deepEqual(JSON.parse(JSON.stringify(input)), input);
});
test('source URLs allow explicit HTTP(S) links and reject credentials, executable schemes and local literals', () => {
    assert.equal(sourceUrl('https://museum.example/art/1'), 'https://museum.example/art/1');
    for (const u of ['javascript:alert(1)', 'data:text/html,a', 'file:///x', 'https://user:password@museum.example', 'https://localhost/a', 'http://127.0.0.1/a', 'https://[::1]/a', 'https://museum.example:444/a'])
        assert.throws(() => sourceUrl(u));
    assert.throws(() => uuid('../file'));
});
test('draft opt-in retains a required title and converts blank source fields to null, strict manual validation remains', () => {
    assert.match(recordValidationError({ itemName: 'Artifact' }), /Object Type/);
    const draft = normalizeDraftFields({ itemName: 'Artifact', objectTypeId: '', materials: '  ', museumName: null });
    assert.equal(draft.objectTypeId, null);
    assert.equal(draft.materials, null);
    assert.equal(recordValidationError(draft, { draft: true }), null);
    assert.match(recordValidationError({ itemName: '' }, { draft: true }), /Item Name/);
    assert.match(recordValidationError({ itemName: 'A', dateStart: 20, dateEnd: -10 }, { draft: true }), /Date start/);
    assert.match(recordValidationError({ itemName: 'A', dateStart: 1.4 }, { draft: true }), /signed integer/);
});
test('real CSV and XLSX parsing supports aliases/mapping, preserves nulls and never treats descriptions as inscriptions', () => {
    const csv = Buffer.from('Title,Accession Number,Museum,Description,Materials,Year\nCoin,A1,Met,"D M is a translation",, -44\n');
    const p = spreadsheetRows(csv, 'source.csv', { Description: 'museumDescription', Year: 'dateStart' });
    assert.equal(p.rows[0].data.itemName, 'Coin');
    assert.equal(p.rows[0].data.museumNumber, 'A1');
    assert.equal(p.rows[0].data.materials, null);
    assert.equal(p.rows[0].data.dateStart, -44);
    assert.equal(p.rows[0].data.inscribed, null);
    assert.equal(p.rows[0].data.inscriptions, undefined);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Item Name', 'Materials'], ['Vase', null]]), 'Sheet');
    const x = spreadsheetRows(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), 'sample.xlsx');
    assert.equal(x.rows[0].data.materials, null);
    assert.equal(x.rows[0].data.itemName, 'Vase');
});
test('spreadsheet bounds and protected mappings reject unsafe or ambiguous identity fields', () => {
    for (const mapping of [{ Title: 'userId' }, { Title: 'sourceObjectId' }, { Title: 'sourceProvenance' }, { Title: 'revision' }, { Title: 'reviewStatus' }, { Title: 'id' },
        ...['moderationStatus','moderationNotes','moderatedBy','moderatedAt','role'].map(field=>({Title:field}))])
        assert.throws(() => spreadsheetRows(Buffer.from('Title\nA'), 'a.csv', mapping));
    assert.throws(() => spreadsheetRows(Buffer.from('Title,Title\nA,B'), 'a.csv'));
    assert.throws(() => spreadsheetRows(Buffer.from('Title\n' + Array(501).fill('A').join('\n')), 'a.csv'));
    assert.throws(() => spreadsheetRows(Buffer.from('invalid'), 'a.xlsx'));
    assert.throws(() => spreadsheetRows(Buffer.alloc(4 * 1024 * 1024 + 1), 'a.csv'));
});
test('XLSX expansion bombs are rejected before decompression', () => {
    const fake = Buffer.alloc(48);
    fake.write('PK');
    fake.writeUInt32LE(0x02014b50, 2);
    fake.writeUInt32LE(30 * 1024 * 1024, 26);
    assert.throws(() => spreadsheetRows(fake, 'a.xlsx'), /expansion/);
});
test('museum normalization uses factual provenance and signed dates, never descriptions/translations as original text', () => {
    const met = normalizeMuseum('met', '1', { objectID: 1, title: 'Coin', objectDate: '44 BCE', objectBeginDate: -44, objectEndDate: -44, isPublicDomain: false, description: 'A legend', primaryImageSmall: 'https://images.metmuseum.org/a.jpg' });
    assert.equal(met.data.dateStart, -44);
    assert.equal(met.data.materials, null);
    assert.equal(met.data.objectTypeId, null);
    assert.equal(met.data.inscribed, null);
    assert.equal(met.source.isPublicDomain, false);
    assert.equal(met.source.license, 'Reuse not confirmed');
    const cle = normalizeMuseum('cleveland', '2', { data: { id: 2, title: 'Relief', share_license_status: 'CC0', inscriptions: [{ inscription_translation: 'translation only' }, { inscription: 'D M', inscription_translation: 'to the spirits' }] } });
    assert.equal(cle.data.inscriptions.length, 1);
    assert.equal(cle.data.inscriptions[0].content, 'D M');
    assert.equal(cle.data.inscriptions[0].language, null);
    assert.equal(cle.data.inscriptions[0].script, null);
    assert.equal(cle.data.inscriptions[0].serifsPresent, null);
    assert.equal(cle.data.inscriptions[0].stopmarksPresent, null);
    assert.equal(cle.source.license, 'CC0');
    assert.throws(() => normalizeMuseum('met', '1', { objectID: 2, title: 'A' }), /match/);
    assert.throws(() => normalizeMuseum('met', '1', { objectID: 1, title: 'A', primaryImageSmall: 'https://evil.example/image.jpg' }), /untrusted/);
});
test('selected museum IDs use fixed documented object endpoints with concurrency <=2 and per-row failure reporting', async () => {
    let active = 0, max = 0;
    const calls = [];
    const rows = await museumRows('met', ['1', '2', '3', '4'], async (url, options) => {
        calls.push(url);
        assert.equal(options.redirect, 'error');
        assert(options.signal instanceof AbortSignal);
        active++;
        max = Math.max(max, active);
        await new Promise(r => setTimeout(r, 4));
        active--;
        if (url.endsWith('/3'))
            return new Response('failure', { status: 503 });
        const id = Number(url.split('/').pop());
        return Response.json({ objectID: id, title: 'Coin' });
    });
    assert.equal(max, 2);
    assert.equal(rows.length, 4);
    assert(rows[2].errors.length);
    assert.equal(rows[3].rowNumber, 4);
    assert(calls.every(u => u.startsWith('https://collectionapi.metmuseum.org/public/collection/v1/objects/')));
    await assert.rejects(() => museumRows('met', ['../1']));
    await assert.rejects(() => museumRows('cleveland', Array(26).fill('1')));
});
test('upstream readers cancel advertised and actual oversize bodies, redirects, untrusted hosts, and malformed JSON', async () => {
    let cancelled = false;
    const stream = () => new ReadableStream({ start(c) {
            c.enqueue(new Uint8Array(1048577));
        }, cancel() {
            cancelled = true;
        } });
    await assert.rejects(() => boundedJson('https://collectionapi.metmuseum.org/a', async () => new Response(stream())), /too large/);
    assert(cancelled);
    cancelled = false;
    await assert.rejects(() => boundedJson('https://collectionapi.metmuseum.org/a', async () => new Response(stream(), { headers: { 'content-length': '1048577' } })), /too large/);
    assert(cancelled);
    await assert.rejects(() => boundedJson('https://evil.example/a', async () => {
        throw Error('must not call');
    }), /Untrusted/);
    await assert.rejects(() => boundedJson('https://collectionapi.metmuseum.org/a', async () => new Response('', { status: 302 })), /HTTP 302/);
    await assert.rejects(() => boundedJson('https://collectionapi.metmuseum.org/a', async () => new Response('{')));
});
test('image validation decodes PNG/JPEG/WebP and thumbnails while leaving original bytes intact', async () => {
    for (const format of ['png', 'jpeg', 'webp']) {
        const b = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#abcdef' } })[format]().toBuffer();
        const original = Buffer.from(b);
        const r = await validateImage(b, 'image/' + format);
        assert.equal(r.mime, 'image/' + format);
        assert.deepEqual(b, original);
        assert.equal((await sharp(r.thumbnail).metadata()).format, 'webp');
        assert(r.thumbnail.length <= 512 * 1024);
    }
});
test('image validation rejects MIME spoofing, HTML/SVG, truncated decodes, oversized files, animation and excessive pixels', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } }).png().toBuffer();
    await assert.rejects(() => validateImage(png, 'image/jpeg'));
    for (const b of [Buffer.from('<svg></svg>'), Buffer.from('<html>'), png.subarray(0, 30)])
        await assert.rejects(() => validateImage(b, 'image/png'));
    await assert.rejects(() => validateImage(Buffer.alloc(4 * 1024 * 1024 + 1), 'image/png'), /4 MiB/);
    const huge = await sharp({ create: { width: 5000, height: 4001, channels: 3, background: 'white' } }).png().toBuffer();
    await assert.rejects(() => validateImage(huge, 'image/png'), /20 MP/);
    const animation = await sharp(Buffer.from([...Array(12).fill(0), ...Array(12).fill(255)]), { raw: { width: 2, height: 4, channels: 3, pageHeight: 2 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
    await assert.rejects(() => validateImage(animation, 'image/webp'));
});
test('development filesystem adapter roundtrips exact originals, rejects traversal/overwrite and handles aborts/deletes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'research-image-'));
    try {
        const local = new LocalStorage(root, 'test'), key = randomUUID() + '/original', b = Buffer.from('original bytes');
        await local.put(key, b, 'image/png');
        assert.deepEqual(await local.get(key), b);
        await assert.rejects(() => local.put(key, b, 'image/png'));
        for (const bad of ['../x', '/absolute', 'a/../../x', 'x/original', randomUUID() + '/file.html']) {
            assert.throws(() => objectKey(bad));
            await assert.rejects(() => local.get(bad));
        }
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(() => local.put(randomUUID() + '/original', b, 'image/png', controller.signal));
        await local.delete(key);
        await local.delete(key);
        await assert.rejects(() => local.get(key));
    }
    finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('production defaults disabled and cannot enable local storage; quota configuration is strict', () => {
    for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: 'production', IMAGE_STORAGE_DRIVER: 'local' }, {}])
        assert.equal(createStorage(env).driver, 'disabled');
    assert.throws(() => new LocalStorage('unused', 'production'));
    assert.equal(storageLimit({}), 5 * 1024 ** 3);
    assert.equal(storageLimit({ IMAGE_STORAGE_MAX_BYTES: '128' }), 128);
    for (const value of ['-1', '0', 'NaN', '1.5', '9007199254740993'])
        assert.throws(() => storageLimit({ IMAGE_STORAGE_MAX_BYTES: value }));
});
test('R2 SDK contract uses private object keys, correct byte lengths and abort signals, cleans streams and deletes', async () => {
    class Put {
        constructor(input) {
            this.input = input;
        }
    }
    class Get {
        constructor(input) {
            this.input = input;
        }
    }
    class Delete {
        constructor(input) {
            this.input = input;
        }
    }
    const calls = [];
    let destroyed = false;
    const body = { async *[Symbol.asyncIterator]() {
            yield Buffer.from('original');
        }, destroy() {
            destroyed = true;
        } };
    const sdk = { PutObjectCommand: Put, GetObjectCommand: Get, DeleteObjectCommand: Delete, client: { async send(command, options) {
                calls.push({ command, options });
                if (command instanceof Get)
                    return { ContentLength: 8, Body: body };
                return {};
            } } };
    const r2 = new R2Storage('private-bucket', sdk), key = randomUUID() + '/original', controller = new AbortController();
    await r2.put(key, Buffer.from('original'), 'image/png', controller.signal);
    assert.equal(calls[0].command.input.ContentLength, 8);
    assert.equal(calls[0].command.input.ACL, undefined);
    assert.equal(calls[0].options.abortSignal, controller.signal);
    assert.deepEqual(await r2.get(key), Buffer.from('original'));
    assert(destroyed);
    await r2.delete(key, controller.signal);
    assert(calls[2].command instanceof Delete);
    assert.equal(calls[2].command.input.Bucket, 'private-bucket');
    await assert.rejects(() => r2.put('../x', Buffer.alloc(0), 'image/png'));
});
test('R2 stream overflow destroys body; cancelled SDK operations propagate for caller cleanup', async () => {
    class Command {
        constructor(input) {
            this.input = input;
        }
    }
    let destroyed = false;
    const r2 = new R2Storage('bucket', { PutObjectCommand: Command, GetObjectCommand: Command, DeleteObjectCommand: Command, client: { async send(command, options) {
                options?.abortSignal?.throwIfAborted();
                return { Body: { async *[Symbol.asyncIterator]() {
                            yield Buffer.alloc(4 * 1024 * 1024 + 1);
                        }, destroy() {
                            destroyed = true;
                        } } };
            } } });
    const key = randomUUID() + '/original';
    await assert.rejects(() => r2.get(key), /limit/);
    assert(destroyed);
    const c = new AbortController();
    c.abort();
    await assert.rejects(() => r2.put(key, Buffer.from('x'), 'image/png', c.signal));
});

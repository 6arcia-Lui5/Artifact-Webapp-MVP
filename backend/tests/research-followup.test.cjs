const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const XLSX = require('xlsx');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { spreadsheetRows } = require('../dist/research/spreadsheet');
const { imageLocation } = require('../dist/research/imageDto');
const { parseMigrationArgs } = require('../scripts/migrate-research.cjs');
const original = '  \u03c7\u03b1\u1fd6\u03c1\u03b5\n\u0394\u039c  ';
const translation = '  Greetings\nTo the spirits  ';
const headers = ['Title', 'Text', 'Language', 'Writing', 'Translated'];
const mapping = {
    Text: 'inscriptionContent',
    Language: 'inscriptionLanguage',
    Writing: 'inscriptionScript',
    Translated: 'inscriptionTranslation',
};
function csvCell(value) {
    return '"' + String(value ?? '').replace(/"/g, '""') + '"';
}
function workbook(rows) {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Artifacts');
    return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}
test('CSV and XLSX explicit literal mappings preserve Unicode, newlines and nullable artifact fields', () => {
    const rows = [headers, ['Coin', original, 'Greek', 'Greek', translation]];
    const csv = Buffer.from(rows.map(row => row.map(csvCell).join(',')).join('\r\n'));
    for (const [bytes, name] of [[csv, 'literal.csv'], [workbook(rows), 'literal.xlsx']]) {
        const preview = spreadsheetRows(bytes, name, mapping);
        const row = preview.rows[0];
        assert.deepEqual(row.errors, []);
        assert.equal(row.data.inscribed, true);
        assert.equal(row.data.museumName, null);
        assert.equal(row.data.objectTypeId, null);
        assert.equal(row.data.materials, null);
        assert.deepEqual(row.data.inscriptions, [{
                content: original,
                language: 'Greek',
                script: 'Greek',
                translation,
                serifsPresent: false,
                stopmarksPresent: false,
            }]);
        for (const field of Object.values(mapping))
            assert.equal(field in row.data, false);
    }
});
test('literal inscription aliases work without treating descriptions as original text or coercing numeric text', () => {
    const csv = Buffer.from('Title,Original Inscription Text,Inscription Language,Inscription Script,Inscription Translation\nCoin,0001,Latin,Latin,One');
    const row = spreadsheetRows(csv, 'aliases.csv').rows[0];
    assert.deepEqual(row.errors, []);
    assert.equal(row.data.inscriptions[0].content, '0001');
    const description = spreadsheetRows(Buffer.from('Title,Description\nCoin,D M'), 'description.csv', {
        Description: 'museumDescription',
    }).rows[0];
    assert.equal(description.data.inscriptions, undefined);
    assert.equal(description.data.inscribed, null);
});
test('CSV and XLSX partial inscriptions and translation-only rows remain invalid and create no child entries', () => {
    const rows = [headers,
        ['Translation only', null, null, null, 'A translation'],
        ['Missing language', 'D M', null, 'Latin', null],
        ['Missing script', 'D M', 'Latin', null, null],
        ['Missing original', null, 'Latin', 'Latin', 'To the spirits'],
        ['Blank original', '   ', 'Latin', 'Latin', null],
        ['No inscription', null, null, null, null],
    ];
    const csv = Buffer.from(rows.map(row => row.map(csvCell).join(',')).join('\n'));
    for (const [bytes, name] of [[csv, 'partial.csv'], [workbook(rows), 'partial.xlsx']]) {
        const preview = spreadsheetRows(bytes, name, mapping);
        for (const row of preview.rows.slice(0, 5)) {
            assert(row.errors.some(error => /original content, language and script/.test(error)));
            assert.equal(row.data.inscriptions, undefined);
            for (const field of Object.values(mapping))
                assert.equal(field in row.data, false);
        }
        assert.deepEqual(preview.rows[5].errors, []);
        assert.equal(preview.rows[5].data.inscriptions, undefined);
    }
});
test('contradictory inscription flags and overlong literal fields are per-row errors', () => {
    const contradictory = spreadsheetRows(Buffer.from('Title,Inscribed,Text,Language,Writing\nCoin,no,D M,Latin,Latin'), 'conflict.csv', { ...mapping, Inscribed: 'inscribed' }).rows[0];
    assert(contradictory.errors.some(error => /conflicts/.test(error)));
    assert.equal(contradictory.data.inscriptions, undefined);
    const oversized = spreadsheetRows(Buffer.from('Title,Text,Language,Writing\nCoin,' + 'A'.repeat(10001) + ',Latin,Latin'), 'long.csv', mapping).rows[0];
    assert(oversized.errors.some(error => /10000/.test(error)));
    assert.equal(oversized.data.inscriptions, undefined);
});
test('compact image locations use authenticated application paths or direct external links without keys', () => {
    const recordId = randomUUID();
    const imageId = randomUUID();
    const appUrl = `/api/research/records/${recordId}/images/${imageId}/file`;
    for (const driver of ['local', 'r2']) {
        const image = imageLocation({
            id: imageId, record_id: recordId, blob_id: randomUUID(), driver, caption: 'Obverse',
            original_key: 'never-return-this', thumbnail_key: 'never-return-that',
        });
        assert.deepEqual(image, { id: imageId, url: appUrl, thumbnailUrl: appUrl + '?thumbnail=1', storageKind: driver, caption: 'Obverse' });
    }
    const url = 'https://museum.example/coin.jpg';
    assert.deepEqual(imageLocation({ id: imageId, record_id: recordId, source_url: url, caption: null }), {
        id: imageId, url, thumbnailUrl: url, storageKind: 'external', caption: null,
    });
});
test('migration runner requires a named schema, deliberate public flag and permits only known flags', () => {
    assert.throws(() => parseMigrationArgs([]));
    assert.throws(() => parseMigrationArgs(['public']), /--allow-public/);
    assert.throws(() => parseMigrationArgs(['--allow-public']));
    assert.equal(parseMigrationArgs(['public', '--allow-public']).schema, 'public');
    assert.equal(parseMigrationArgs(['research_test_12345678', '--preview']).preview, true);
    for (const args of [['pg_catalog', '--allow-public'], ['pg_temp_1'], ['information_schema'],
        ['schema;DROP TABLE records'], ['one', 'two'], ['one', '--unknown'], ['one', '--preview', '--preview']]) {
        assert.throws(() => parseMigrationArgs(args));
    }
});
test('migration preview prints a transaction for the explicit schema without a connection or credentials', () => {
    const runner = path.join(__dirname, '../scripts/migrate-research.cjs');
    for (const args of [['research_test_12345678', '--preview'], ['public', '--allow-public', '--preview']]) {
        const result = spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8', env: {} });
        assert.equal(result.status, 0, result.stderr);
        assert(result.stdout.startsWith('BEGIN;\nSET LOCAL search_path TO "' + args[0] + '", pg_catalog;'));
        assert.match(result.stdout, /CREATE OR REPLACE FUNCTION research_revision/);
        assert(result.stdout.endsWith('COMMIT;\n'));
    }
});
test('missing research tables or columns return informative HTTP503 without database details', async () => {
    const filename = require.resolve('@clerk/express');
    const previous = require.cache[filename];
    require.cache[filename] = { id: filename, filename, loaded: true, exports: { getAuth: () => ({ userId: 'owner' }) } };
    const { createResearchRouter } = require('../dist/research/router');
    if (previous)
        require.cache[filename] = previous;
    else
        delete require.cache[filename];
    let code = '42P01';
    const pool = {
        async query() {
            throw Object.assign(Error('secret database host/path and relation details'), { code });
        },
    };
    const app = express();
    app.use('/api/research', createResearchRouter(pool));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        for (const errorCode of ['42P01', '42703']) {
            code = errorCode;
            const response = await fetch(`http://127.0.0.1:${server.address().port}/api/research/collections`);
            assert.equal(response.status, 503);
            const body = await response.json();
            assert.match(body.error, /migration is not applied/);
            assert.doesNotMatch(JSON.stringify(body), /secret|host|path|relation details/);
        }
    }
    finally {
        await new Promise(resolve => server.close(resolve));
    }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationImageUrl, createRestoreSelection, formatBytes, imagePreviewUrl, importProgressIssue, MAX_IMPORT_BYTES, parseObjectIds, safeHttpUrl, selectableRows, validateImageFile, validateImportFile } from '../lib/ingestApi.js';

test('CSV/XLSX input rejects unsupported, empty, and oversized files before upload', () => {
  assert.equal(validateImportFile({ name: 'catalog.CSV', size: MAX_IMPORT_BYTES }), '');
  assert.equal(validateImportFile({ name: 'catalog.xlsx', size: 8 }), '');
  assert.match(validateImportFile({ name: 'catalog.xls', size: 8 }), /CSV or XLSX/);
  assert.match(validateImportFile({ name: 'catalog.csv', size: MAX_IMPORT_BYTES + 1 }), /4 MiB/);
  assert.match(validateImportFile({ name: 'catalog.csv', size: 0 }), /empty/);
  assert.match(validateImportFile(null), /Choose/);
});
test('source object IDs preserve order, deduplicate, and reject invalid or unbounded requests', () => {
  assert.deepEqual(parseObjectIds('123, 456\n123;789'), ['123', '456', '789']);
  for (const text of ['', '0', '-2', '1.5', 'cat', '9e2', '10000000000', '9007199254740992', Array.from({ length: 26 }, (_, i) => i + 1).join(',')]) assert.throws(() => parseObjectIds(text));
});
test('default selection excludes duplicates and invalid rows without modifying preview data', () => {
  const rows = [{ rowNumber: 1, data: { itemName: 'New' } }, { rowNumber: 2, errors: ['Missing title'] }, { rowNumber: 3, duplicateRecordId: 'existing' }, { rowNumber: 4, duplicate: true }, { rowNumber: 5, warnings: ['Unknown date'] }, { rowNumber: 6, state: 'imported' }, { rowNumber: 7, state: 'skipped' }, { rowNumber: 8, state: 'processing' }];
  const before = JSON.stringify(rows);
  assert.deepEqual(selectableRows(rows), [1, 5]);
  assert.equal(JSON.stringify(rows), before);
});
test('commit loop stops on unchanged, missing, or errored progress while allowing forward progress', () => {
  const previous = { imported: 25, skipped: 0, errors: 0, remaining: 30 };
  assert.match(importProgressIssue({ importedCount: 25, skippedCount: 0, errorCount: 0, remaining: 30 }, previous), /no further progress/);
  assert.match(importProgressIssue({ importedCount: 26, errorCount: 1, remaining: 29 }, previous), /reported errors/);
  assert.match(importProgressIssue({ importedCount: 26 }, previous), /remaining-row/);
  assert.equal(importProgressIssue({ importedCount: 50, skippedCount: 0, errorCount: 0, remaining: 5 }, previous), '');
  assert.equal(importProgressIssue({ importedCount: 55, skippedCount: 0, errorCount: 0, remaining: 0 }, previous), '');
});
test('image input and source links reject unsafe types and URLs', () => {
  assert.equal(validateImageFile({ type: 'image/png', size: MAX_IMPORT_BYTES }), '');
  assert.match(validateImageFile({ type: 'image/gif', size: 8 }), /PNG, JPEG, or WebP/);
  assert.match(validateImageFile({ type: 'image/jpeg', size: MAX_IMPORT_BYTES + 1 }), /4 MiB/);
  assert.equal(safeHttpUrl('https://museum.example/image.jpg'), 'https://museum.example/image.jpg');
  for (const value of ['javascript:alert(1)', 'data:image/png;base64,x', '//example.com', '/private', undefined]) assert.equal(safeHttpUrl(value), null);
});
test('quota formatting keeps zero separate from unknown storage', () => {
  assert.equal(formatBytes(0), '0 bytes');
  assert.equal(formatBytes(1024), '1.0 KiB');
  assert.equal(formatBytes(MAX_IMPORT_BYTES), '4.0 MiB');
  assert.equal(formatBytes(null), 'Unknown');
});
test('source URLs containing userinfo are rejected before browser display', () => {
  for (const url of ['https://researcher:secret@museum.example/photo.jpg', 'https://researcher@museum.example/photo.jpg', 'https://:secret@museum.example/photo.jpg', 'https://%72esearcher:%73ecret@museum.example/photo.jpg']) assert.equal(safeHttpUrl(url), null);
  assert.equal(safeHttpUrl('https://museum.example/photo.jpg?view=original'), 'https://museum.example/photo.jpg?view=original');
});
test('gallery previews prefer thumbnails and application paths resolve to the configured API origin', () => {
  assert.equal(imagePreviewUrl({ thumbnailUrl: '/api/thumb', url: '/api/original' }), '/api/thumb');
  assert.equal(imagePreviewUrl({ url: '/api/original' }), '/api/original');
  const api = 'http://localhost:3000/api';
  const origin = 'http://localhost:5173';
  assert.equal(applicationImageUrl('/api/research/records/1/images/2/file?thumbnail=1', api, origin), 'http://localhost:3000/api/research/records/1/images/2/file?thumbnail=1');
  assert.equal(applicationImageUrl('http://localhost:3000/api/research/image', api, origin), 'http://localhost:3000/api/research/image');
  for (const value of ['https://museum.example/image.jpg', 'https://signed.example/api/image?signature=abc', 'http://user:secret@localhost:3000/api/image', 'http://localhost:3000/api-unrelated/image', '//unknown.example/api/image']) assert.equal(applicationImageUrl(value, api, origin), null);
});
test('restore confirmation captures the reviewed revision and keeps it fixed across concurrent record updates', () => {
  const record = { revision: 7 };
  const selection = createRestoreSelection('snapshot-id', record);
  record.revision = 8;
  assert.deepEqual(selection, { revisionId: 'snapshot-id', expectedRevision: 7 });
  for (const revision of [undefined, null, 0, -1, 1.5, '7']) assert.equal(createRestoreSelection('snapshot-id', { revision }), null);
});

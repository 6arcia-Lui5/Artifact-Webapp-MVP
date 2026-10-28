import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, FULL_CROP, validateFile, validatePhoto, downloadPhoto, validateDimensions, cropPixels, boundedSize, renderPhoto, visionPhotoBlob } from '../src/components/photoTranscription/image.js';

test('only supported, nonempty photos within the byte limit are accepted', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) validateFile({ type, size: 8 * 1024 * 1024 });
  for (const file of [null, { type: 'image/svg+xml', size: 20 }, { type: 'image/png', size: 0 }, { type: 'image/png', size: 8 * 1024 * 1024 + 1 }]) {
    assert.throws(() => validateFile(file));
  }
});

test('a renamed or malformed file cannot pass the header check', async () => {
  const file = (bytes, type) => new File([new Uint8Array(bytes)], 'photo', { type });
  await validatePhoto(file([137, 80, 78, 71, 13, 10, 26, 10], 'image/png'));
  await validatePhoto(file([255, 216, 255, 224], 'image/jpeg'));
  await validatePhoto(new File(['RIFF1234WEBP'], 'photo.webp', { type: 'image/webp' }));
  await assert.rejects(validatePhoto(new File(['<svg />'], 'fake.png', { type: 'image/png' })));
  await assert.rejects(validatePhoto(file([255, 216, 255, 224], 'image/png')));
});

test('decoded dimensions reject excess pixels and invalid sizes', () => {
  validateDimensions(5000, 4000);
  for (const [width, height] of [[5001, 4000], [0, 100], [Infinity, 2], [1.5, 3]]) assert.throws(() => validateDimensions(width, height));
});

test('crop converts percentage bounds to pixels, covering edge pixels', () => {
  assert.deepEqual(cropPixels(FULL_CROP, 403, 301), { left: 0, top: 0, width: 403, height: 301 });
  assert.deepEqual(cropPixels({ x: 50, y: 25, width: 50, height: 75 }, 400, 200), { left: 200, top: 50, width: 200, height: 150 });
  const tiny = cropPixels({ x: 99, y: 99, width: 1, height: 1 }, 10, 10);
  assert.deepEqual(tiny, { left: 9, top: 9, width: 1, height: 1 });
});

test('invalid and empty crops cannot be processed', () => {
  for (const crop of [{ x: -1 }, { y: NaN }, { width: 0 }, { height: Infinity }, { x: 50, width: 51 }, { y: 100, height: 1 }]) {
    assert.throws(() => cropPixels({ ...FULL_CROP, ...crop }, 1000, 1000));
  }
});

test('canvas allocation stays within both side and area budgets', () => {
  for (const [width, height] of [[5000, 4000], [20_000_000, 1], [1, 20_000_000], [400, 300], [1, 1]]) {
    const result = boundedSize(width, height);
    assert.ok(result.width <= 2400 && result.height <= 2400);
    assert.ok(result.width >= 1 && result.height >= 1);
    assert.ok(result.width * result.height <= 4_000_000);
  }
  assert.deepEqual(boundedSize(400, 300), { width: 400, height: 300 });
});

test('rotation swaps the canvas dimensions and crop uses rotated coordinates', () => {
  const originalDocument = globalThis.document;
  const context = { fillRect() {}, scale() {}, translate() {}, rotate() {}, drawImage() {} };
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  try {
    const image = { naturalWidth: 800, naturalHeight: 400 };
    const rotated = renderPhoto(image, 90);
    assert.equal(rotated.width, 400);
    assert.equal(rotated.height, 800);
    const cropped = renderPhoto(image, 270, { x: 0, y: 50, width: 100, height: 50 });
    assert.equal(cropped.width, 400);
    assert.equal(cropped.height, 400);
  } finally { globalThis.document = originalDocument; }
});

test('recognition modes explicitly map to inscription language and script', () => {
  assert.deepEqual(MODES.grc, { language: 'Ancient Greek', script: 'Greek' });
  assert.deepEqual(MODES.heb, { language: 'Hebrew', script: 'Hebrew' });
  assert.equal(MODES.lat.script, 'Latin');
  assert.equal(MODES.eng.language, 'English');
});

test('vision photos are JPEG and stay below the hosted request limit with room for multipart headers', async () => {
  const qualities = [];
  const canvas = { toBlob(callback, type, quality) {
    assert.equal(type, 'image/jpeg'); qualities.push(quality);
    callback(new Blob([new Uint8Array(quality > 0.8 ? 4_000_000 : 3_000_000)], { type }));
  } };
  const photo = await visionPhotoBlob(canvas);
  assert.equal(photo.type, 'image/jpeg');
  assert(photo.size < 4_000_000);
  assert.deepEqual(qualities, [0.92, 0.8]);
});
test('a vision crop that cannot meet the size cap is rejected rather than sent to fail at the host', async () => {
  const canvas = { toBlob: (callback, type) => callback(new Blob([new Uint8Array(4_000_000)], { type })) };
  await assert.rejects(visionPhotoBlob(canvas), /smaller inscription area/);
});

test('catalog photos are fetched without credentials or a referrer and validated before use', async t => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, options };
    return new Response(bytes, { headers: { 'Content-Type': 'image/png; charset=binary' } });
  });
  const photo = await downloadPhoto('https://museum.example/photo.png');
  assert.equal(photo.type, 'image/png');
  assert.equal(photo.size, bytes.length);
  assert.equal(request.url, 'https://museum.example/photo.png');
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.referrerPolicy, 'no-referrer');
  assert.equal(request.options.mode, 'cors');
  assert(request.options.signal instanceof AbortSignal);
});

test('catalog links reject unsupported schemes, pages, bad status and mislabeled image bytes', async t => {
  let calls = 0;
  let response;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response; });
  await assert.rejects(downloadPhoto('data:image/png;base64,AA=='), /http or https/);
  assert.equal(calls, 0);
  response = new Response('<html>Collection page</html>', { headers: { 'Content-Type': 'text/html' } });
  await assert.rejects(downloadPhoto('https://museum.example/object'), /supported photo/);
  response = new Response('missing', { status: 404, headers: { 'Content-Type': 'image/png' } });
  await assert.rejects(downloadPhoto('https://museum.example/missing.png'), /supported photo/);
  response = new Response('not a PNG', { headers: { 'Content-Type': 'image/png' } });
  await assert.rejects(downloadPhoto('https://museum.example/fake.png'), /does not match/);
});

test('catalog download rejects an oversized advertised length without reading the stream', async t => {
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  t.mock.method(globalThis, 'fetch', async () => new Response(stream, {
    headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(8 * 1024 * 1024 + 1) },
  }));
  await assert.rejects(downloadPhoto('https://museum.example/large.jpg'), /8 MB/);
  assert.equal(cancelled, true);
});

test('catalog download enforces the actual byte budget even when the host reports a smaller size', async t => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(8 * 1024 * 1024));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() { cancelled = true; },
  });
  t.mock.method(globalThis, 'fetch', async () => new Response(stream, {
    headers: { 'Content-Type': 'image/png', 'Content-Length': '100' },
  }));
  await assert.rejects(downloadPhoto('https://museum.example/large.png'), /8 MB/);
  assert.equal(cancelled, true);
});

test('catalog download respects cancellation and the request timeout signal', async t => {
  const caller = new AbortController();
  const timeout = new AbortController();
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    assert.equal(milliseconds, 20000);
    return timeout.signal;
  });
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const cancelled = downloadPhoto('https://museum.example/photo.jpg', caller.signal);
  caller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  const timedOut = downloadPhoto('https://museum.example/photo.jpg');
  timeout.abort(new DOMException('Photo download timed out.', 'TimeoutError'));
  await assert.rejects(timedOut, { name: 'TimeoutError' });
});

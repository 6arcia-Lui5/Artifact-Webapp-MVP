const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const express = require('express');
const sharp = require('sharp');

// Keep the real access middleware and image decoder; replace only account
// lookup and upstream network calls. No credentials or real museum requests.
for (const [name, exports] of [
  ['@clerk/express', { getAuth: req => ({ userId: req.headers['x-test-user'] }) }],
  ['../dist/config/env.js', { ENV: { NODE_ENV: 'test', ALLOWED_CLERK_USER_IDS: 'approved' } }],
]) {
  const filename = require.resolve(name);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const { requireSiteAccess } = require('../dist/middleware/requireSiteAccess.js');

// A controlled encoder-output override exercises the final HTTP size boundary
// without relying on a particular JPEG encoder's compressibility.
let oversizedPrepared = false;
const sharpModule = require.cache[require.resolve('sharp')];
const sharpExport = sharpModule.exports;
sharpModule.exports = (...args) => {
  const image = sharp(...args);
  const toBuffer = image.toBuffer.bind(image);
  image.toBuffer = (...options) => oversizedPrepared
    ? Promise.resolve(Buffer.alloc(Math.floor(3.5 * 1024 * 1024) + 1))
    : toBuffer(...options);
  return image;
};
const router = require('../dist/routes/museumPhotoRoutes.js').default;
sharpModule.exports = sharpExport;

const realFetch = globalThis.fetch;
const apiPrefix = 'https://collectionapi.metmuseum.org/public/collection/v1/objects/';
const goodSource = 'https://images.metmuseum.org/CRDImages/gr/web-large/test.jpg';
let server, base, png, photo, source = goodSource, metadataMode = 'ok', imageMode = 'ok';
let calls = [], cancelledBody = false, upstreamAborted = false;

function cappedStream(size) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(size));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() { cancelledBody = true; },
  });
}
function advertisedTooLarge(limit, type) {
  return new Response(new ReadableStream({ cancel() { cancelledBody = true; } }), {
    headers: { 'content-type': type, 'content-length': String(limit + 1) },
  });
}
async function museumFetch(input, options) {
  const url = String(input);
  calls.push({ url, options });
  assert.equal(options.redirect, 'error');
  assert(options.signal instanceof AbortSignal);
  assert.equal(options.headers, undefined, 'Catalog authentication must not be forwarded upstream');
  if (url.startsWith(apiPrefix)) {
    assert.match(url.slice(apiPrefix.length), /^\d{1,9}$/);
    if (metadataMode === 'status') return new Response('private upstream message', { status: 503 });
    if (metadataMode === 'redirect') return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
    if (metadataMode === 'length') return advertisedTooLarge(256 * 1024, 'application/json');
    if (metadataMode === 'stream') return new Response(cappedStream(256 * 1024));
    if (metadataMode === 'invalid') return new Response('{');
    if (metadataMode === 'original') return Response.json({ primaryImage: source, primaryImageSmall: goodSource + '-thumbnail' });
    return Response.json({ primaryImageSmall: source });
  }
  assert.equal(url, source, 'Any unexpected destination must remain inside this network stub');
  if (imageMode === 'status') return new Response('private upstream message', { status: 503 });
  if (imageMode === 'redirect') return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  if (imageMode === 'length') return advertisedTooLarge(12 * 1024 * 1024, 'image/jpeg');
  if (imageMode === 'stream') return new Response(cappedStream(12 * 1024 * 1024));
  if (imageMode === 'wait') return new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      upstreamAborted = true;
      reject(options.signal.reason);
    }, { once: true });
  });
  return new Response(photo, { headers: { 'content-type': 'image/png' } });
}

before(async () => {
  png = await sharp({ create: { width: 40, height: 20, channels: 3, background: 'white' } }).png().toBuffer();
  photo = png;
  const app = express();
  app.use(requireSiteAccess);
  app.use('/api/transcription', router);
  server = http.createServer(app);
  base = await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
  globalThis.fetch = museumFetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
function reset() {
  metadataMode = imageMode = 'ok';
  photo = png; source = goodSource; calls = [];
  cancelledBody = upstreamAborted = oversizedPrepared = false;
}
function get(objectId = '256771', options = {}) {
  return realFetch(`${base}/api/transcription/museum-image/${objectId}`, {
    headers: { ...(options.user === null ? {} : { 'x-test-user': options.user || 'approved' }) },
    signal: options.signal,
  });
}
async function failure(response, status) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type'), /application\/json/);
  const data = await response.json();
  assert.equal(typeof data.error, 'string');
  assert.doesNotMatch(data.error, /private upstream|127\.0\.0\.1|stack/i);
}

test('museum photo gateway remains behind approved-account access', async () => {
  reset();
  const entry = fs.readFileSync(require.resolve('../src/index.ts'), 'utf8');
  assert(entry.indexOf('app.use(requireSiteAccess)') < entry.indexOf('app.use("/api/transcription", museumPhotoRoutes)'));
  await failure(await get('256771', { user: null }), 401);
  await failure(await get('256771', { user: 'unapproved' }), 403);
  assert.equal(calls.length, 0);
});

test('only numeric object IDs reach the fixed museum API', async () => {
  reset();
  for (const id of ['abc', '-1', '1.5', '1234567890', encodeURIComponent('https://example.com/image.jpg')]) {
    await failure(await get(id), 400);
  }
  assert.equal(calls.length, 0);
  const response = await get('256771?url=http%3A%2F%2F127.0.0.1%2Fprivate');
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  assert.equal(calls[0].url, apiPrefix + '256771', 'Query parameters cannot choose the upstream destination');
});

test('success returns a private bounded JPEG and strips orientation metadata', async () => {
  reset();
  metadataMode = 'original';
  photo = await sharp({ create: { width: 3000, height: 2500, channels: 3, background: 'white' } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const response = await get();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /image\/jpeg/);
  assert.equal(response.headers.get('cache-control'), 'private, max-age=300');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(bytes.length <= 3.5 * 1024 * 1024);
  const meta = await sharp(bytes).metadata();
  assert.equal(meta.format, 'jpeg');
  assert(meta.width <= 2400 && meta.height <= 2400 && meta.width * meta.height <= 4_000_000);
  assert(meta.height > meta.width);
  assert.equal(meta.orientation, undefined);
  assert.equal(calls.length, 2);
});

test('museum metadata cannot redirect image fetches outside the allowed HTTPS image host and path', async () => {
  for (const invalid of [
    'http://images.metmuseum.org/CRDImages/a.jpg',
    'https://example.com/CRDImages/a.jpg',
    'https://images.metmuseum.org.example.com/CRDImages/a.jpg',
    'https://images.metmuseum.org:444/CRDImages/a.jpg',
    'https://user:password@images.metmuseum.org/CRDImages/a.jpg',
    'https://images.metmuseum.org/other/a.jpg',
    'https://images.metmuseum.org/CRDImagesExtra/a.jpg',
    'https://images.metmuseum.org/CRDImages/a.jpg?redirect=private',
    'https://images.metmuseum.org/CRDImages/a.jpg#fragment',
    'file:///CRDImages/a.jpg',
    '',
  ]) {
    reset(); source = invalid;
    await failure(await get(), 502);
    assert.equal(calls.length, 1, invalid);
  }
});

test('redirects and upstream failures produce fallback errors without following a new destination', async () => {
  for (const stage of ['metadata', 'image']) {
    for (const mode of ['redirect', 'status']) {
      reset();
      if (stage === 'metadata') metadataMode = mode;
      else imageMode = mode;
      await failure(await get(), 502);
      assert.equal(calls.length, stage === 'metadata' ? 1 : 2);
    }
  }
});

test('metadata and photo byte limits reject advertised oversize bodies and cancel them', async () => {
  for (const stage of ['metadata', 'image']) {
    reset();
    if (stage === 'metadata') metadataMode = 'length';
    else imageMode = 'length';
    await failure(await get(), 502);
    assert.equal(cancelledBody, true, `${stage} body must be cancelled after preflight rejection`);
  }
});

test('actual streamed byte limits apply when Content-Length is absent', async () => {
  for (const stage of ['metadata', 'image']) {
    reset();
    if (stage === 'metadata') metadataMode = 'stream';
    else imageMode = 'stream';
    await failure(await get(), 502);
    assert.equal(cancelledBody, true);
  }
});

test('invalid metadata, unsupported or broken images and excess decoded pixels are rejected', async () => {
  reset(); metadataMode = 'invalid';
  await failure(await get(), 502);
  assert.equal(calls.length, 1);
  const huge = await sharp({ create: { width: 5000, height: 4001, channels: 3, background: 'white' } }).png().toBuffer();
  for (const invalid of [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),
    Buffer.from('not an image'), png.subarray(0, png.length - 30), huge,
  ]) {
    reset(); photo = invalid;
    await failure(await get(), 502);
  }
});

test('prepared output over the hosted byte budget is rejected instead of sent', async () => {
  reset(); oversizedPrepared = true;
  await failure(await get(), 502);
});

test('client cancellation aborts the in-flight museum request', async () => {
  reset(); imageMode = 'wait';
  const controller = new AbortController();
  const pending = get('256771', { signal: controller.signal });
  const deadline = Date.now() + 2000;
  while (calls.length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(calls.length, 2);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  while (!upstreamAborted && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(upstreamAborted, true);
});

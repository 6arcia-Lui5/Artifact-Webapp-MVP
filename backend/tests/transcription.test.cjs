const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const express = require('express');
const sharp = require('sharp');

// Exercise the real global access middleware without Clerk network calls or account files.
for (const [name, exports] of [
  ['@clerk/express', { getAuth: req => ({ userId: req.headers['x-test-user'] }) }],
  ['../dist/config/env.js', { ENV: { NODE_ENV: 'test', ALLOWED_CLERK_USER_IDS: 'approved,second' } }],
]) {
  const filename = require.resolve(name);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const { requireSiteAccess } = require('../dist/middleware/requireSiteAccess.js');
const { createTranscriptionRouter } = require('../dist/routes/transcriptionRoutes.js');
let upstream, server, base, upstreamUrl, png, lastRequest, calls = 0;
let mode = 'ok';
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
before(async () => {
  png = await sharp({ create: { width: 40, height: 20, channels: 3, background: 'white' } }).png().toBuffer();
  upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    calls++; lastRequest = { path: req.url, body: JSON.parse(Buffer.concat(chunks)) };
    if (mode === 'wait') return;
    if (mode === 'disconnect') { req.socket.destroy(); return; }
    if (mode === 'unavailable') { res.writeHead(503).end('private upstream details'); return; }
    const content = mode === 'blank' ? { text: '', notes: [] } : { text: '  ΧΑΙΡΕ\nD·M [illegible]\nשלום  ', notes: ['Literal draft.'] };
    const envelope = { done: true, done_reason: mode === 'truncated' ? 'length' : 'stop', message: { content: JSON.stringify(content) } };
    if (mode === 'bad-shape') envelope.message.content = JSON.stringify({ text: 'x', notes: [], extra: true });
    if (mode === 'oversized') envelope.message.content = JSON.stringify({ text: 'x'.repeat(10001), notes: [] });
    if (mode === 'long-note') envelope.message.content = JSON.stringify({ text: 'x', notes: ['x'.repeat(301)] });
    if (mode === 'many-notes') envelope.message.content = JSON.stringify({ text: 'x', notes: Array(9).fill('note') });
    if (mode === 'large-envelope') { res.end(' '.repeat(256 * 1024 + 1)); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(mode === 'malformed' ? '{' : JSON.stringify(envelope));
  });
  upstreamUrl = await listen(upstream);
  process.env.LOCAL_VISION_URL = upstreamUrl;
  const app = express();
  app.use(requireSiteAccess);
  app.use('/api/transcription', createTranscriptionRouter(400));
  server = http.createServer(app);
  base = await listen(server);
});
after(async () => {
  delete process.env.LOCAL_VISION_URL;
  for (const instance of [server, upstream]) {
    instance.closeAllConnections();
    await new Promise(resolve => instance.close(resolve));
  }
});
function post({ bytes = png, type = 'image/png', language = 'grc', user = 'approved', signal } = {}) {
  const form = new FormData();
  if (bytes) form.append('photo', new Blob([bytes], { type }), 'photo');
  form.append('language', language);
  return fetch(`${base}/api/transcription`, { method: 'POST', headers: { 'x-test-user': user }, body: form, signal });
}
async function error(response, status) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type'), /json/);
  const body = await response.json();
  assert.equal(typeof body.error, 'string');
  assert.doesNotMatch(body.error, /127\.0\.0\.1|private upstream|stack/i);
}

test('global access protects both routes; configured does not claim verified availability', async () => {
  const source = fs.readFileSync(require.resolve('../src/index.ts'), 'utf8');
  assert.ok(source.indexOf('app.use(requireSiteAccess)') < source.indexOf('app.use("/api/transcription"'));
  for (const path of ['/api/transcription/status', '/api/transcription']) {
    await error(await fetch(base + path, { method: path.endsWith('status') ? 'GET' : 'POST' }), 401);
    await error(await fetch(base + path, { headers: { 'x-test-user': 'unapproved' } }), 403);
  }
  const status = await fetch(base + '/api/transcription/status', { headers: { 'x-test-user': 'approved' } });
  assert.deepEqual(await status.json(), { configured: true, provider: 'local-vision', model: 'qwen3-vl:2b-instruct', pipelineConfigured: false, pipelineModel: null });
  delete process.env.LOCAL_VISION_URL;
  await error(await post(), 503);
  process.env.LOCAL_VISION_URL = upstreamUrl;
});

test('valid photo preserves original script and lines and sends the fixed Ollama contract', async () => {
  mode = 'ok';
  const response = await post();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { text: '  ΧΑΙΡΕ\nD·M [illegible]\nשלום  ', notes: ['Literal draft.'], model: 'qwen3-vl:2b-instruct', provider: 'local-vision' });
  assert.equal(lastRequest.path, '/api/chat');
  const body = lastRequest.body;
  assert.equal(body.stream, false); assert.equal(body.think, false); assert.equal(body.keep_alive, '5m');
  assert.deepEqual(body.options, { temperature: 0, num_ctx: 8192, num_predict: 2048 });
  assert.equal(body.format.additionalProperties, false);
  assert.equal(body.messages.length, 1);
  assert.match(body.messages[0].content, /Ancient Greek \(grc\)/);
  const image = await sharp(Buffer.from(body.messages[0].images[0], 'base64')).metadata();
  assert.equal(image.format, 'jpeg');
  // This draft route has no database/artifact dependencies or writes.
  assert.doesNotMatch(fs.readFileSync(require.resolve('../src/routes/transcriptionRoutes.ts'), 'utf8'), /from ["'].*(?:db|queries)|writeFile/);
});

test('reject invalid language, missing, spoofed, malformed, unsupported and oversized photos before upstream', async () => {
  const before = calls;
  await error(await post({ language: 'Greek' }), 400);
  await error(await post({ bytes: null }), 400);
  await error(await post({ type: 'image/jpeg' }), 400);
  for (const bytes of [Buffer.from('not an image'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'), Buffer.from('%PDF-1.4')]) {
    await error(await post({ bytes }), 400);
  }
  await error(await post({ bytes: png.subarray(0, png.length - 30) }), 400);
  await error(await post({ bytes: Buffer.alloc(4 * 1024 * 1024 + 1) }), 413);
  const huge = await sharp({ create: { width: 5000, height: 4001, channels: 3, background: 'white' } }).png().toBuffer();
  await error(await post({ bytes: huge }), 400);
  assert.equal(calls, before);
});

test('normalization bounds area and axes, rotates orientation and supports JPEG/WebP', async () => {
  mode = 'ok';
  for (const format of ['jpeg', 'webp']) {
    const bytes = await sharp({ create: { width: 3000, height: 2500, channels: 3, background: 'white' } })
      .withMetadata({ orientation: 6 })[format]().toBuffer();
    assert.equal((await post({ bytes, type: `image/${format}`, language: 'lat' })).status, 200);
    const meta = await sharp(Buffer.from(lastRequest.body.messages[0].images[0], 'base64')).metadata();
    assert.ok(meta.width <= 2400 && meta.height <= 2400 && meta.width * meta.height <= 4_000_000);
    assert.ok(meta.height > meta.width);
    assert.equal(meta.orientation, undefined);
  }
});

test('blank output has an informative note; upstream errors and malformed/truncated results are JSON errors', async () => {
  mode = 'blank';
  const body = await (await post()).json();
  assert.equal(body.text, ''); assert.match(body.notes[0], /No readable inscription/);
  for (mode of ['unavailable', 'disconnect', 'malformed', 'truncated', 'bad-shape', 'oversized', 'long-note', 'many-notes', 'large-envelope']) await error(await post(), 502);
  mode = 'wait';
  await error(await post(), 504);
  mode = 'ok';
  assert.equal((await post()).status, 200);
});

test('concurrent users get retry guidance; cancellation releases the slot', async () => {
  mode = 'wait';
  const controller = new AbortController();
  const pending = post({ signal: controller.signal });
  const target = calls + 1;
  while (calls < target) await new Promise(resolve => setTimeout(resolve, 5));
  for (const user of ['approved', 'second']) {
    const response = await post({ user });
    assert.equal(response.headers.get('retry-after'), '5');
    await error(response, 429);
  }
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  mode = 'ok';
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await post()).status, 200);
});

test('a stalled multipart upload times out and releases the slot', async () => {
  mode = 'ok';
  const request = http.request(base + '/api/transcription', {
    method: 'POST', headers: { 'x-test-user': 'approved', 'Content-Type': 'multipart/form-data; boundary=stalled' },
  });
  const closed = new Promise(resolve => request.once('error', resolve));
  request.write('--stalled\r\nContent-Disposition: form-data; name="photo"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n');
  await closed;
  request.destroy();
  assert.equal((await post()).status, 200);
});

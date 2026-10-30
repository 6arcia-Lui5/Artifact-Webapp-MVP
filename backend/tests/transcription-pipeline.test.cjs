const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const sharp = require('sharp');
const express = require('express');

// Stub account lookups only. Exercise real middleware, HTTP readers, image
// processing and comparison contracts, without credentials or GPU calls.
for (const [name, exports] of [
  ['@clerk/express', { getAuth: req => ({ userId: req.headers['x-test-user'] || null }) }],
  ['../dist/config/env.js', { ENV: { NODE_ENV: 'test', ALLOWED_CLERK_USER_IDS: 'approved,second' } }],
]) {
  const filename = require.resolve(name);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const { requireSiteAccess } = require('../dist/middleware/requireSiteAccess.js');
const { createTranscriptionRouter } = require('../dist/routes/transcriptionRoutes.js');
const { compareReadings, consensusReading, pipelineConfiguration, runTranscriptionPipeline } = require('../dist/services/transcriptionPipeline.js');

let server, readers, base, readersUrl, png, jpeg, config, state, calls;
let cancelledStreams = 0;
let completedKinds = [], heldReaders = new Map();
const envNames = ['LOCAL_VISION_URL', 'OCR_SERVICE_URL', 'LOCAL_VISION_MODEL', 'TRANSCRIPTION_VISION_MODEL', 'TRANSCRIPTION_SECONDARY_MODEL', 'LOCAL_VISION_TOKEN', 'OCR_SERVICE_TOKEN'];
const previousEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
const listen = instance => new Promise(resolve => instance.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${instance.address().port}`)));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) { for (let i = 0; i < 100; i++) { if (predicate()) return; await sleep(10); } assert.fail('Expected reader state was not observed'); }

before(async () => {
  png = await sharp({ create: { width: 40, height: 20, channels: 3, background: 'white' } }).png().toBuffer();
  jpeg = await sharp(png).jpeg().toBuffer();
  readers = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const isOcr = req.url === '/transcribe';
    const body = isOcr ? Buffer.concat(chunks) : JSON.parse(Buffer.concat(chunks));
    const kind = isOcr ? 'ocr' : body.format?.properties?.glyphs ? 'glyph' : body.model === 'secondary-test-model' ? 'secondary' : 'whole';
    calls.push({ kind, headers: req.headers, body, completedBefore: completedKinds.slice() });
    const completionList = completedKinds;
    res.once('finish', () => completionList.push(kind));
    const mode = state[kind + 'Mode'];
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'hold') {
      await new Promise(resolve => heldReaders.set(kind, resolve));
      if (res.destroyed) return;
    }
    if (mode === 'wait') { res.once('close', () => cancelledStreams++); return; }
    if (mode === 'unavailable') { res.statusCode = 503; res.end('private upstream details'); return; }
    if (mode === 'oversized') {
      res.once('close', () => cancelledStreams++);
      res.write(' '.repeat(128 * 1024));
      setTimeout(() => { if (!res.destroyed) res.write(' '.repeat(128 * 1024 + 1)); }, 5);
      return;
    }
    if (mode === 'malformed') { res.end('{'); return; }
    if (isOcr) {
      const result = { text: state.ocrText, image: { width: state.width || 40, height: state.height || 20 }, lines: state.lines };
      if (mode === 'dimensions') result.image.width = 41;
      if (mode === 'outside-box') result.lines = [{ text: 'X', box: [[0,0],[41,0],[40,20],[0,20]], score: .99 }];
      if (mode === 'bad-score') result.lines = [{ text: 'X', box: [[0,0],[40,0],[40,20],[0,20]], score: 1.1 }];
      if (mode === 'bad-box-shape') result.lines = [{ text: 'X', box: [[0],[40,0],[40,20],[0,20]], score: .99 }];
      res.end(JSON.stringify(result));
      return;
    }
    let content = kind === 'glyph' ? { glyphs: state.glyphs } : { text: kind === 'secondary' ? state.secondaryText : state.wholeText };
    if (mode === 'bad-shape') content.extra = true;
    if (mode === 'word-unit') content = { glyphs: ['WHOLEWORD'] };
    if (mode === 'huge-text') content = { text: 'A'.repeat(10001) };
    res.end(JSON.stringify({ done: true, done_reason: mode === 'truncated' ? 'length' : 'stop', message: { content: JSON.stringify(content) } }));
  });
  readersUrl = await listen(readers);
  process.env.LOCAL_VISION_URL = readersUrl;
  process.env.OCR_SERVICE_URL = readersUrl;
  process.env.LOCAL_VISION_MODEL = 'legacy-model';
  process.env.TRANSCRIPTION_VISION_MODEL = 'tested-vision-model';
  delete process.env.TRANSCRIPTION_SECONDARY_MODEL;
  process.env.LOCAL_VISION_TOKEN = 'vision-test-token';
  process.env.OCR_SERVICE_TOKEN = 'ocr-test-token';
  config = pipelineConfiguration();
  const app = express();
  app.use(requireSiteAccess);
  app.use('/api/transcription', createTranscriptionRouter(700));
  server = http.createServer(app);
  base = await listen(server);
});

beforeEach(() => {
  state = { ocrMode: 'ok', wholeMode: 'ok', glyphMode: 'ok', secondaryMode: 'ok', wholeText: 'VIXIT', secondaryText: 'VIXIT', ocrText: 'VIXIT', glyphs: Array.from('VIXIT'),
    lines: [{ text: 'VIXIT', box: [[0,0],[40,0],[40,20],[0,20]], score: .99999 }] };
  calls = [];
  completedKinds = [];
  heldReaders = new Map();
});

after(async () => {
  for (const name of envNames) { if (previousEnv[name] === undefined) delete process.env[name]; else process.env[name] = previousEnv[name]; }
  for (const instance of [server, readers]) { instance.closeAllConnections(); await new Promise(resolve => instance.close(resolve)); }
});

function post(user = 'approved', signal, language = 'lat') {
  const form = new FormData();
  form.append('photo', new Blob([png], { type: 'image/png' }), 'photo.png');
  form.append('language', language);
  return fetch(base + '/api/transcription/pipeline', { method: 'POST', headers: user ? { 'x-test-user': user } : {}, body: form, signal });
}
const run = signal => runTranscriptionPipeline(jpeg, 'lat', config, signal || AbortSignal.timeout(2000));

test('new pipeline route remains behind approved-account access and never writes artifacts', async () => {
  assert.equal((await post(null)).status, 401);
  assert.equal((await post('unapproved')).status, 403);
  assert.equal(calls.length, 0);
  const source = fs.readFileSync(require.resolve('../src/index.ts'), 'utf8');
  assert(source.indexOf('app.use(requireSiteAccess)') < source.indexOf('app.use("/api/transcription"'));
  const route = fs.readFileSync(require.resolve('../src/routes/transcriptionRoutes.ts'), 'utf8');
  assert.doesNotMatch(route, /from ["'].*(?:db|queries)|writeFile/);
  const response = await post();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).provider, 'artifact-pipeline');
});

test('comparison preserves V/U, I/J, accents, punctuation and Unicode character indices', () => {
  assert.equal(compareReadings('V I', 'U J').distance, 2);
  assert.equal(compareReadings('D·M', 'DM').distance, 1);
  assert.equal(compareReadings('Α', 'α').distance, 1);
  assert.equal(compareReadings('α\u0301 V', 'άV').distance, 0);
  const result = compareReadings('😀 V', '😀 U');
  assert.deepEqual(result.differences, [{ index: 2, original: 'V', alternative: 'U' }]);
  assert.equal(compareReadings('A'.repeat(2001), 'A').complete, false);
});

test('reader agreement and high OCR scores never certify a transcription', async () => {
  const result = await run();
  assert.equal(result.text, 'VIXIT');
  assert.equal(result.review.status, 'readers_agree');
  assert.equal(result.review.automaticAcceptance, false);
  assert.match(result.review.reason, /not proof/);
  assert.equal(result.lines[0].ocrScore, .99999);
  assert.equal(result.model, 'tested-vision-model');
  assert.match(result.provenance.imageSha256, /^[0-9a-f]{64}$/);
  assert.equal(calls.find(call => call.kind === 'ocr').headers.authorization, 'Bearer ocr-test-token');
  assert.equal(calls.find(call => call.kind === 'whole').headers.authorization, 'Bearer vision-test-token');
  const image = await sharp(Buffer.from(calls.find(call => call.kind === 'glyph').body.messages[0].images[0], 'base64')).metadata();
  assert(image.width > 0 && image.height > 0);
  assert(calls.filter(call => call.kind !== 'ocr').every(call => call.body.keep_alive === '5m'));
});

test('whole-photo reading stays primary when glyph rereading or OCR drops a character', async () => {
  state.ocrText = 'VIXI'; state.lines[0].text = 'VIXI'; state.glyphs = Array.from('VIXI');
  const result = await run();
  assert.equal(result.text, 'VIXIT');
  assert.equal(result.review.status, 'readers_disagree');
  assert.equal(result.review.automaticAcceptance, false);
  assert(result.readings.some(reading => reading.text === 'VIXI'));
  assert(result.comparisons.some(reading => reading.comparison.distance === 1));
});

test('OCR outage degrades explicitly to a single full-photo reader', async () => {
  state.ocrMode = 'unavailable';
  const result = await run();
  assert.equal(result.text, 'VIXIT');
  assert.equal(result.review.status, 'single_reader');
  assert.equal(result.review.automaticAcceptance, false);
  assert(result.notes.some(note => /OCR reader was unavailable/.test(note)));
  assert.equal(calls.filter(call => call.kind === 'glyph').length, 0);
});

test('invalid OCR dimensions, boxes and scores are discarded before image extraction', async () => {
  for (const mode of ['dimensions', 'outside-box', 'bad-score', 'bad-box-shape']) {
    state.ocrMode = mode; calls = [];
    const result = await run();
    assert.equal(result.text, 'VIXIT');
    assert.equal(result.lines.length, 0);
    assert(result.notes.some(note => /invalid layout/.test(note)));
    assert.equal(calls.filter(call => call.kind === 'glyph').length, 0);
  }
});

test('incomplete whole reading can fall back to complete line glyphs and OCR', async () => {
  state.wholeMode = 'truncated';
  const result = await run();
  assert.equal(result.text, 'VIXIT');
  assert.equal(result.readings.some(reading => reading.kind === 'whole_photo'), false);
  assert(result.notes.some(note => /full-photo reader/.test(note)));
  assert.equal(result.review.automaticAcceptance, false);
});

test('incomplete or word-sized glyph responses cannot replace the full-photo reading', async () => {
  for (const mode of ['truncated', 'word-unit', 'bad-shape']) {
    state.glyphMode = mode;
    const result = await run();
    assert.equal(result.text, 'VIXIT');
    assert.equal(result.readings.some(reading => reading.kind === 'line_glyphs'), false);
    assert(result.notes.some(note => /line could not be read/.test(note)));
  }
});

test('numeral-only layout does not erase ancient letters and conflicting empty readings remain visible', async () => {
  state.ocrText = '1942'; state.lines[0].text = '1942'; state.glyphs = Array.from('1942');
  const result = await run();
  assert.equal(result.text, 'VIXIT');
  assert.equal(result.review.status, 'readers_disagree');
  assert(result.notes.some(note => /inventory/.test(note)));
  state.wholeText = ''; state.glyphs = [];
  const empty = await run();
  assert.equal(empty.review.status, 'readers_disagree');
  assert(empty.readings.some(reading => reading.text === '1942'));
});

test('upstream JSON streams are cancelled at the response-byte boundary', async () => {
  const before = cancelledStreams;
  state.ocrMode = state.wholeMode = 'oversized';
  await assert.rejects(run(), /Neither transcription reader/);
  await until(() => cancelledStreams >= before + 2);
});

test('abort cancels both waiting upstream readers and does not start line requests', async () => {
  const before = cancelledStreams;
  state.ocrMode = state.wholeMode = 'wait';
  const controller = new AbortController();
  const pending = run(controller.signal);
  await until(() => calls.length === 2);
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  await until(() => cancelledStreams >= before + 2);
  assert.equal(calls.some(call => call.kind === 'glyph'), false);
});

test('pipeline route timeout releases the shared transcription slot', async () => {
  state.ocrMode = state.wholeMode = 'wait';
  const timedOut = await post();
  assert.equal(timedOut.status, 504);
  state.ocrMode = state.wholeMode = 'ok';
  assert.equal((await post()).status, 200);
});

test('configuration and unsupported-language errors fail before inference', async () => {
  assert.equal((await post('approved', undefined, 'heb')).status, 400);
  assert.equal(calls.length, 0);
  process.env.OCR_SERVICE_URL = 'https://user:password@example.com';
  assert.equal(pipelineConfiguration(), null);
  process.env.OCR_SERVICE_URL = readersUrl;
});

test('a thin OCR box cannot amplify a bounded photo into an unbounded line image', async () => {
  const wide = await sharp({ create: { width: 2400, height: 20, channels: 3, background: 'white' } }).jpeg().toBuffer();
  state.width = 2400;
  state.lines[0].box = [[0,0],[2400,0],[2400,1],[0,1]];
  const result = await runTranscriptionPipeline(wide, 'lat', config, AbortSignal.timeout(2000));
  const glyph = calls.find(call => call.kind === 'glyph');
  assert(glyph, 'The valid thin region should have a bounded rereading attempt');
  const meta = await sharp(Buffer.from(glyph.body.messages[0].images[0], 'base64')).metadata();
  assert(meta.width <= 4096 && meta.height <= 180);
  assert.equal(result.review.automaticAcceptance, false);
});

test('combined line readings over the character budget cannot become the primary fallback', async () => {
  state.wholeMode = 'truncated';
  state.glyphs = Array(200).fill('[illegible]');
  state.lines = Array.from({ length: 12 }, () => ({ text: 'VIXIT', box: [[0,0],[40,0],[40,20],[0,20]], score: .999 }));
  const result = await run();
  assert.equal(result.text, 'VIXIT');
  assert(result.text.length <= 10000);
  assert.equal(result.readings.some(reading => reading.kind === 'line_glyphs'), false);
  assert(result.notes.some(note => /exceeded the text limit/.test(note)));
  assert.equal(result.review.automaticAcceptance, false);
});

test('comparison-budget exhaustion is disclosed separately from genuine reader disagreement', async () => {
  state.wholeText = state.ocrText = 'A'.repeat(2001);
  state.lines = [];
  const result = await run();
  assert.equal(result.review.status, 'comparison_incomplete');
  assert.equal(result.review.automaticAcceptance, false);
  assert.equal(result.comparisons[0].comparison.complete, false);
  assert.equal(result.comparisons[0].comparison.distance, null);
  assert.match(result.comparisons[0].comparison.note, /character limit/);
});

test('consensus applies agreed insertions and replacements at the same boundary', () => {
  for (const [primary, reading] of [['AB', 'AXY'], ['A😀B', 'Aαβ😀B'], ['😀 V I', '😀 U J'], ['AAB', 'AB']]) {
    const result = consensusReading(primary, reading, reading);
    assert.equal(result.text, reading);
    assert(result.changes.length > 0);
  }
  const combined = consensusReading('AB', 'AXY', 'AXY');
  assert(combined.changes.some(change => change.original === ''));
  assert(combined.changes.some(change => change.original !== ''));
});

test('consensus normalizes canonical Unicode without conflating distinct glyphs', () => {
  const result = consensusReading('Α', 'α\u0301', 'ά');
  assert.equal(result.text, 'ά');
  assert.deepEqual(result.changes, [{ index: 0, original: 'Α', replacement: 'ά' }]);
  assert.equal(consensusReading('V', 'U', 'V').text, 'V');
  assert.equal(consensusReading('I', 'J', 'I').text, 'I');
});

test('conflicting or nonmatching edits do not gain a false character majority', () => {
  for (const [primary, first, second] of [['VIXIT', 'UIXIT', 'VIXXT'], ['ABC', 'AC', 'AXC'], ['ABC', 'ABXC', 'AXBC']]) {
    const result = consensusReading(primary, first, second);
    assert.equal(result.text, primary);
    assert.deepEqual(result.changes, []);
  }
});

test('agreed deletion remains possible while empty readers and incomplete comparisons cannot erase the primary', () => {
  assert.equal(consensusReading('ABXC', 'ABC', 'ABC').text, 'ABC');
  for (const [first, second] of [['', ''], ['', 'ABC'], ['ABC', '']]) {
    assert.deepEqual(consensusReading('ABXC', first, second), { text: 'ABXC', changes: [] });
  }
  const primary = 'A'.repeat(2001);
  assert.deepEqual(consensusReading(primary, primary + 'X', primary + 'X'), { text: primary, changes: [] });
});

test('partial edit agreement is explicitly a composed candidate and remains unverified', async () => {
  state.wholeText = 'AB'; state.secondaryText = 'AXY'; state.ocrText = 'AXZ';
  const result = await runTranscriptionPipeline(jpeg, 'lat', { ...config, secondaryModel: 'secondary-test-model' }, AbortSignal.timeout(2000));
  assert.equal(result.text, 'AXB');
  assert(!['AB', 'AXY', 'AXZ'].includes(result.text), 'This case must exercise a composed, rather than copied, reading');
  assert(result.readings.some(reading => reading.kind === 'consensus'));
  assert.equal(result.consensusChanges.length, 1);
  assert.equal(result.review.status, 'readers_disagree');
  assert.equal(result.review.automaticAcceptance, false);
  assert.match(result.review.reason, /not proof/);
});

test('secondary and OCR agreement may adjust a primary character but never enables automatic acceptance', async () => {
  state.wholeText = 'VIXIT'; state.secondaryText = state.ocrText = 'VIXI';
  const result = await runTranscriptionPipeline(jpeg, 'lat', { ...config, secondaryModel: 'secondary-test-model' }, AbortSignal.timeout(2000));
  assert.equal(result.text, 'VIXI');
  assert.equal(result.review.automaticAcceptance, false);
  assert(result.readings.some(reading => reading.kind === 'whole_photo' && reading.text === 'VIXIT'));
  assert(result.readings.some(reading => reading.kind === 'secondary_vision' && reading.text === 'VIXI'));
  assert.equal(calls.filter(call => call.kind === 'secondary').length, 1);
  assert.equal(calls.filter(call => call.kind === 'glyph').length, 0);
});

test('secondary failures preserve the usable primary and disclose the missing comparison', async () => {
  for (const mode of ['unavailable', 'truncated', 'malformed', 'huge-text']) {
    state.secondaryMode = mode; calls = [];
    const result = await runTranscriptionPipeline(jpeg, 'lat', { ...config, secondaryModel: 'secondary-test-model' }, AbortSignal.timeout(2000));
    assert.equal(result.text, 'VIXIT');
    assert.deepEqual(result.consensusChanges, []);
    assert.equal(result.readings.some(reading => reading.kind === 'secondary_vision'), false);
    assert(result.notes.some(note => /secondary|second.*reader/i.test(note)));
    assert.equal(result.review.automaticAcceptance, false);
  }
});

test('a secondary reader cannot fabricate three-way agreement when OCR is unavailable', async () => {
  state.ocrMode = 'unavailable'; state.secondaryText = state.wholeText = 'VIXIT';
  const result = await runTranscriptionPipeline(jpeg, 'lat', { ...config, secondaryModel: 'secondary-test-model' }, AbortSignal.timeout(2000));
  assert.equal(result.text, 'VIXIT');
  assert.equal(result.readings.length, 2);
  assert.deepEqual(result.consensusChanges, []);
  assert.equal(result.review.automaticAcceptance, false);
  assert(result.notes.some(note => /no independent OCR comparison/.test(note)));
});

test('secondary equal to the primary model is treated as disabled, preserving line rereading', async () => {
  const result = await runTranscriptionPipeline(jpeg, 'lat', { ...config, secondaryModel: config.model }, AbortSignal.timeout(2000));
  assert.equal(calls.filter(call => call.kind === 'whole').length, 1);
  assert.equal(calls.filter(call => call.kind === 'glyph').length, 1);
  assert(result.readings.some(reading => reading.kind === 'line_glyphs'));
  assert.equal(result.review.automaticAcceptance, false);
});

test('abort during the primary reading cancels OCR and does not load the queued secondary model', async () => {
  const before = cancelledStreams;
  state.ocrMode = state.wholeMode = state.secondaryMode = 'wait';
  const controller = new AbortController();
  const pending = runTranscriptionPipeline(jpeg, 'lat', { ...config, secondaryModel: 'secondary-test-model' }, controller.signal);
  await until(() => calls.length === 2);
  assert.equal(calls.some(call => call.kind === 'secondary'), false);
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  await until(() => cancelledStreams >= before + 2);
});

test('distinct vision models run sequentially and release memory while CPU OCR remains parallel', async () => {
  state.wholeMode = state.ocrMode = 'hold';
  const pending = runTranscriptionPipeline(jpeg, 'lat', { ...config, secondaryModel: 'secondary-test-model' }, AbortSignal.timeout(2000));
  pending.catch(() => {});
  try {
    await until(() => heldReaders.has('ocr') && heldReaders.has('whole'));
    assert.equal(calls.some(call => call.kind === 'secondary'), false, 'The second vision model loaded before the primary completed');
    heldReaders.get('whole')();
    await until(() => calls.some(call => call.kind === 'secondary'));
    const second = calls.find(call => call.kind === 'secondary');
    assert(second.completedBefore.includes('whole'));
    assert.equal(second.completedBefore.includes('ocr'), false, 'Slow CPU OCR should not gate the next GPU reader');
    heldReaders.get('ocr')();
    const result = await pending;
    assert.equal(result.text, 'VIXIT');
    assert.equal(result.provenance.workflow, 'reader-comparison-v3');
    assert.equal(result.review.automaticAcceptance, false);
    assert.equal(calls.find(call => call.kind === 'whole').body.keep_alive, 0);
    assert.equal(second.body.keep_alive, 0);
  } finally {
    for (const release of heldReaders.values()) release();
    await pending.catch(() => {});
  }
});

test('failed primary reading releases its turn and still permits a secondary fallback', async () => {
  state.wholeMode = 'truncated';
  const result = await runTranscriptionPipeline(jpeg, 'lat', { ...config, secondaryModel: 'secondary-test-model' }, AbortSignal.timeout(2000));
  assert.equal(result.text, 'VIXIT');
  const second = calls.find(call => call.kind === 'secondary');
  assert(second.completedBefore.includes('whole'));
  assert.equal(second.body.keep_alive, 0);
  assert.equal(result.review.automaticAcceptance, false);
});

test('abort during the secondary reading cancels it and the still-running OCR without hanging', async () => {
  const before = cancelledStreams;
  state.ocrMode = state.secondaryMode = 'wait';
  const controller = new AbortController();
  const pending = runTranscriptionPipeline(jpeg, 'lat', { ...config, secondaryModel: 'secondary-test-model' }, controller.signal);
  await until(() => calls.some(call => call.kind === 'secondary'));
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  await until(() => cancelledStreams >= before + 2);
  assert.equal(calls.filter(call => call.kind === 'whole').length, 1);
});

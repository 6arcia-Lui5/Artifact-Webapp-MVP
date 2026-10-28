import test from 'node:test';
import assert from 'node:assert/strict';
import { createOcrJob } from '../src/components/photoTranscription/ocr.js';

class FakeWorker {
  static latest;
  messages = [];
  terminated = false;
  constructor() { FakeWorker.latest = this; }
  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  reply(status, data, jobId = this.messages.at(-1).jobId) {
    this.onmessage({ data: { jobId, status, data } });
  }
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('cancel stops the native worker during initialization and rejects pending work', async () => {
  const job = createOcrJob(() => {}, FakeWorker);
  const result = job.recognize(new Uint8Array([1]), 'lat');
  assert.equal(FakeWorker.latest.messages[0].action, 'load');
  job.stop();
  await assert.rejects(result, /cancelled/);
  assert.equal(FakeWorker.latest.terminated, true);
  job.stop();
});

test('only matching progress/results are accepted and success terminates the worker', async () => {
  const updates = [];
  const job = createOcrJob(update => updates.push(update), FakeWorker);
  const worker = FakeWorker.latest;
  const result = job.recognize(new Uint8Array([1]), 'grc');
  worker.reply('progress', { progress: 0.5 }, 'stale-job');
  assert.equal(updates.length, 0);
  worker.reply('progress', { progress: 0.5 });
  assert.equal(updates.length, 1);
  for (const action of ['load', 'loadLanguage', 'initialize']) {
    assert.equal(worker.messages.at(-1).action, action);
    worker.reply('resolve', {});
    await tick();
  }
  assert.equal(worker.messages.at(-1).action, 'recognize');
  worker.reply('resolve', { text: 'ΑΒΓ' });
  assert.equal(await result, 'ΑΒΓ');
  assert.equal(worker.terminated, true);
  worker.reply('progress', { progress: 1 });
  assert.equal(updates.length, 1);
});

test('model-download failure releases the worker and returns an error', async () => {
  const job = createOcrJob(() => {}, FakeWorker);
  const worker = FakeWorker.latest;
  const result = job.recognize(new Uint8Array([1]), 'heb');
  worker.reply('resolve', {});
  await tick();
  assert.equal(worker.messages.at(-1).action, 'loadLanguage');
  worker.reply('reject', 'Network failure');
  await assert.rejects(result, /failed/);
  assert.equal(worker.terminated, true);
});

test('worker startup errors do not leave initialization pending', async () => {
  const job = createOcrJob(() => {}, FakeWorker);
  const result = job.recognize(new Uint8Array([1]), 'eng');
  FakeWorker.latest.onerror({ preventDefault() {} });
  await assert.rejects(result, /could not load/);
  assert.equal(FakeWorker.latest.terminated, true);
});

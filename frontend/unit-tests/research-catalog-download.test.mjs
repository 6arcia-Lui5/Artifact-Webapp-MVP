import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadErrorPayload } from '../src/components/research/catalogDownload.js';

test('blob downloads preserve actionable JSON export errors', async () => {
  const payload = new Blob([JSON.stringify({ error: 'Export limited to 1000 records; narrow filters or select IDs' })], { type: 'application/json' });
  assert.deepEqual(await downloadErrorPayload(payload), { error: 'Export limited to 1000 records; narrow filters or select IDs' });
});

test('download error reads retain malformed, oversized, and already decoded responses', async () => {
  const malformed = new Blob(['Proxy unavailable'], { type: 'text/plain' });
  assert.equal(await downloadErrorPayload(malformed), malformed);
  const oversized = new Blob(['x'.repeat(64 * 1024 + 1)]);
  oversized.text = () => { throw new Error('Oversized payload must not be read'); };
  assert.equal(await downloadErrorPayload(oversized), oversized);
  const decoded = { error: 'Export exceeds 4 MiB; narrow filters or select fewer IDs' };
  assert.equal(await downloadErrorPayload(decoded), decoded);
});

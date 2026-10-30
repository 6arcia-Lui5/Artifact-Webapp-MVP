// Download requests also receive JSON error responses as blobs. Bound the error
// read so a failed download cannot turn into an unbounded text allocation.
export async function downloadErrorPayload(payload) {
  if (!(payload instanceof Blob) || payload.size > 64 * 1024) return payload;
  try { return JSON.parse(await payload.text()); }
  catch { return payload; }
}

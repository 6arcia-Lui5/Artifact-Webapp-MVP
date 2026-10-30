// Load the existing authenticated client only when a request is needed.
const client = async () => (await import('./axios.js')).default;
const root = '/research';
const segment = value => encodeURIComponent(value);
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

export function validateImportFile(file) {
  if (!file) return 'Choose a CSV or XLSX file.';
  if (!/\.(csv|xlsx)$/i.test(file.name)) return 'Choose a CSV or XLSX file.';
  if (!file.size) return 'The file is empty.';
  return file.size > MAX_IMPORT_BYTES ? 'The file must be 4 MiB or smaller.' : '';
}
export function validateImageFile(file) {
  if (!file) return 'Choose an original image.';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Choose one PNG, JPEG, or WebP image.';
  if (!file.size) return 'The image is empty.';
  return file.size > MAX_IMPORT_BYTES ? 'The image must be 4 MiB or smaller.' : '';
}
export function parseObjectIds(text) {
  const ids = [...new Set(text.trim().split(/[\s,;]+/).filter(Boolean))];
  if (!ids.length || ids.length > 25 || ids.some(id => !/^\d{1,10}$/.test(id) || Number(id) <= 0)) {
    throw new Error('Enter 1 to 25 positive numeric object IDs of up to 10 digits, separated by commas or spaces.');
  }
  return ids;
}
export function selectableRows(rows = []) {
  return rows.filter(row => !row.errors?.length && !row.duplicate && !row.duplicateRecordId && !row.state).map(row => row.rowNumber);
}
export function createRestoreSelection(revisionId, record) {
  return Number.isInteger(record.revision) && record.revision >= 1 ? { revisionId, expectedRevision: record.revision } : null;
}
export function importProgressIssue(next, previous) {
  const errors = previous?.errorCount ?? previous?.errors ?? 0;
  if (next.errorCount > errors) return 'The batch reported errors. Review the saved row errors before continuing.';
  if (!Number.isFinite(next.remaining) || next.remaining < 0) return 'Import stopped because the server did not return remaining-row progress. Reload the saved job before continuing.';
  if (previous && next.importedCount === (previous.importedCount ?? previous.imported)
    && next.skippedCount === (previous.skippedCount ?? previous.skipped)
    && next.errorCount === errors && next.remaining === previous.remaining && next.remaining > 0) {
    return 'Import stopped because this batch made no further progress. Review the saved job before continuing.';
  }
  return '';
}
export function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export const imagePreviewUrl = image => image.thumbnailUrl || image.url || image.sourceUrl || null;
export function applicationImageUrl(value, apiBase = import.meta.env?.VITE_API_URL || '/api', pageOrigin = globalThis.location?.origin || 'http://localhost') {
  try {
    const base = new URL(apiBase || '/api', pageOrigin);
    const target = typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? new URL(value, base.origin) : new URL(value);
    const prefix = `${base.pathname.replace(/\/$/, '')}/`;
    return safeHttpUrl(target.href) && target.origin === base.origin && target.pathname.startsWith(prefix) ? target.href : null;
  } catch { return null; }
}
export function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return 'Unknown';
  if (value < 1024) return `${value} bytes`;
  return `${(value / (1024 ** (value < 1024 * 1024 ? 1 : 2))).toFixed(1)} ${value < 1024 * 1024 ? 'KiB' : 'MiB'}`;
}
export const ingestError = error => error?.response?.data?.error || error?.response?.data?.message || error?.message || 'The request failed. Your input has been kept.';
export async function invalidateCatalog(client, id) {
  await client.invalidateQueries({ predicate: query => {
    const first = String(query.queryKey[0]);
    return ['records', 'myRecords', 'research', 'researchRecords', 'researchFacets', 'collections', 'researchCollections'].includes(first)
      || first.startsWith('research') || (first === 'record' && (!id || query.queryKey[1] === id));
  } });
}
const get = async (path, signal) => (await (await client()).get(`${root}${path}`, { signal, timeout: 25000 })).data;
export const getImportSources = signal => get('/sources', signal);
export const getImportJobs = signal => get('/imports', signal);
export const getImportJob = (id, signal) => get(`/imports/${segment(id)}`, signal);
export async function previewImport({ file, mapping, sourceProvider, objectIds }, signal) {
  let body;
  if (file) {
    body = new FormData(); body.append('file', file);
    if (mapping) body.append('mapping', JSON.stringify(mapping));
  } else body = { sourceProvider, objectIds };
  return (await (await client()).post(`${root}/imports/preview`, body, { signal, timeout: 60000 })).data;
}
export const commitImport = async (id, rowNumbers) => (await (await client()).post(`${root}/imports/${segment(id)}/commit`, { skipDuplicates: true, rowNumbers }, { timeout: 60000 })).data;
export const getImages = (id, signal) => get(`/records/${segment(id)}/images`, signal);
export const getStorageStatus = signal => get('/storage/status', signal);
export const addImage = async (id, body) => (await (await client()).post(`${root}/records/${segment(id)}/images`, body, { timeout: 60000 })).data;
export const updateImage = async (id, imageId, body) => (await (await client()).patch(`${root}/records/${segment(id)}/images/${segment(imageId)}`, body)).data;
export const removeImage = async (id, imageId) => (await (await client()).delete(`${root}/records/${segment(id)}/images/${segment(imageId)}`)).data;
// Only send application credentials to the configured API origin and API path.
export async function getPrivateImageBlob(url, signal) {
  const api = await client();
  const target = applicationImageUrl(url, api.defaults.baseURL, window.location.origin);
  if (!target) throw new Error('This image could not be loaded securely.');
  return (await api.get(target, { responseType: 'blob', signal, timeout: 25000 })).data;
}
export const getRecordHistory = (id, signal) => get(`/records/${segment(id)}/history`, signal);
export const saveRecordReview = async (id, body) => (await (await client()).patch(`${root}/records/${segment(id)}/review`, body)).data;
export const restoreRecordRevision = async (id, revisionId, expectedRevision) => (await (await client()).post(`${root}/records/${segment(id)}/history/${segment(revisionId)}/restore`, { expectedRevision })).data;

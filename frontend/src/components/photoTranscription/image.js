import { sourceUrl } from '../../../lib/artifactImages.js';

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export const MODES = {
  lat: { language: 'Latin', script: 'Latin' },
  grc: { language: 'Ancient Greek', script: 'Greek' },
  eng: { language: 'English', script: 'Latin' },
  heb: { language: 'Hebrew', script: 'Hebrew' },
};
export const FULL_CROP = { x: 0, y: 0, width: 100, height: 100 };

export function validateFile(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a PNG, JPEG, or WebP photo.');
  }
  if (!file.size || file.size > MAX_PHOTO_BYTES) throw new Error('Choose a photo no larger than 8 MB.');
}

export function validateDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 20_000_000) {
    throw new Error('Choose a photo with no more than 20 million pixels.');
  }
}

export async function validatePhoto(file) {
  validateFile(file);
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!({ 'image/png': png, 'image/jpeg': jpeg, 'image/webp': webp })[file.type]) {
    throw new Error('The file does not match its photo format. Export it as a PNG or JPEG and try again.');
  }
}

// Download into the browser only. Both advertised length and streamed bytes are
// bounded because a remote host may omit or misreport Content-Length.
export async function downloadPhoto(value, signal) {
  const url = sourceUrl(value);
  if (!url) throw new Error('The catalog image must use an http or https URL.');
  const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20000)]);
  requestSignal.throwIfAborted();
  const response = await fetch(url, {
    credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors', signal: requestSignal,
  });
  let reader;
  try {
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!response.ok || !response.body || !['image/png', 'image/jpeg', 'image/webp'].includes(type)) {
      throw new Error('The catalog link did not return a supported photo.');
    }
    const declaredSize = Number(response.headers.get('content-length'));
    if (declaredSize > MAX_PHOTO_BYTES) throw new Error('Choose a photo no larger than 8 MB.');
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      requestSignal.throwIfAborted();
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > MAX_PHOTO_BYTES) throw new Error('Choose a photo no larger than 8 MB.');
      chunks.push(chunk);
    }
    requestSignal.throwIfAborted();
    const extension = type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
    const file = new File(chunks, `catalog-photo.${extension}`, { type });
    await validatePhoto(file);
    return file;
  } finally {
    if (reader) {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    } else {
      await response.body?.cancel().catch(() => {});
    }
  }
}

export function cropPixels(crop, width, height) {
  const { x, y, width: w, height: h } = crop;
  if (![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 100 || y + h > 100) {
    throw new Error('Keep the crop inside the photo, with a width and height greater than zero.');
  }
  const left = Math.floor(x * width / 100);
  const top = Math.floor(y * height / 100);
  return { left, top, width: Math.max(1, Math.ceil((x + w) * width / 100) - left), height: Math.max(1, Math.ceil((y + h) * height / 100) - top) };
}

export function boundedSize(width, height) {
  const scale = Math.min(1, 2400 / width, 2400 / height, Math.sqrt(4_000_000 / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export async function decodePhoto(url) {
  const image = new Image();
  image.src = url;
  try { await image.decode(); } catch { throw new Error('This photo could not be opened. Export it as a PNG or JPEG and try again.'); }
  validateDimensions(image.naturalWidth, image.naturalHeight);
  return image;
}

// Draw directly into a bounded destination, never a full-size intermediate canvas.
export function renderPhoto(image, rotation, crop = FULL_CROP) {
  const sideways = rotation % 180 !== 0;
  const width = sideways ? image.naturalHeight : image.naturalWidth;
  const height = sideways ? image.naturalWidth : image.naturalHeight;
  const rect = cropPixels(crop, width, height);
  const size = boundedSize(rect.width, rect.height);
  const canvas = document.createElement('canvas');
  Object.assign(canvas, size);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image processing is unavailable in this browser. Try a current browser.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(size.width / rect.width, size.height / rect.height);
  context.translate(-rect.left, -rect.top);
  context.translate(width / 2, height / 2);
  context.rotate(rotation * Math.PI / 180);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  return canvas;
}

export function canvasBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not prepare the crop. Try a smaller photo.')), type, quality));
}

// Leave room for multipart headers below Vercel's 4.5 MB request-body limit.
export async function visionPhotoBlob(canvas) {
  const maxBytes = 3.5 * 1024 * 1024;
  for (const quality of [0.92, 0.8, 0.65]) {
    const blob = await canvasBlob(canvas, 'image/jpeg', quality);
    if (blob.size <= maxBytes) return blob;
  }
  throw new Error('This crop is too large to send. Select a smaller inscription area and retry.');
}

// Vite emits the pinned package's classic worker as a separate production asset.
const workerUrl = new URL('../../../node_modules/tesseract.js/dist/worker.min.js?no-inline', import.meta.url).href;

// Small adapter for the pinned 7.0.0 worker protocol (src/createWorker.js).
// Owning the native Worker from creation lets Cancel terminate initialization
// and model downloads too; createWorker() exposes it only after initialization.
export function createOcrJob(onProgress, WorkerClass = Worker) {
  const worker = new WorkerClass(workerUrl);
  let pending = null;
  let stopped = false;
  let sequence = 0;
  const stop = (error = new Error('Transcription cancelled.')) => {
    if (stopped) return;
    stopped = true;
    worker.terminate();
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      pending = null;
    }
  };
  worker.onerror = event => { event.preventDefault(); stop(new Error('OCR worker could not load.')); };
  worker.onmessageerror = () => stop(new Error('OCR worker response could not be read.'));
  worker.onmessage = ({ data: message }) => {
    if (stopped || !pending || message.jobId !== pending.id) return;
    if (message.status === 'progress') {
      onProgress(message.data);
    } else if (message.status === 'resolve' || message.status === 'reject') {
      const current = pending;
      pending = null;
      clearTimeout(current.timer);
      if (message.status === 'resolve') current.resolve(message.data);
      else { current.reject(new Error('OCR processing failed.')); stop(); }
    }
  };
  const send = (action, payload) => new Promise((resolve, reject) => {
    if (stopped) { reject(new Error('Transcription cancelled.')); return; }
    const id = `photo-${++sequence}`;
    const timer = setTimeout(() => stop(new Error('OCR download or processing timed out.')), 180_000);
    pending = { id, resolve, reject, timer };
    worker.postMessage({ workerId: 'photo', jobId: id, action, payload });
  });
  return {
    stop,
    async recognize(bytes, language) {
      try {
        await send('load', { options: { lstmOnly: true, corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0', logging: false } });
        await send('loadLanguage', { langs: language, options: {
          langPath: `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${language}@1.0.0/4.0.0_best_int`,
          gzip: true, lstmOnly: true, cacheMethod: 'none',
        } });
        await send('initialize', { langs: language, oem: 1, config: {} });
        const result = await send('recognize', { image: bytes, options: {}, output: { text: true } });
        return result.text || '';
      } finally { stop(); }
    },
  };
}

import { useEffect, useRef, useState } from 'react';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { MODES, FULL_CROP, validatePhoto, downloadPhoto, decodePhoto, renderPhoto, canvasBlob, visionPhotoBlob, cropPixels } from './image';
import { getTranscriptionStatus, transcribePhoto, getMuseumTranscriptionPhoto } from '../../../lib/api';
import { sourceUrl, metObjectId } from '../../../lib/artifactImages';

const READING_LABELS = { whole_photo: 'Full-photo reading', secondary_vision: 'Second photo reading', consensus: 'Combined reading', line_glyphs: 'Individual-line reading', ocr: 'OCR reading' };

export default function PhotoTranscription({ onAdd, full, imageSourceUrl }) {
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [crop, setCrop] = useState(FULL_CROP);
  const [mode, setMode] = useState('lat');
  const [method, setMethod] = useState('browser');
  const [service, setService] = useState({ loading: true, configured: false });
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ status: '', progress: 0 });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const job = useRef(null);
  const photoUrl = useRef(null);
  const catalogRequest = useRef(null);
  const catalogSource = sourceUrl(imageSourceUrl);

  // A download started from an old catalog URL must not replace the new source.
  useEffect(() => () => catalogRequest.current?.abort(), [catalogSource]);

  useEffect(() => {
    const controller = new AbortController();
    getTranscriptionStatus(controller.signal).then(status => {
      if (controller.signal.aborted) return;
      setService({ loading: false, configured: status.configured === true, pipelineConfigured: status.pipelineConfigured === true });
      if (status.pipelineConfigured === true) setMethod('pipeline');
      else if (status.configured === true) setMethod('vision');
    }).catch(() => {
      if (!controller.signal.aborted) setService({ loading: false, configured: false });
    });
    return () => controller.abort();
  }, []);

  const invalidate = () => {
    generation.current += 1;
    job.current?.stop();
    job.current = null;
    setBusy(false);
    setLoading(false);
    setDraft(null);
    setError('');
    setNotice('');
  };
  useEffect(() => () => {
    generation.current += 1;
    job.current?.stop();
    if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
  }, []);

  function beginPhoto() {
    invalidate();
    setPhoto(null);
    setPreview('');
    setRotation(0);
    setCrop(FULL_CROP);
    if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
    photoUrl.current = null;
    setLoading(true);
    return generation.current;
  }

  async function loadPhoto(file, token, signal) {
    let url;
    try {
      await validatePhoto(file);
      if (token !== generation.current) return;
      signal?.throwIfAborted();
      url = URL.createObjectURL(file);
      photoUrl.current = url;
      const image = await decodePhoto(url);
      signal?.throwIfAborted();
      if (token === generation.current) {
        setPreview(renderPhoto(image, 0).toDataURL('image/png'));
        setPhoto(image);
      }
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (photoUrl.current === url) photoUrl.current = null;
    }
  }

  async function choosePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const token = beginPhoto();
    try {
      await loadPhoto(file, token);
    } catch (failure) {
      if (token === generation.current) setError(failure.message);
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }

  async function useCatalogPhoto() {
    if (!catalogSource) return;
    const token = beginPhoto();
    const controller = new AbortController();
    catalogRequest.current = controller;
    job.current = { stop: () => controller.abort() };
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
    try {
      const objectId = metObjectId(catalogSource);
      const file = objectId ? await getMuseumTranscriptionPhoto(objectId, signal) : await downloadPhoto(catalogSource, signal);
      if (token !== generation.current) return;
      await loadPhoto(file, token, signal);
    } catch {
      if (token === generation.current) setError('The catalog image could not be opened. Its host may block downloads, or the link may be a web page. Download the photo and choose the local file instead. Your form entries are still here.');
    } finally {
      if (catalogRequest.current === controller) catalogRequest.current = null;
      if (token === generation.current) { job.current = null; setLoading(false); }
    }
  }

  let cropError = '';
  try { cropPixels(crop, 100, 100); } catch (failure) { cropError = failure.message; }
  async function recognize() {
    invalidate();
    const token = generation.current;
    setBusy(true);
    setProgress({ status: 'Preparing photo', progress: 0 });
    let activeJob;
    try {
      const canvas = renderPhoto(photo, rotation, crop);
      let text, notes = [], model = '', evidence = null;
      if (method !== 'browser') {
        const blob = await visionPhotoBlob(canvas);
        if (generation.current !== token) return;
        const controller = new AbortController();
        activeJob = { stop: () => controller.abort() };
        job.current = activeJob;
        setProgress({ status: method === 'pipeline' ? 'Reading lines and comparing inscription readings' : 'Reading inscription', progress: null });
        const result = await transcribePhoto(new File([blob], 'inscription-crop.jpg', { type: 'image/jpeg' }), mode, controller.signal, method === 'pipeline');
        text = result.text;
        notes = result.notes || [];
        model = result.model;
        evidence = method === 'pipeline' ? result : null;
      } else {
        const blob = await canvasBlob(canvas);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const { createOcrJob } = await import('./ocr');
        if (generation.current !== token) return;
        activeJob = createOcrJob(update => {
          if (generation.current === token) setProgress({ ...update, status: {
            'loading tesseract core': 'Loading recognition engine',
            'initializing tesseract': 'Preparing recognition',
            'loading language traineddata': 'Loading selected language',
            'initializing api': 'Preparing recognition',
            'recognizing text': 'Reading inscription',
          }[update.status] || 'Preparing recognition' });
        });
        job.current = activeJob;
        text = await activeJob.recognize(bytes, mode);
      }
      if (generation.current !== token) return;
      setDraft({ content: text.slice(0, 10000), ...MODES[mode], translation: '', notes, model, evidence });
      setNotice(text.trim() ? (text.length > 10000 ? 'Only the first 10,000 characters fit in this draft. Crop a smaller area and retry to transcribe the rest separately.' : 'Draft ready. Review and edit it before adding.') : 'No text was found. Crop closer to the letters, rotate the photo, check the language, or try a clearer photo.');
    } catch (failure) {
      if (generation.current === token) setError(method !== 'browser'
        ? `${failure.response?.data?.error || failure.message || 'Photo transcription is unavailable.'} You can retry, choose on-device OCR, or enter the text manually. Your artifact is unchanged.`
        : 'Transcription failed. Check your connection for the first language download, or try a smaller crop. You can also enter the text manually. Your form entries are still here.');
    } finally {
      activeJob?.stop();
      if (generation.current === token) { job.current = null; setBusy(false); }
    }
  }

  return <div className="space-y-4 mt-4" onKeyDown={event => {
    // Editing draft metadata or crop coordinates must not submit the artifact.
    if (event.key === 'Enter' && event.target.tagName === 'INPUT' && event.target.type !== 'file') event.preventDefault();
  }}>
    <p className="text-sm">Select the inscription area, then review the draft beside the photo. Correct uncertain letters before adding it to the record. A photo used here is not saved as the artifact image.</p>
    <label className="block">Recognition method
      <select className="select select-bordered w-full mt-2" value={method} disabled={service.loading} onChange={event => { invalidate(); setMethod(event.target.value); }}>
        <option value="pipeline" disabled={!service.pipelineConfigured || mode === 'heb'}>Read and compare{!service.pipelineConfigured ? ' (not configured)' : ''}</option>
        <option value="vision" disabled={!service.configured}>Vision service{!service.configured ? ' (not configured)' : ''}</option>
        <option value="browser">On-device OCR</option>
      </select>
    </label>
    <p className="text-sm text-base-content/70">{service.loading ? 'Checking assisted transcription availability...'
      : method !== 'browser' ? 'Only the selected crop is sent to the configured transcription services. The catalog does not store this upload. Compared readings expose disagreements; agreement does not establish correctness.'
      : 'Recognition runs on this device. Chosen local files are not uploaded. Language data download on first use. Basic OCR works best on clear, flat lettering and may struggle with carvings.'}</p>
    <label className="block">Local photo (PNG, JPEG, or WebP; up to 8 MB and 20 million pixels)
      <input type="file" accept="image/png,image/jpeg,image/webp" className="file-input file-input-bordered w-full mt-2" onChange={choosePhoto} />
    </label>
    <button type="button" className="btn btn-outline btn-sm" disabled={!catalogSource || loading} onClick={useCatalogPhoto}>Use catalog image</button>
    {!catalogSource && <p className="text-sm text-base-content/70">Add an Image Source URL to use the catalog photo, or choose a local photo above.</p>}
    {loading && <div className="flex flex-wrap items-center gap-3"><p role="status">Opening photo...</p><button type="button" className="btn btn-ghost btn-sm" onClick={() => { invalidate(); setNotice('Photo loading cancelled. You can choose another photo or enter the text manually.'); }}>Cancel photo loading</button></div>}
    {photo && <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-3 min-w-0">
        {preview && <ReactCrop crop={cropError ? undefined : { ...crop, unit: '%' }} onChange={(_, percent) => {
          invalidate();
          setCrop({ x: percent.x, y: percent.y, width: percent.width, height: percent.height });
        }}>
          <img src={preview} alt="Inscription photo. The outlined area is selected for transcription." className="block w-full" />
        </ReactCrop>}
        <button type="button" className="btn btn-outline btn-sm" onClick={() => {
          invalidate();
          const next = (rotation + 90) % 360;
          try { setPreview(renderPhoto(photo, next).toDataURL('image/png')); setRotation(next); setCrop(FULL_CROP); }
          catch { setError('Could not rotate this photo. Try a smaller photo.'); }
        }}>Rotate clockwise 90 degrees</button>
        <p className="text-sm">Rotation: {rotation} degrees. Drag the selection around the letters, or adjust the crop coordinates below.</p>
        <details>
        <summary className="cursor-pointer text-sm underline underline-offset-4">Crop coordinates</summary>
        <fieldset className="grid grid-cols-2 gap-3 mt-3">
          <legend className="font-medium mb-2">Inscription area</legend>
          {Object.entries({ x: 'Left (%)', y: 'Top (%)', width: 'Width (%)', height: 'Height (%)' }).map(([key, label]) => <label key={key} className="block">{label}
            <input type="text" inputMode="decimal" className="input input-bordered w-full mt-1" value={Number.isNaN(crop[key]) ? '' : crop[key]} onChange={event => { invalidate(); setCrop(current => ({ ...current, [key]: event.target.value === '' ? NaN : Number(event.target.value) })); }} />
          </label>)}
        </fieldset>
        </details>
        {cropError && <p role="alert" className="text-error">{cropError}</p>}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { invalidate(); setCrop(FULL_CROP); }}>Use whole photo</button>
      </div>
      <div className="space-y-4 min-w-0">
        <label className="block">Recognition language
          <select className="select select-bordered w-full mt-2" value={mode} onChange={event => {
            invalidate(); setMode(event.target.value);
            if (event.target.value === 'heb' && method === 'pipeline') { setMethod('vision'); setNotice('Compared reading supports Latin, Greek and English. Hebrew uses the single vision reader.'); }
          }}>
            {Object.entries(MODES).map(([key, value]) => <option key={key} value={key}>{value.language}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-outline" disabled={busy || service.loading || Boolean(cropError)} onClick={recognize}>{draft ? 'Retry transcription' : 'Run transcription'}</button>
          {busy && <button type="button" className="btn btn-ghost" onClick={() => { invalidate(); setNotice('Transcription cancelled. You can try again.'); }}>Cancel transcription</button>}
        </div>
        {busy && <div role="status"><p>{progress.status || 'Loading recognition'}{progress.progress === null ? '...' : `: ${Math.round(Math.max(0, Math.min(1, progress.progress || 0)) * 100)}%`}</p><progress className="progress w-full" max="1" value={progress.progress ?? undefined} aria-label="Transcription progress" /></div>}
        {draft && <fieldset className="space-y-3">
          <legend className="font-semibold mb-2">Transcription draft</legend>
          {draft.evidence && <div className="rounded-lg border border-base-300 p-3 space-y-2">
            <p className="font-medium">{draft.evidence.review?.status === 'readers_disagree' ? 'The readers disagree. Check the marked differences against the photo.'
              : draft.evidence.review?.status === 'no_text' ? 'No readable inscription was returned.'
                : draft.evidence.review?.status === 'readers_agree' ? 'The readers agree on the copied characters. This reading is still unverified.'
                  : 'This reading contains uncertainty or could not be fully compared.'}</p>
            <p className="text-sm">Automatic acceptance is not enabled. Internal recognition scores are not accuracy percentages.</p>
            <details>
              <summary className="cursor-pointer text-sm underline underline-offset-4">Compare original machine readings</summary>
              <div className="space-y-3 mt-3">
                {draft.evidence.readings?.map((reading, index) => <div key={index}>
                  <p className="text-xs font-medium">{READING_LABELS[reading.kind] || 'Machine reading'}</p>
                  <pre dir="auto" className="text-sm whitespace-pre-wrap break-words font-sans">{reading.text || 'No text detected'}</pre>
                  {reading.text && <button type="button" className="btn btn-ghost btn-xs" onClick={() => setDraft(current => ({ ...current, content: reading.text, selectedReadingKind: reading.kind }))}>Use this reading</button>}
                </div>)}
                {draft.evidence.comparisons?.filter(reading => reading.comparison?.distance > 0).map((reading, index) => <div key={index}>
                  <p className="text-xs">{READING_LABELS[reading.kind] || 'Machine reading'}: {reading.comparison.distance} character differences, ignoring whitespace.</p>
                  <p dir="auto" className="text-sm break-words">{reading.comparison.differences?.slice(0, 30).map((difference, j) => <span key={j} className="inline-block border border-warning rounded px-1 mr-1 mb-1">{difference.original || '∅'} → {difference.alternative || '∅'}</span>)}</p>
                </div>)}
                {draft.evidence.comparisons?.filter(reading => reading.comparison?.complete === false).map((reading, index) => <p key={index} className="text-sm">{READING_LABELS[reading.kind] || 'Machine reading'}: {reading.comparison.note || 'This reading could not be fully compared.'}</p>)}
              </div>
            </details>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
              const report = { ...draft.evidence, editedText: draft.content, selectedReadingKind: draft.selectedReadingKind || 'primary', language: draft.language, script: draft.script, recordSaved: false };
              const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
              const link = document.createElement('a'); link.href = url; link.download = 'inscription-reading.json'; link.click(); URL.revokeObjectURL(url);
            }}>Download reading evidence</button>
          </div>}
          {draft.model && <p className="text-xs text-base-content/70">Model: {draft.model}</p>}
          {draft.notes?.length > 0 && <ul className="list-disc pl-5 text-sm text-base-content/70">{draft.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
          <label className="block">Original inscription text
            <textarea dir="auto" className="textarea textarea-bordered w-full min-h-40 mt-1" maxLength={10000} value={draft.content} onChange={event => setDraft(current => ({ ...current, content: event.target.value }))} />
          </label>
          {['language', 'script', 'translation'].map(key => <label key={key} className="block">{key === 'translation' ? 'Translation (English, optional)' : key === 'language' ? 'Language of inscription' : 'Script used'}
            <input className="input input-bordered w-full mt-1" maxLength={10000} value={draft[key]} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} />
          </label>)}
          <button type="button" className="btn btn-primary" disabled={full || !draft.content.trim() || !draft.language.trim() || !draft.script.trim()} onClick={() => { onAdd(draft); setDraft(null); setNotice('Transcription added to the form. Save the artifact to keep it.'); }}>Add transcription</button>
          <p className="text-sm">Adding fills an empty entry or appends a new inscription. Save the artifact to keep it.</p>
        </fieldset>}
      </div>
    </div>}
    {full && <p role="status">The form has reached its limit of 30 inscriptions. Remove an entry before adding another.</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="text-error">{error}</p>}
  </div>;
}

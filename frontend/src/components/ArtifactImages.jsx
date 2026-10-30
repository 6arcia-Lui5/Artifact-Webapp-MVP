import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ArtifactImage from './ArtifactImage';
import { addImage, applicationImageUrl, formatBytes, getImages, getPrivateImageBlob, getStorageStatus, imagePreviewUrl, ingestError, invalidateCatalog, removeImage, safeHttpUrl, updateImage, validateImageFile } from '../../lib/ingestApi';

function ManagedPhoto({ image, name }) {
  const [loaded, setLoaded] = useState(null);
  const [failure, setFailure] = useState(null);
  const url = imagePreviewUrl(image);
  const privateUrl = applicationImageUrl(url);
  useEffect(() => {
    if (!privateUrl) return;
    const controller = new AbortController();
    let objectUrl;
    getPrivateImageBlob(privateUrl, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setLoaded({ source: url, url: objectUrl });
    }).catch(error => { if (!controller.signal.aborted) setFailure({ source: url, error: ingestError(error) }); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url, privateUrl]);
  const src = privateUrl ? loaded?.source === url ? loaded.url : null : safeHttpUrl(url);
  const loading = privateUrl && !src && failure?.source !== url;
  if (!src || failure?.source === url) return <div className="bg-base-200 rounded-lg p-8 text-center" role={loading ? 'status' : 'img'} aria-label={`${name}: ${loading ? 'loading photograph' : 'image unavailable'}`}>
    {loading ? 'Loading photograph...' : 'Image unavailable.'}
    {failure?.source === url && <p className="text-sm mt-2">{failure.error}</p>}
  </div>;
  return <img src={src} alt={image.caption || name || 'Artifact view'} referrerPolicy="no-referrer" className="max-h-[32rem] w-full object-contain rounded-lg" onError={() => setFailure({ source: url, error: 'The image could not be displayed.' })} />;
}

function OriginalDownload({ image, name }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  const original = image.url || image.sourceUrl;
  const privateUrl = applicationImageUrl(original);
  const external = safeHttpUrl(original);
  async function download() {
    if (busy) return;
    setBusy(true); setError('');
    const controller = new AbortController(); request.current = controller;
    try {
      const blob = await getPrivateImageBlob(privateUrl, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[blob.type] || 'image';
      anchor.href = url;
      anchor.download = `${(name || 'artifact').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80)}-original.${extension}`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { if (!controller.signal.aborted) setError(ingestError(failure)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  if (!privateUrl && !external) return null;
  return <div className="space-y-2">
    {privateUrl ? <button className="btn btn-sm btn-outline" disabled={busy} onClick={download}>{busy ? 'Preparing original...' : 'Download original'}</button>
      : <a className="btn btn-sm btn-outline" href={external} download target="_blank" rel="noreferrer">Download original</a>}
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
  </div>;
}

export default function ArtifactImages({ record, isOwner }) {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState('link');
  const [source, setSource] = useState('');
  const [caption, setCaption] = useState('');
  const [credit, setCredit] = useState('');
  const [license, setLicense] = useState('');
  const [file, setFile] = useState(null);
  const [rights, setRights] = useState(false);
  const [fileVersion, setFileVersion] = useState(0);
  const [validation, setValidation] = useState('');
  const [removeId, setRemoveId] = useState(null);
  const images = useQuery({ queryKey: ['researchImages', record.id], queryFn: ({ signal }) => getImages(record.id, signal), retry: false });
  const storage = useQuery({ queryKey: ['researchStorage'], queryFn: ({ signal }) => getStorageStatus(signal), enabled: !!isOwner, retry: false });
  const entries = images.data?.items || [];
  const selected = entries.find(image => image.id === selectedId) || entries.find(image => image.isPrimary) || entries[0];
  const mutation = useMutation({
    retry: false,
    mutationFn: async action => {
      if (action.type === 'add') return addImage(record.id, action.body);
      if (action.type === 'primary') return updateImage(record.id, action.id, { isPrimary: true });
      return removeImage(record.id, action.id);
    },
    onSuccess: async (_data, action) => {
      if (action.type === 'add') { setSource(''); setCaption(''); setCredit(''); setLicense(''); setFile(null); setRights(false); setFileVersion(value => value + 1); }
      setRemoveId(null);
      await Promise.all([client.invalidateQueries({ queryKey: ['researchImages', record.id] }), client.invalidateQueries({ queryKey: ['researchStorage'] }), invalidateCatalog(client, record.id)]);
    },
  });
  function attach(event) {
    event.preventDefault(); setValidation(''); mutation.reset();
    let body;
    if (mode === 'upload') {
      const problem = validateImageFile(file);
      if (problem || !rights) { setValidation(problem || 'Confirm that you have permission to store this original image.'); return; }
      const max = Math.min(storage.data?.maxFileBytes ?? 4 * 1024 * 1024, 4 * 1024 * 1024);
      if (file.size > max) { setValidation(`This storage accepts images up to ${formatBytes(max)}.`); return; }
      body = new FormData(); body.append('photo', file); body.append('rightsConfirmed', 'true');
      body.append('caption', caption); body.append('credit', credit); body.append('license', license);
    } else {
      const sourceUrl = safeHttpUrl(source.trim());
      if (!sourceUrl) { setValidation('Enter an HTTP or HTTPS source link.'); return; }
      body = { sourceUrl, caption, credit, license };
    }
    mutation.mutate({ type: 'add', body });
  }
  const pending = mutation.isPending;
  return <section className="card bg-base-300"><div className="card-body space-y-4">
    <h2 className="card-title">Artifact photographs</h2>
    {images.isPending && <p role="status">Loading photographs...</p>}
    {images.error && <p role="alert" className="alert alert-error">{ingestError(images.error)} <button className="btn btn-sm" onClick={() => images.refetch()}>Retry loading photographs</button></p>}
    {selected ? <>
      <ManagedPhoto key={`preview:${selected.id}`} image={selected} name={record.itemName} />
      <div className="flex flex-wrap gap-2" aria-label="Photograph views">{entries.map((image, i) => <button key={image.id} className={`btn btn-sm ${selected.id === image.id ? 'btn-primary' : 'btn-outline'}`} aria-pressed={selected.id === image.id} onClick={() => { setSelectedId(image.id); setRemoveId(null); }}>{image.caption || `View ${i + 1}`}{image.isPrimary ? ' (primary)' : ''}</button>)}</div>
      <dl className="text-sm grid gap-2 sm:grid-cols-2"><div><dt className="font-semibold">Credit</dt><dd className="break-words">{selected.credit || 'Not supplied'}</dd></div><div><dt className="font-semibold">License</dt><dd className="break-words">{selected.license || 'Not supplied'}</dd></div><div><dt className="font-semibold">Storage</dt><dd>{selected.storageKind === 'external' ? 'Source link' : selected.storageKind === 'local' ? 'Local demonstration storage' : selected.storageKind === 'r2' ? 'Cloud storage' : 'Unknown'}{selected.byteSize != null ? `, ${formatBytes(selected.byteSize)}` : ''}</dd></div></dl>
      {safeHttpUrl(selected.sourceUrl) && <a className="link" href={safeHttpUrl(selected.sourceUrl)} target="_blank" rel="noreferrer">View photograph source</a>}
      <OriginalDownload key={`download:${selected.id}`} image={selected} name={record.itemName} />
      {isOwner && <div className="flex flex-wrap items-center gap-2">
        {!selected.isPrimary && <button className="btn btn-sm btn-outline" disabled={pending} onClick={() => mutation.mutate({ type: 'primary', id: selected.id })}>Use as primary photograph</button>}
        <button className="btn btn-sm btn-outline btn-error" disabled={pending} onClick={() => setRemoveId(selected.id)}>Remove photograph</button>
        {removeId === selected.id && <div role="group" aria-label="Confirm photograph removal" className="w-full space-y-2"><p>Remove this photograph from the record?</p><button className="btn btn-sm btn-error" disabled={pending} onClick={() => mutation.mutate({ type: 'remove', id: selected.id })}>Confirm removal</button><button className="btn btn-sm btn-ghost" disabled={pending} onClick={() => setRemoveId(null)}>Cancel</button></div>}
      </div>}
    </> : <><ArtifactImage source={safeHttpUrl(record.imageSourceUrl)} name={record.itemName} className="rounded-lg w-full max-h-96 object-contain" />{safeHttpUrl(record.imageSourceUrl) && <a className="link text-sm" href={safeHttpUrl(record.imageSourceUrl)} target="_blank" rel="noreferrer">View original image source</a>}<p className="text-sm">Image rights: {record.imageCopyrightDetails || 'Not supplied'}</p></>}
    {isOwner && <>
      <div className="border-t border-base-content/20 pt-4 space-y-2"><h3 className="font-semibold">Add a photograph</h3>
        {storage.isPending && <p role="status" className="text-sm">Checking image storage...</p>}
        {storage.error && <p role="alert" className="text-sm">Image uploads are unavailable until storage status can be checked. <button className="link" onClick={() => storage.refetch()}>Retry storage check</button></p>}
        {storage.data && <div className="text-sm space-y-1"><p>{storage.data.driver === 'local' ? 'Photographs are stored only on the demonstration computer. They are available while that computer and its server are running.' : storage.data.driver === 'r2' && storage.data.uploadEnabled ? 'Cloudflare R2 image storage is available. Uploaded originals and thumbnails count toward the configured storage limit.' : 'Image uploads are unavailable. You can still attach source links.'}</p><p>Storage used: {formatBytes(storage.data.usedBytes)} of {formatBytes(storage.data.maxBytes)}. Maximum original: {formatBytes(Math.min(storage.data.maxFileBytes ?? 4 * 1024 * 1024, 4 * 1024 * 1024))}.</p>{storage.data.note && <p>{storage.data.note}</p>}</div>}
      </div>
      <form onSubmit={attach} className="space-y-3">
        <label className="form-control space-y-1"><span>Add method</span><select className="select select-bordered w-full" value={mode} disabled={pending} onChange={event => setMode(event.target.value)}><option value="link">Attach source link</option><option value="upload">Upload original image</option></select></label>
        {mode === 'link' ? <label className="form-control space-y-1"><span>HTTP or HTTPS source link</span><input className="input input-bordered w-full" type="url" required value={source} disabled={pending} onChange={event => setSource(event.target.value)} /><span className="text-xs">Attaches the source link without copying the remote image.</span></label>
          : <><label className="form-control space-y-1"><span>Original PNG, JPEG, or WebP, up to 4 MiB</span><input key={fileVersion} type="file" accept="image/png,image/jpeg,image/webp" className="file-input file-input-bordered w-full" disabled={pending} onChange={event => setFile(event.target.files?.[0] || null)} /></label><p className="text-xs">Single-frame photographs only, up to 20 megapixels. The server checks the image and preserves the original file.</p><label className="flex items-start gap-2"><input className="checkbox checkbox-sm" type="checkbox" checked={rights} disabled={pending} onChange={event => setRights(event.target.checked)} />I have permission to upload and store this original photograph.</label></>}
        <label className="form-control space-y-1"><span>Caption or view description</span><input className="input input-bordered w-full" value={caption} disabled={pending} maxLength={2000} onChange={event => setCaption(event.target.value)} /></label>
        <div className="grid sm:grid-cols-2 gap-3"><label className="form-control space-y-1"><span>Credit</span><input className="input input-bordered w-full" value={credit} disabled={pending} maxLength={2000} onChange={event => setCredit(event.target.value)} /></label><label className="form-control space-y-1"><span>License</span><input className="input input-bordered w-full" value={license} disabled={pending} maxLength={2000} onChange={event => setLicense(event.target.value)} /></label></div>
        <button className="btn btn-primary" disabled={pending || (mode === 'upload' && !storage.data?.uploadEnabled)}>{pending ? 'Saving photograph...' : mode === 'upload' ? 'Upload photograph' : 'Attach source link'}</button>
      </form>
      {validation && <p role="alert" className="alert alert-error">{validation}</p>}
      {mutation.error && <p role="alert" className="alert alert-error">{ingestError(mutation.error)} Your input has been kept. Reload photographs to check the saved state before retrying. <button className="btn btn-sm" onClick={() => images.refetch()}>Reload photographs</button></p>}
      {mutation.isSuccess && <p role="status">Photographs updated.</p>}
    </>}
  </div></section>;
}

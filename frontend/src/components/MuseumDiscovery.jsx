import { useEffect, useRef, useState } from 'react';
import { ingestError, safeHttpUrl, searchMuseum } from '../../lib/ingestApi';
import ResearchImage from './ResearchImage';

export default function MuseumDiscovery({ onPreview, previewBusy }) {
  const [provider, setProvider] = useState('met');
  const [term, setTerm] = useState('');
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const controller = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  function reset() { setResult(null); setSelected(new Set()); setError(''); setMessage(''); }
  async function search(event) {
    event.preventDefault();
    reset(); setBusy(true);
    const request = new AbortController(); controller.current = request;
    try {
      const next = await searchMuseum(provider, term, request.signal);
      if (mounted.current && !request.signal.aborted) setResult(next);
    } catch (failure) {
      if (mounted.current) setError(request.signal.aborted ? 'Search cancelled. Try another search when ready.' : ingestError(failure));
    } finally {
      if (mounted.current) setBusy(false);
      controller.current = null;
    }
  }
  async function preview() {
    setError(''); setMessage('');
    try {
      await onPreview(result.provider, result.items.filter(item => selected.has(item.objectId)).map(item => item.objectId));
      if (mounted.current) setMessage('Preview ready below. Review the source facts before importing.');
    } catch (failure) { if (mounted.current) setError(ingestError(failure)); }
  }
  const disabled = busy || previewBusy;
  return <section className="card bg-base-300" aria-labelledby="museum-discovery-title"><div className="card-body space-y-4">
    <h2 id="museum-discovery-title" className="card-title">Find museum objects</h2>
    <form onSubmit={search} className="flex flex-wrap items-end gap-3">
      <label className="form-control space-y-1 flex-1 min-w-48"><span>Museum</span><select className="select select-bordered w-full" value={provider} disabled={disabled} onChange={event => { setProvider(event.target.value); reset(); }}>
        <option value="met">Metropolitan Museum of Art</option><option value="cleveland">Cleveland Museum of Art</option>
      </select></label>
      <label className="form-control space-y-1 flex-1 min-w-48"><span>Search terms</span><input className="input input-bordered w-full" value={term} maxLength={80} required disabled={disabled} placeholder="e.g. coin pendant" onChange={event => { setTerm(event.target.value); reset(); }} /></label>
      <button className="btn btn-primary" disabled={disabled || !term.trim()}>{busy ? 'Searching…' : 'Search museum'}</button>
      {busy && <button type="button" className="btn btn-outline" onClick={() => controller.current?.abort()}>Cancel search</button>}
    </form>
    <details><summary className="cursor-pointer">How this search works</summary><div className="mt-2 space-y-2 max-w-prose">
      <p>Searches the selected museum using word order, hyphen, and jewelry/jewellery variants. Results are a small sample, with no objects saved until you choose a preview.</p>
      <p>Supported roots: blunder*, erro*, forg*, garble*, imitate*, nonsens*, pseudo*, mistake*. Each uses a short, explicit word list; other roots are rejected. French, German, and Italian terms can be entered directly; automatic translation is not included.</p>
    </div></details>
    {busy && <p role="status">Searching the museum. This can take up to 18 seconds.</p>}
    {result && <>
      <p role="status">{result.items.length} objects found{result.partial ? ' in a limited or incomplete search' : ''}.</p>
      {result.warnings?.length > 0 && <div role="status" className="space-y-2">{result.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
      {result.items.length === 0 && <p>Try another term, a broader word, or the other museum.</p>}
      <ul className="divide-y divide-base-content/15">{result.items.map(item => <li key={item.key} className="py-4 flex items-start gap-4">
        <ResearchImage record={item} className="w-20 h-20 object-contain rounded-lg shrink-0 bg-base-100" />
        <div className="min-w-0 flex-1 space-y-2">
          <label className="flex items-start gap-3 font-semibold"><input type="checkbox" className="checkbox checkbox-sm mt-1 shrink-0" disabled={disabled} checked={selected.has(item.objectId)} onChange={event => setSelected(current => {
            const next = new Set(current); if (event.target.checked) next.add(item.objectId); else next.delete(item.objectId); return next;
          })} /><span className="break-words">{item.itemName}</span></label>
          {safeHttpUrl(item.sourceUrl) && <a className="link inline-block" href={safeHttpUrl(item.sourceUrl)} target="_blank" rel="noreferrer">View museum record</a>}
          <details><summary className="cursor-pointer">Details</summary><dl className="mt-2 space-y-1 break-words">
            <div><dt className="font-semibold inline">Museum: </dt><dd className="inline">{item.museumName}</dd></div>
            <div><dt className="font-semibold inline">Object ID: </dt><dd className="inline">{item.objectId}</dd></div>
            <div><dt className="font-semibold inline">Matched searches: </dt><dd className="inline">{item.matches.join(', ')}</dd></div>
            <div><dt className="font-semibold inline">Retrieved: </dt><dd className="inline">{new Date(item.retrievedAt).toLocaleString()}</dd></div>
          </dl></details>
        </div>
      </li>)}</ul>
      <details><summary className="cursor-pointer">Queries tried</summary><ul className="mt-2 space-y-1">{result.queries.map(query => <li key={query.query} className="break-words">{query.query}: {query.error || `${query.total} museum matches${query.limited ? ' (sampled)' : ''}`}</li>)}</ul></details>
      {result.items.length > 0 && <button type="button" className="btn btn-primary self-start" disabled={disabled || !selected.size} onClick={preview}>{previewBusy ? 'Preparing preview…' : `Preview selected (${selected.size})`}</button>}
    </>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </div></section>;
}

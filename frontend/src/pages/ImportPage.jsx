import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { recordFields } from '../components/recordFields';
import { commitImport, getImportJob, getImportJobs, getImportSources, importProgressIssue, ingestError, invalidateCatalog, parseObjectIds, previewImport, selectableRows, validateImportFile } from '../../lib/ingestApi';

const empty = [];
const fields = [...recordFields.filter(field => !field.key.startsWith('inscription')).map(field => ({ value: field.key, label: field.key === 'objectTypeId' ? 'Object type ID (UUID)' : field.label })),
  { value: 'dateStart', label: 'Start year (signed)' }, { value: 'dateEnd', label: 'End year (signed)' },
  { value: 'objectTypeName', label: 'Object type name' },
  { value: 'inscriptionContent', label: 'Inscription: literal original text' },
  { value: 'inscriptionLanguage', label: 'Inscription: language' },
  { value: 'inscriptionScript', label: 'Inscription: script' },
  { value: 'inscriptionTranslation', label: 'Inscription: translation (optional)' }];
const text = value => value === null || value === undefined || value === '' ? 'Unknown' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);

function ImportPreview({ job, reload }) {
  const client = useQueryClient();
  const [selected, setSelected] = useState(() => new Set(selectableRows(job.rows)));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const pause = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pause.current = true; };
  }, []);
  const allowed = selectableRows(job.rows);
  const chosen = allowed.filter(number => selected.has(number));
  const progress = result || job.progress;
  const started = !!result || (progress && (progress.importedCount ?? progress.imported ?? 0) + (progress.skippedCount ?? progress.skipped ?? 0) > 0) || job.status === 'partial';
  const finished = ['completed', 'completed_with_errors', 'complete', 'committed'].includes(result?.status || job.status) || (started && progress?.remaining === 0);
  async function commit() {
    if (!confirmed || !chosen.length || busy || uncertain) return;
    setBusy(true); setError(''); setMessage(''); pause.current = false;
    try {
      let previous = result || job.progress;
      // Bound each explicit start. Pausing never aborts an in-flight write.
      for (let batch = 0; batch < 40 && !pause.current && mounted.current; batch += 1) {
        const next = await commitImport(job.id, chosen);
        if (mounted.current) setResult(next);
        const issue = importProgressIssue(next, previous);
        if (issue) {
          if (mounted.current) {
            setError(issue);
            setUncertain(true);
          }
          break;
        }
        if (next.remaining === 0 || ['completed', 'complete', 'committed'].includes(next.status)) break;
        const savedJob = await getImportJob(job.id);
        client.setQueryData(['researchImport', String(job.id)], savedJob);
        if (!selectableRows(savedJob.rows).some(number => chosen.includes(number))) {
          if (mounted.current) setMessage('The selected records have been processed. Other unselected rows remain in the saved job.');
          break;
        }
        previous = next;
        if (mounted.current) setMessage(`Saved batch ${batch + 1}. Continuing with up to 25 more selected rows.`);
        if (batch === 39 && mounted.current) setMessage('Import paused after 40 batches. Review progress and resume to continue.');
      }
      if (pause.current && mounted.current) setMessage('Import paused after the current batch. Saved records are retained. Resume to continue.');
      if (mounted.current) {
        const refreshed = await reload();
        if (refreshed.error) throw refreshed.error;
      }
    } catch (failure) {
      if (mounted.current) {
        setError(`${ingestError(failure)} The request may have reached the server. Reload saved progress before another import request.`);
        setUncertain(true);
      }
    } finally {
      await Promise.all([invalidateCatalog(client), client.invalidateQueries({ queryKey: ['researchImports'] })]);
      if (mounted.current) { setBusy(false); setConfirmed(false); }
    }
  }
  async function reloadProgress() {
    setBusy(true);
    try {
      const next = await reload();
      if (next.error) throw next.error;
      setResult(null); setUncertain(false); setError(''); setConfirmed(false); setMessage('Saved progress reloaded. Review the eligible pending rows before starting or resuming.');
    } catch (failure) { setError(ingestError(failure)); setUncertain(true); }
    finally { setBusy(false); }
  }
  return <section className="card bg-base-300"><div className="card-body space-y-4">
    <h2 className="card-title">Saved import preview</h2>
    <p className="text-sm">Job {job.id}. Status: {text(result?.status || job.status)}. Previewing creates no artifacts.</p>
    <p className="text-sm">{job.summary?.total ?? job.rows?.length ?? 0} rows; {job.summary?.valid ?? 'Unknown'} valid; {job.summary?.invalid ?? 'Unknown'} invalid; {job.summary?.duplicates ?? 'Unknown'} duplicates.</p>
    {progress && <p role="status">Imported: {progress.importedCount ?? progress.imported ?? 0}. Skipped: {progress.skippedCount ?? progress.skipped ?? 0}. Errors: {progress.errorCount ?? progress.errors ?? 0}. Remaining: {progress.remaining ?? 'Unknown'}.</p>}
    <p className="text-sm text-base-content/70">Duplicates are always skipped. Existing records are never updated. Museum photographs remain source links; imports do not copy photographs or run transcription.</p>
    {job.columns?.length > 0 && <details><summary className="cursor-pointer text-sm">Saved column mapping</summary><dl className="grid sm:grid-cols-2 gap-2 text-sm mt-2">{job.columns.map(column => <div key={column}><dt className="font-semibold">{column}</dt><dd>{fields.find(field => field.value === job.mapping?.[column])?.label || job.mapping?.[column] || 'Ignored'}</dd></div>)}</dl><p className="text-sm mt-2">To change mappings, choose the original file and create a fresh preview.</p></details>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-sm btn-outline" disabled={busy || finished} onClick={() => { setSelected(new Set(allowed)); setConfirmed(false); }}>Select valid new rows</button>
      <button type="button" className="btn btn-sm btn-ghost" disabled={busy || finished} onClick={() => { setSelected(new Set()); setConfirmed(false); }}>Clear selection</button>
      <button type="button" className="btn btn-sm btn-outline" disabled={busy} onClick={reloadProgress}>Reload saved progress</button>
    </div>
    <div className="space-y-3 max-h-[36rem] overflow-auto">
      {(job.rows || empty).map(row => {
        const processed = !!row.state;
        const blocked = row.errors?.length > 0 || row.duplicate || !!row.duplicateRecordId || processed;
        return <details key={row.rowNumber} className="rounded-lg bg-base-100 p-3">
          <summary className="cursor-pointer break-words">Row {row.rowNumber}: {text(row.data?.itemName)}{processed ? ` (${row.state})` : blocked ? row.errors?.length ? ' (has errors)' : ' (duplicate)' : ''}</summary>
          <label className="flex items-center gap-2 py-3"><input type="checkbox" className="checkbox checkbox-sm" checked={selected.has(row.rowNumber) && !blocked} disabled={blocked || busy || finished} onChange={event => {
            setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(row.rowNumber); else next.delete(row.rowNumber); return next; }); setConfirmed(false);
          }} />Import row {row.rowNumber}</label>
          {row.duplicateRecordId && <p>Existing record: <Link className="link" to={`/record/${row.duplicateRecordId}`}>{row.duplicateRecordId}</Link></p>}
          {!!row.warnings?.length && <ul className="list-disc pl-5 text-sm">{row.warnings.map((warning, i) => <li key={i}>Warning: {text(warning)}</li>)}</ul>}
          {!!row.errors?.length && <ul className="list-disc pl-5 text-sm text-error">{row.errors.map((failure, i) => <li key={i}>Error: {text(failure)}</li>)}</ul>}
          <h3 className="font-semibold mt-3">Mapped source facts</h3>
          <dl className="grid sm:grid-cols-2 gap-3 text-sm mt-2">{Object.entries(row.data || {}).map(([key, value]) => <div key={key}><dt className="font-semibold">{fields.find(field => field.value === key)?.label || key}</dt><dd className="whitespace-pre-wrap break-words">{text(value)}</dd></div>)}</dl>
          {row.source && <details className="mt-3"><summary className="cursor-pointer">Original source facts</summary><pre className="text-xs whitespace-pre-wrap break-words mt-2">{text(row.source)}</pre></details>}
        </details>;
      })}
    </div>
    {!finished && allowed.length === 0 && <p role="status">No eligible pending rows remain. Duplicate rows are excluded. Correct invalid source rows in a fresh preview before importing them.</p>}
    {!finished && <>
      <p className="text-sm">{chosen.length} rows selected. Start processes them in batches of up to 25. Pause stops after the current batch. You can reopen this saved job and explicitly resume later.</p>
      <label className="flex items-start gap-2"><input type="checkbox" className="checkbox checkbox-sm" disabled={busy || uncertain || !chosen.length} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I confirm importing the selected new records.</label>
      <div className="flex flex-wrap gap-2"><button className="btn btn-primary" disabled={busy || uncertain || !confirmed || !chosen.length} onClick={commit}>{busy ? 'Importing selected records...' : started ? 'Resume import' : 'Start import'}</button>{busy && <button className="btn btn-outline" onClick={() => { pause.current = true; setMessage('Pause requested. Waiting for the current batch to finish.'); }}>Pause after current batch</button>}</div>
    </>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {finished && <p role="status">This job has finished. {(progress?.importedCount ?? progress?.imported ?? 0) > 0 ? 'Imported records are available in the catalog.' : 'No new records were imported.'}</p>}
    {error && <p role="alert" className="alert alert-error">{error}</p>}
  </div></section>;
}

export default function ImportPage() {
  const [params, setParams] = useSearchParams();
  const jobId = params.get('job');
  const client = useQueryClient();
  const [provider, setProvider] = useState('file');
  const [file, setFile] = useState(null);
  const [ids, setIds] = useState('');
  const [mapping, setMapping] = useState({});
  const [columns, setColumns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  const sources = useQuery({ queryKey: ['researchImportSources'], queryFn: ({ signal }) => getImportSources(signal), retry: false });
  const jobs = useQuery({ queryKey: ['researchImports'], queryFn: ({ signal }) => getImportJobs(signal), retry: false });
  const preview = useQuery({ queryKey: ['researchImport', jobId], queryFn: ({ signal }) => getImportJob(jobId, signal), enabled: !!jobId, retry: false });
  async function makePreview(event) {
    event.preventDefault(); setError('');
    let objectIds;
    try {
      if (provider === 'file') { const message = validateImportFile(file); if (message) throw new Error(message); }
      else objectIds = parseObjectIds(ids);
    } catch (failure) { setError(ingestError(failure)); return; }
    setBusy(true); controller.current = new AbortController();
    try {
      const next = await previewImport(provider === 'file' ? { file, mapping: Object.keys(mapping).length ? mapping : undefined } : { sourceProvider: provider, objectIds }, controller.current.signal);
      client.setQueryData(['researchImport', String(next.id)], next);
      setParams({ job: String(next.id) });
      setColumns(next.columns || []); setMapping(next.mapping || {});
      await client.invalidateQueries({ queryKey: ['researchImports'] });
    } catch (failure) { setError(controller.current.signal.aborted ? 'Preview cancelled. No artifacts were created.' : ingestError(failure)); }
    finally { setBusy(false); controller.current = null; }
  }
  return <div className="max-w-5xl mx-auto space-y-6">
    <div><h1 className="text-3xl font-bold">Import artifacts</h1><p className="mt-2 text-base-content/70">Preview source facts, resolve errors, and choose records before importing.</p></div>
    <form className="card bg-base-300" onSubmit={makePreview}><div className="card-body space-y-4">
      <h2 className="card-title">Choose a source</h2>
      <label className="form-control space-y-1"><span>Source</span><select className="select select-bordered w-full" value={provider} disabled={busy} onChange={event => { setProvider(event.target.value); setMapping({}); setColumns([]); }}>
        <option value="file">CSV or Excel file</option>
        {(sources.data?.items || [{ id: 'met', name: 'Metropolitan Museum of Art' }, { id: 'cleveland', name: 'Cleveland Museum of Art' }]).map(source => <option key={source.id} value={source.id}>{source.name}</option>)}
      </select></label>
      {provider === 'file' ? <label className="form-control space-y-1"><span>CSV or XLSX file, up to 4 MiB</span><input type="file" accept=".csv,.xlsx" className="file-input file-input-bordered w-full" disabled={busy} onChange={event => { setFile(event.target.files?.[0] || null); setColumns([]); setMapping({}); }} /></label>
        : <label className="form-control space-y-1"><span>Object IDs (up to 25)</span><textarea className="textarea textarea-bordered w-full" value={ids} disabled={busy} onChange={event => setIds(event.target.value)} placeholder="Separate numeric IDs with commas or spaces" /></label>}
      {provider === 'file' && columns.length > 0 && <fieldset className="space-y-3"><legend className="font-semibold">Column mapping</legend><p className="text-sm">Change mappings and create a fresh preview to check the result. Unmapped columns are ignored.</p><div className="grid sm:grid-cols-2 gap-3">{columns.map(column => <label key={column} className="form-control space-y-1"><span>{column}</span><select className="select select-bordered w-full" disabled={busy} value={mapping[column] || ''} onChange={event => setMapping(current => ({ ...current, [column]: event.target.value }))}><option value="">Ignore column</option>{fields.map(field => <option key={field.value} value={field.value}>{field.label}</option>)}</select></label>)}</div></fieldset>}
      <p className="text-sm text-base-content/70">Missing source facts remain unknown. Descriptions and translations are not treated as original inscription text.</p>
      {provider === 'file' && <p className="text-sm text-base-content/70">To import an inscription, map its literal original text, language, and script together. Translation is optional. Incomplete inscription fields produce row errors. Review the mapped inscription in the preview before importing.</p>}
      <div className="flex flex-wrap gap-2"><button className="btn btn-primary" disabled={busy}>{busy ? 'Preparing preview...' : 'Create preview'}</button>{busy && <button type="button" className="btn btn-outline" onClick={() => controller.current?.abort()}>Cancel preview</button>}</div>
      {error && <p role="alert" className="alert alert-error">{error}</p>}
    </div></form>
    {preview.isFetching && <p role="status">Loading saved preview...</p>}
    {preview.error && <p role="alert" className="alert alert-error">{ingestError(preview.error)} <button className="btn btn-sm" onClick={() => preview.refetch()}>Retry loading preview</button></p>}
    {preview.data && <ImportPreview key={preview.data.id} job={preview.data} reload={preview.refetch} />}
    <section className="card bg-base-300"><div className="card-body"><h2 className="card-title">Recent import jobs</h2>
      {jobs.isPending && <p role="status">Loading recent jobs...</p>}
      {jobs.error && <p role="alert">{ingestError(jobs.error)} <button className="btn btn-sm" onClick={() => jobs.refetch()}>Retry</button></p>}
      {jobs.data?.items?.length === 0 && <p>No saved jobs yet.</p>}
      <ul className="space-y-2">{jobs.data?.items?.map(job => <li key={job.id}><button className="link text-left" onClick={() => setParams({ job: String(job.id) })}>Open {job.sourceProvider || job.sourceType || 'file'} job {job.id}</button><span className="text-sm">: {job.status}; {job.importedCount ?? 0} imported, {job.skippedCount ?? 0} skipped, {job.errorCount ?? 0} errors{job.createdAt ? `; ${new Date(job.createdAt).toLocaleString()}` : ''}</span></li>)}</ul>
    </div></section>
  </div>;
}

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/react';
import { addDiscoveries, decideDiscovery, getDiscoveries } from '../../lib/discoveriesApi';
import { ingestError, parseObjectIds, previewImport, safeHttpUrl } from '../../lib/ingestApi';
import useUserSync from '../../hooks/useUserSync';

const museums = { met: 'The Metropolitan Museum of Art', cleveland: 'Cleveland Museum of Art' };
const labels = { pending: 'Not reviewed', kept: 'Kept', dismissed: 'Dismissed' };
const filters = [['active', 'Active'], ['pending', 'Not reviewed'], ['kept', 'Kept'], ['dismissed', 'Dismissed'], ['all', 'All']];

export default function DiscoveriesPage() {
  const { userId } = useAuth();
  const account = useUserSync();
  const [params, setParams] = useSearchParams();
  const rawStatus = params.get('status');
  const status = filters.some(([key]) => key === rawStatus) ? rawStatus : 'active';
  const rawPage = Number(params.get('page') || 1);
  const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 40 ? rawPage : 1;
  const [provider, setProvider] = useState('met');
  const [ids, setIds] = useState('');
  const [validation, setValidation] = useState('');
  const [message, setMessage] = useState('');
  const [last, setLast] = useState(null);
  const client = useQueryClient();
  const navigate = useNavigate();
  const list = useQuery({ queryKey: ['researchDiscoveries', userId, status, page], queryFn: ({ signal }) => getDiscoveries(status, page, signal), enabled: Boolean(userId), retry: false });
  const refresh = () => client.invalidateQueries({ queryKey: ['researchDiscoveries'] });
  const add = useMutation({ mutationFn: addDiscoveries, retry: false, onSuccess: async result => {
    setLast(null);
    setMessage(`${result.added} added. ${result.existing} already in your list.`);
    if (!result.errors.length) setIds('');
    await refresh();
  } });
  const decision = useMutation({ mutationFn: decideDiscovery, retry: false, onSuccess: async ({ item }) => {
    setLast(item);
    setMessage(`${item.title}: ${labels[item.decision].toLowerCase()}.`);
    await refresh();
  } });
  const preview = useMutation({ mutationFn: item => previewImport({ sourceProvider: item.sourceProvider, objectIds: [item.sourceObjectId] }), retry: false,
    onSuccess: job => navigate(`/import?job=${encodeURIComponent(job.id)}`) });
  const busy = decision.isPending || preview.isPending;
  function change(item, next, undo = false) {
    decision.mutate({ id: item.id, decision: next, undo, expectedRevision: item.revision });
  }
  function submit(event) {
    event.preventDefault(); setValidation(''); setMessage('');
    if (!account.isSuccess) return;
    try { add.mutate({ sourceProvider: provider, objectIds: parseObjectIds(ids) }); }
    catch (error) { setValidation(error.message); }
  }
  function filter(next, nextPage = 1) { setParams({ status: next, page: String(nextPage) }); }
  return <div className="max-w-5xl mx-auto space-y-6">
    <div><h1 className="text-3xl font-bold">Museum discoveries</h1><p className="mt-2 text-base-content/80">Keep useful objects, dismiss others, and undo your last decision.</p></div>
    {account.isError ? <p role="alert" className="text-error">{ingestError(account.error)} <button className="link" onClick={() => account.refetch()}>Reconnect account</button></p> : account.isPending ? <p role="status">Connecting your account…</p> : null}
    <details className="border-b border-base-content/20 pb-4">
      <summary className="cursor-pointer font-semibold py-2">Add museum objects</summary>
      <form onSubmit={submit} className="space-y-3 mt-3 max-w-xl">
        <p>Enter known museum IDs to start your research list.</p>
        <div className="form-control space-y-1"><label htmlFor="discovery-museum">Museum</label><select id="discovery-museum" className="select select-bordered w-full" disabled={add.isPending} value={provider} onChange={event => setProvider(event.target.value)}>{Object.entries(museums).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></div>
        <label className="form-control space-y-1"><span>Object IDs</span><textarea className="textarea textarea-bordered w-full" rows={2} required value={ids} disabled={add.isPending} onChange={event => setIds(event.target.value)} aria-describedby="discovery-ids-help" /></label>
        <p id="discovery-ids-help" className="text-sm text-base-content/80">Up to 25 numeric IDs, separated by commas or spaces. Adding again keeps your decisions.</p>
        <button className="btn btn-primary" disabled={add.isPending || !account.isSuccess}>{add.isPending ? 'Adding objects…' : 'Add to research list'}</button>
        {validation ? <p role="alert" className="text-error">{validation}</p> : null}
        {add.error ? <p role="alert" className="text-error">{ingestError(add.error)} <button type="button" className="link" onClick={() => list.refetch()}>Reload list</button></p> : null}
        {add.data?.errors.length ? <ul className="list-disc pl-5 text-sm">{add.data.errors.map(error => <li key={error.objectId}>Object {error.objectId}: {error.message}</li>)}</ul> : null}
      </form>
    </details>
    <div className="flex flex-wrap gap-3 items-end justify-between">
      <div className="form-control space-y-1"><label htmlFor="discovery-status">Show objects</label><select id="discovery-status" className="select select-bordered" value={status} onChange={event => filter(event.target.value)}>{filters.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      <button className="btn btn-sm btn-outline" disabled={list.isFetching || busy} onClick={() => { decision.reset(); preview.reset(); setLast(null); setMessage(''); list.refetch(); }}>Refresh list</button>
    </div>
    {message ? <div role="status" className="flex flex-wrap items-center gap-3"><p>{message}</p>{last?.previousDecision ? <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => change(last, null, true)}>Undo last decision</button> : null}</div> : null}
    {decision.error || preview.error ? <p role="alert" className="text-error">{ingestError(decision.error || preview.error)} Use Refresh list to load saved decisions.</p> : null}
    {list.isPending ? <p role="status">Loading discoveries…</p> : list.error ? <p role="alert" className="text-error">{ingestError(list.error)}</p> : <>
      <p className="text-sm text-base-content/80">{list.data.total} {status === 'all' ? 'saved' : filters.find(([key]) => key === status)[1].toLowerCase()} objects · {list.data.counts.total} of {list.data.limit.toLocaleString()} saved</p>
      {list.data.items.length ? <ul className="divide-y divide-base-content/20">{list.data.items.map(item => <li key={item.id} className="py-5 space-y-3">
        <div className="flex flex-wrap justify-between gap-2"><h2 className="text-xl font-semibold break-words min-w-0">{item.title}</h2><span className="badge badge-outline shrink-0">{labels[item.decision]}</span></div>
        <p>{museums[item.sourceProvider]} · {item.museumNumber || item.sourceObjectId}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary btn-sm" disabled={busy || item.decision === 'kept'} onClick={() => change(item, 'kept')}>Keep</button>
          <button className="btn btn-outline btn-sm" disabled={busy || item.decision === 'dismissed'} onClick={() => change(item, 'dismissed')}>Dismiss</button>
          {item.previousDecision ? <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => change(item, null, true)}>Undo last decision</button> : null}
          {safeHttpUrl(item.sourceUrl) ? <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="link text-sm">View museum record</a> : null}
        </div>
        <details><summary className="cursor-pointer text-sm">Source details{item.decision === 'kept' ? ' and import' : ''}</summary>
          <dl className="grid sm:grid-cols-2 gap-3 mt-3 text-sm">{[['Object type', item.objectType], ['Date', item.dateLabel], ['Material', item.material], ['Reuse terms', item.license], ['Source retrieved', new Date(item.retrievedAt).toLocaleString()]].map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd className="break-words">{value || 'Not supplied'}</dd></div>)}</dl>
          {item.decision === 'kept' ? <div className="mt-3 space-y-2"><button className="btn btn-sm btn-outline" disabled={busy} onClick={() => preview.mutate(item)}>Preview catalog import</button><p className="text-sm">Review fresh source facts before importing. Undo changes your research decision; catalog records stay saved.</p></div> : null}
        </details>
      </li>)}</ul> : <p>{list.data.total ? 'No objects on this page. Return to the previous page.' : status === 'dismissed' ? 'No dismissed objects.' : 'No objects here yet. Add museum objects above or choose another list.'}</p>}
      {list.data.totalPages > 1 || page > 1 ? <div className="flex flex-wrap items-center gap-3"><button className="btn btn-sm btn-outline" disabled={page <= 1 || list.isFetching} onClick={() => filter(status, page - 1)}>Previous</button><span>Page {page}{page <= list.data.totalPages ? ` of ${list.data.totalPages}` : ' · no objects'}</span><button className="btn btn-sm btn-outline" disabled={page >= list.data.totalPages || list.isFetching} onClick={() => filter(status, page + 1)}>Next</button></div> : null}
    </>}
  </div>;
}

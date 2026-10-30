import { useState } from "react";
import { useAuth } from "@clerk/react";
import { Link } from "react-router";
import { useCollectionMutation, useResearchCollections } from "../../../hooks/useResearchCatalog";
import { downloadResearchRecords, researchError } from "../../../lib/researchApi";
import { QueryError, CatalogPagination, CatalogSort } from "./CatalogFeedback";
import RecordMetadata from "./RecordMetadata";

function SelectionActions({ ids, params, onDone }) {
  const { userId } = useAuth();
  const collections = useResearchCollections();
  const add = useCollectionMutation("add");
  const [collectionId, setCollectionId] = useState("");
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const ownCollections = (collections.data?.items || []).filter(collection => !!userId && collection.userId === userId);
  async function download(format, selected) {
    setError(""); setExporting(true);
    try { await downloadResearchRecords(params, format, selected ? ids : []); }
    catch (failure) { setError(researchError(failure)); }
    finally { setExporting(false); }
  }
  async function attach() {
    setMessage(""); setError("");
    try {
      const result = await add.mutateAsync({ id: collectionId, recordIds: ids });
      setMessage(`${result.added} records added to the collection.`);
      onDone();
    } catch (failure) { setError(researchError(failure)); }
  }
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm">{ids.length} selected on this page</span>
      <button className="btn btn-sm btn-outline" disabled={!ids.length || exporting} onClick={() => download("csv", true)}>Selected CSV</button>
      <button className="btn btn-sm btn-outline" disabled={!ids.length || exporting} onClick={() => download("json", true)}>Selected JSON</button>
      <button className="btn btn-sm btn-ghost" disabled={exporting} onClick={() => download("csv", false)}>Export results CSV</button>
      <button className="btn btn-sm btn-ghost" disabled={exporting} onClick={() => download("json", false)}>Export results JSON</button>
    </div>
    <p className="text-xs text-base-content/60">Exports use the current filters and the server export limit. Selection resets when you change page or filters.</p>
    {ownCollections.length ? <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Your collection" className="select select-bordered select-sm max-w-full" value={collectionId} onChange={event => setCollectionId(event.target.value)}><option value="">Choose your collection</option>{ownCollections.map(collection => <option key={collection.id} value={collection.id}>{collection.title}</option>)}</select>
      <button className="btn btn-sm btn-primary" disabled={!ids.length || !collectionId || add.isPending} onClick={attach}>{add.isPending ? "Adding…" : "Add selected to collection"}</button>
    </div> : collections.isPending ? <p className="text-xs">Loading your collections…</p> : !collections.isError ? <Link to="/collections" className="link text-sm">Create a collection to organize selected records</Link> : null}
    {collections.isError ? <QueryError error={collections.error} retry={() => collections.refetch()} /> : null}
    {message ? <p role="status" className="text-sm">{message}</p> : null}
    {error ? <p role="alert" className="text-error">{error}</p> : null}
  </div>;
}

export default function CatalogResults({ query, params, update, collection, isOwner = false }) {
  const [selected, setSelected] = useState([]);
  const remove = useCollectionMutation("remove");
  const [actionError, setActionError] = useState("");
  const items = query.data?.items || [];
  async function detach(record) {
    if (!window.confirm(`Remove “${record.itemName}” from this collection? The artifact record will be preserved.`)) return;
    setActionError("");
    try { await remove.mutateAsync({ id: collection.id, recordId: record.id }); setSelected(previous => previous.filter(id => id !== record.id)); }
    catch (error) { setActionError(researchError(error)); }
  }
  if (query.isPending) return <div role="status" className="flex gap-2 items-center py-6"><span className="loading loading-spinner loading-md" />Loading records…</div>;
  if (query.isError) return <QueryError error={query.error} retry={() => query.refetch()} />;
  return <div className="space-y-4">
    <div className="flex flex-wrap justify-between items-center gap-3"><h2 className="text-xl font-semibold">Results <span className="text-base-content/60">({query.data.total})</span></h2><CatalogSort params={params} update={update} /></div>
    {items.length ? <>
      <SelectionActions ids={selected} params={params} onDone={() => setSelected([])} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="checkbox checkbox-sm" checked={items.every(record => selected.includes(record.id))} onChange={event => setSelected(event.target.checked ? items.map(record => record.id) : [])} />Select all records on this page</label>
      <div className="flex flex-col gap-3">{items.map(record => <div key={record.id} className="card bg-base-200 shadow-sm"><div className="card-body p-4">
        <div className="flex items-start gap-3"><input type="checkbox" className="checkbox checkbox-sm mt-1" aria-label={`Select ${record.itemName}`} checked={selected.includes(record.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, record.id] : previous.filter(id => id !== record.id))} /><div className="flex-1 min-w-0">
          <h3 className="card-title text-base"><Link className="link-hover" to={`/record/${record.id}`}>{record.itemName}</Link></h3>
          {record.objectType?.name ? <span className="badge badge-outline badge-sm mt-1">{record.objectType.name}</span> : null}
          {record.museumDescription ? <p className="text-sm text-base-content/60 line-clamp-2 my-2">{record.museumDescription}</p> : null}
          <RecordMetadata record={record} />
          <div className="card-actions justify-end mt-2"><Link to={`/record/${record.id}`} className="btn btn-ghost btn-xs">View</Link>{isOwner ? <button className="btn btn-ghost btn-xs text-error" disabled={remove.isPending} onClick={() => detach(record)}>Remove from collection</button> : null}</div>
        </div></div>
      </div></div>)}</div>
    </> : <div className="card bg-base-200"><div className="card-body"><p>{collection ? "This collection has no records matching these filters. Search the catalog to add records to your collections." : "No records match these filters. Try a broader query or clear the filters."}</p>{collection && isOwner ? <Link to="/search" className="link">Find records to add</Link> : null}</div></div>}
    {actionError ? <p role="alert" className="text-error">{actionError}</p> : null}
    <CatalogPagination data={query.data} params={params} update={update} />
  </div>;
}

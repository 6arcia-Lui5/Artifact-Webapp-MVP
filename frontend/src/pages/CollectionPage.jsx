import { useState } from "react";
import { useAuth } from "@clerk/react";
import { Link } from "react-router";
import { useResearchCollections, useCollectionMutation } from "../../hooks/useResearchCatalog";
import { QueryError } from "../components/research/CatalogFeedback";
import CollectionForm from "../components/research/CollectionForm";
import useUserSync from "../../hooks/useUserSync";

export default function CollectionPage() {
  const { isSignedIn } = useAuth();
  const collections = useResearchCollections();
  const account = useUserSync();
  const create = useCollectionMutation("create");
  const [editing, setEditing] = useState(false);
  async function save(values) {
    try { await create.mutateAsync(values); setEditing(false); } catch { /* Form displays mutation error. */ }
  }
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-3xl font-bold">Collections</h1><p className="text-base-content/60 mt-1">Organize readable artifacts into research collections.</p></div>{isSignedIn && !editing ? <button className="btn btn-primary btn-sm" disabled={!account.isSuccess} onClick={() => { create.reset(); setEditing(true); }}>New collection</button> : null}</div>
    {account.isError ? <QueryError error={account.error} retry={() => account.refetch()} /> : account.isPending ? <p role="status">Connecting your account…</p> : null}
    {editing ? <CollectionForm mutation={create} onSave={save} onCancel={() => setEditing(false)} /> : null}
    {collections.isPending ? <p role="status">Loading collections…</p> : collections.isError ? <QueryError error={collections.error} retry={() => collections.refetch()} /> : collections.data.items.length ? <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{collections.data.items.map(collection => <Link to={`/collections/${collection.id}`} key={collection.id} className="card bg-base-200 hover:bg-base-300 shadow-sm"><div className="card-body"><h2 className="card-title">{collection.title}</h2>{collection.description ? <p className="text-sm line-clamp-3">{collection.description}</p> : null}{collection.timePeriod ? <p className="text-xs text-base-content/60">{collection.timePeriod}</p> : null}<p className="text-sm text-base-content/60">{collection.recordCount} records</p></div></Link>)}</div> : <div className="card bg-base-200"><div className="card-body"><p>No collections yet. Create one and add records from Search Records.</p></div></div>}
  </div>;
}

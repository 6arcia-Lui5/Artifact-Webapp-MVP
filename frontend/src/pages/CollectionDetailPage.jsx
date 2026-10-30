import { useState } from "react";
import { useAuth } from "@clerk/react";
import { Link, useNavigate, useParams } from "react-router";
import { useResearchCollection, useCollectionMutation, useCatalogLocation, useResearchRecords } from "../../hooks/useResearchCatalog";
import { QueryError } from "../components/research/CatalogFeedback";
import CatalogFilters from "../components/research/CatalogFilters";
import CatalogResults from "../components/research/CatalogResults";
import CollectionForm from "../components/research/CollectionForm";

export default function CollectionDetailPage() {
  const { id } = useParams();
  const { userId } = useAuth();
  const navigate = useNavigate();
  const collection = useResearchCollection(id);
  const location = useCatalogLocation({ collectionId: id });
  const records = useResearchRecords(location.params, collection.isSuccess);
  const update = useCollectionMutation("update");
  const remove = useCollectionMutation("delete");
  const [editing, setEditing] = useState(false);
  const isOwner = !!userId && collection.data?.userId === userId;
  async function save(values) {
    try { await update.mutateAsync({ id, values }); setEditing(false); } catch { /* Form displays mutation error. */ }
  }
  async function deleteCollection() {
    if (!window.confirm(`Delete collection “${collection.data.title}”? Its artifact records will be preserved.`)) return;
    try { await remove.mutateAsync(id); navigate("/collections"); } catch { /* Display mutation error below. */ }
  }
  if (collection.isPending) return <p role="status">Loading collection…</p>;
  if (collection.isError) return <div className="space-y-4"><Link to="/collections" className="link">Back to collections</Link><QueryError error={collection.error} retry={() => collection.refetch()} /></div>;
  return <div className="space-y-6">
    <Link to="/collections" className="link text-sm">Back to collections</Link>
    <div><h1 className="text-3xl font-bold">{collection.data.title}</h1>{collection.data.description ? <p className="mt-2 whitespace-pre-wrap">{collection.data.description}</p> : null}{collection.data.timePeriod ? <p className="text-sm text-base-content/60 mt-1">{collection.data.timePeriod}</p> : null}<p className="text-sm mt-2">{collection.data.recordCount} records in this collection</p></div>
    {isOwner ? <div className="flex flex-wrap gap-2"><button className="btn btn-sm" onClick={() => { update.reset(); setEditing(true); }}>Edit collection</button><Link to="/search" className="btn btn-sm btn-primary">Find records to add</Link><button className="btn btn-sm btn-outline btn-error" disabled={remove.isPending} onClick={deleteCollection}>Delete collection</button></div> : null}
    {remove.isError ? <QueryError error={remove.error} /> : null}
    {editing && isOwner ? <CollectionForm key={id} initial={collection.data} mutation={update} onSave={save} onCancel={() => setEditing(false)} /> : null}
    <CatalogFilters key={`${id}-${location.searchKey}`} params={location.params} onSubmit={location.update} onClear={location.clear} />
    {location.dateError ? <p role="alert" className="alert alert-error">{location.dateError} Correct the dates above or clear filters.</p> : <CatalogResults key={`${id}-${location.searchKey}`} query={records} params={location.params} update={location.update} collection={collection.data} isOwner={isOwner} />}
  </div>;
}

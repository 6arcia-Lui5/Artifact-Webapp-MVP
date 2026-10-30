import { researchError } from "../../../lib/researchApi";

export function QueryError({ error, retry }) {
  return <div role="alert" className="alert alert-error flex flex-wrap"><span>{researchError(error)}</span>{retry ? <button className="btn btn-sm" onClick={retry}>Retry</button> : null}</div>;
}

export function CatalogPagination({ data, params, update }) {
  if (!data) return null;
  const pages = data.totalPages || 1;
  return <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
    <p className="text-sm" aria-live="polite">{data.total} {data.total === 1 ? "record" : "records"} · Page {data.page} of {pages}</p>
    <div className="join">
      <button className="btn btn-sm join-item" disabled={data.page <= 1} onClick={() => update({ page: data.page - 1 })}>Previous</button>
      <button className="btn btn-sm join-item" disabled={data.page >= pages} onClick={() => update({ page: data.page + 1 })}>Next</button>
    </div>
    <label className="flex items-center gap-2 text-sm">Per page <select aria-label="Records per page" className="select select-bordered select-sm" value={params.pageSize} onChange={event => update({ pageSize: event.target.value })}>
      {[...new Set([12, 24, 48, 100, params.pageSize])].sort((a, b) => a - b).map(size => <option key={size} value={size}>{size}</option>)}
    </select></label>
  </div>;
}

export function CatalogSort({ params, update }) {
  return <label className="flex items-center gap-2 text-sm">Sort <select aria-label="Sort records" value={params.sort} onChange={event => update({ sort: event.target.value })} className="select select-bordered select-sm"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="title">Title</option><option value="updated">Recently updated</option></select></label>;
}

import { useState } from "react";
import { Link } from "react-router";
import { useResearchFacets } from "../../../hooks/useResearchCatalog";
import { useMuseumTerms } from "../../../hooks/useMuseumTerms";
import { findTermFamily, uniqueTerms } from "../../../lib/museumTerms";
import { researchError } from "../../../lib/researchApi";
import { FILTER_FIELDS, validateDateRange } from "./catalogParams";
import TermSources from "./TermSources";

const fields = [["museum", "Museum", "museums"], ["material", "Material", "materials"], ["language", "Language", "languages"], ["script", "Script", "scripts"], ["place", "Place", "places"], ["sourceProvider", "Source", "sourceProviders"]];

export default function CatalogFilters({ params, onSubmit, onClear }) {
  const facets = useResearchFacets();
  const glossary = useMuseumTerms();
  const [search, setSearch] = useState(params.q || "");
  const [expand, setExpand] = useState(params.expandTerms === "1");
  const family = expand ? findTermFamily(glossary.data, search) : undefined;
  const [error, setError] = useState("");
  function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(FILTER_FIELDS.map(field => [field, String(form.get(field) || "").trim()]));
    const dateError = validateDateRange(values);
    setError(dateError);
    if (!dateError) onSubmit(values);
  }
  return <form onSubmit={submit} className="card bg-base-200 shadow-sm">
    <div className="card-body gap-4">
      <label className="form-control w-full">
        <span className="label-text mb-2">Search metadata, inscriptions, and translations</span>
        <input name="q" aria-label="Search records" placeholder="Search records..." maxLength={300} value={search} onChange={event => setSearch(event.target.value)} className="input input-bordered w-full" />
      </label>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <label className="flex items-center gap-2"><input name="expandTerms" value="1" type="checkbox" className="checkbox checkbox-sm" checked={expand} onChange={event => setExpand(event.target.checked)} />Include museum terms in other languages</label>
          <Link className="link" to="/terms">Browse terms</Link>
        </div>
        {family ? <div className="space-y-2"><p role="status" className="text-sm">{family.label} terms: {uniqueTerms(family).join(" · ")}</p><TermSources family={family} /></div> : expand && search.trim() && glossary.isSuccess ? <p role="status" className="text-sm text-base-content/70">No listed term matches. Searching your words only.</p> : null}
        {expand && glossary.isError ? <p role="status" className="text-sm">Term list unavailable. <button type="button" className="link" onClick={() => glossary.refetch()}>Retry term list</button></p> : null}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {fields.map(([field, label, facet]) => <label key={field} className="form-control">
          <span className="label-text mb-1">{label}</span>
          <input name={field} maxLength={500} defaultValue={params[field] || ""} list={`facet-${field}`} className="input input-bordered w-full" />
          <datalist id={`facet-${field}`}>{(facets.data?.[facet] || []).map(value => <option key={value} value={value} />)}</datalist>
        </label>)}
        <label className="form-control"><span className="label-text mb-1">Object type</span>
          <select name="objectTypeId" defaultValue={params.objectTypeId || ""} className="select select-bordered w-full">
            <option value="">All object types</option>
            {params.objectTypeId && !facets.data?.objectTypes?.some(type => type.id === params.objectTypeId) ? <option value={params.objectTypeId}>{params.objectTypeId}</option> : null}
            {(facets.data?.objectTypes || []).map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
          </select>
        </label>
        <label className="form-control"><span className="label-text mb-1">Review status</span>
          <select name="reviewStatus" defaultValue={params.reviewStatus || ""} className="select select-bordered w-full"><option value="">All review statuses</option><option value="draft">Draft</option><option value="reviewed">Reviewed</option><option value="uncertain">Uncertain</option></select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="form-control"><span className="label-text mb-1">Start year</span><input name="dateFrom" type="text" inputMode="text" placeholder="-500" defaultValue={params.dateFrom || ""} className="input input-bordered w-full" /></label>
          <label className="form-control"><span className="label-text mb-1">End year</span><input name="dateTo" type="text" inputMode="text" placeholder="200" defaultValue={params.dateTo || ""} className="input input-bordered w-full" /></label>
        </div>
      </div>
      <p className="text-xs text-base-content/60">Use negative years for BCE (for example, -500) and positive years for CE. Records without dates are excluded when a year filter is set.</p>
      {error ? <p className="text-error" role="alert">{error}</p> : null}
      {facets.isError ? <div className="text-sm" role="status">Filter suggestions unavailable: {researchError(facets.error)} <button type="button" className="btn btn-ghost btn-xs" onClick={() => facets.refetch()}>Retry suggestions</button></div> : null}
      <div className="card-actions"><button type="submit" className="btn btn-primary">Search</button><button type="button" className="btn btn-ghost" onClick={event => { event.currentTarget.form.reset(); setSearch(""); setExpand(false); setError(""); onClear(); }}>Clear filters</button></div>
    </div>
  </form>;
}

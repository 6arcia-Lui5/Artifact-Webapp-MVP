import { useCatalogLocation, useResearchRecords } from "../../hooks/useResearchCatalog";
import CatalogFilters from "../components/research/CatalogFilters";
import CatalogResults from "../components/research/CatalogResults";

export default function SearchPage() {
  const location = useCatalogLocation();
  const records = useResearchRecords(location.params);
  return <div className="flex flex-col gap-6">
    <div><h1 className="text-3xl font-bold">Search Records</h1><p className="text-base-content/70 mt-1">Discover records by metadata, inscription, or translation.</p></div>
    <CatalogFilters key={location.searchKey} params={location.params} onSubmit={location.update} onClear={location.clear} />
    {location.dateError ? <p role="alert" className="alert alert-error">{location.dateError} Correct the dates above or clear filters.</p> : <CatalogResults key={location.searchKey} query={records} params={location.params} update={location.update} />}
  </div>;
}

import { useMutation } from "@tanstack/react-query";
import { checkRecordMl } from "../../lib/api";

const year = value => value < 0 ? `${Math.abs(value)} BCE` : value > 0 ? `${value} CE` : "BCE/CE boundary";

export default function MlReview({ record }) {
  const check = useMutation({ mutationFn: () => checkRecordMl(record.id) });
  const hasText = record.inscriptions?.some(entry => entry.content?.trim());
  const result = check.data;
  return <section className="card border border-base-300"><div className="card-body space-y-3">
    <h2 className="text-xl font-semibold">Inscription metadata review</h2>
    <p className="text-sm text-base-content/70">Compare the original inscription text with the catalog date and place. These model suggestions need scholarly review; running a check does not change the artifact.</p>
    <dl className="grid gap-3 sm:grid-cols-2 text-sm">
      <div><dt className="font-semibold">Catalog date</dt><dd>{record.dateCulturePeriod || "Not recorded"}</dd></div>
      <div><dt className="font-semibold">Catalog place</dt><dd>{record.productionPlace || record.findspot || "Not recorded"}{!record.productionPlace && record.findspot ? " (findspot)" : ""}</dd></div>
    </dl>
    {!hasText ? <p className="text-sm text-base-content/70">Add original inscription text through the artifact editor before running a check.</p>
      : <div><button className="btn btn-outline" disabled={check.isPending} onClick={() => check.mutate()}>{check.isPending ? "Checking inscription..." : "Run ML check"}</button></div>}
    {check.error && <p role="alert" className="alert alert-error">{check.error.response?.data?.error || "The model service could not be reached."} Your artifact is unchanged. Try again when the service is available.</p>}
    {result && <div role="status" className="space-y-4 border-t border-base-300 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{result.flagged ? "Metadata needs review" : "No review flags for the checked metadata"}</h3>
        <span className="text-xs text-base-content/70">Model: {result.model}</span>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div><dt className="text-sm font-semibold">Suggested date interval</dt><dd>{year(result.date.low)} to {year(result.date.high)}</dd><dd className="text-sm text-base-content/70">Point estimate: {year(result.date.year)}</dd></div>
        <div><dt className="text-sm font-semibold">Suggested region</dt><dd>{result.region}</dd></div>
      </dl>
      {result.dateNote && <p className="text-sm text-base-content/70">{result.dateNote}</p>}
      {result.region_note && <p className="text-sm text-base-content/70">{result.region_note}</p>}
      {!result.listedRegion && <p className="text-sm text-base-content/70">No catalog place was available, so region metadata was not checked.</p>}
      {result.flags?.map((flag, index) => <div key={`${flag.field}-${index}`} className="rounded-xl bg-base-200 p-4 space-y-1">
        <h4 className="font-semibold">{flag.field === "date" ? "Date discrepancy" : "Region discrepancy"}</h4>
        <p>{flag.message}</p>
        <p className="text-sm">Listed: {flag.listed}. Suggested: {flag.predicted}.</p>
      </div>)}
      <p className="text-xs text-base-content/70">The model covers supported ancient-world regions and dates between 800 BCE and 1000 CE. A flag is a review hint, not proof that the catalog is wrong.</p>
    </div>}
  </div></section>;
}

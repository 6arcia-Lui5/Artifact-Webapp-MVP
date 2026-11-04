import { useMutation } from "@tanstack/react-query";
import { checkRecordMl } from "../../lib/api";
import { analysisStatus, comparisonLabel } from "../../lib/analysisStatus";

const year = value => value < 0 ? `${Math.abs(value)} BCE` : value > 0 ? `${value} CE` : "BCE/CE boundary";

export default function MlReview({ record }) {
  const check = useMutation({ mutationFn: () => checkRecordMl(record.id) });
  const hasText = record.inscriptions?.some(entry => entry.content?.trim());
  const result = check.data;
  return <section className="card border border-base-300"><div className="card-body space-y-4">
    <h2 className="text-xl font-semibold">Date and place suggestions</h2>
    {result && <div role="status" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{analysisStatus(result)}</h3><span className="badge badge-outline">AI estimate</span></div>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div><dt className="font-semibold">Suggested date</dt><dd className="text-lg">{year(result.date.low)} to {year(result.date.high)}</dd><dd className="text-sm text-base-content/80 mt-1">{comparisonLabel(result.comparison?.date)}</dd></div>
        <div><dt className="font-semibold">Suggested region</dt><dd className="text-lg">{result.region}</dd><dd className="text-sm text-base-content/80 mt-1">{comparisonLabel(result.comparison?.region)}</dd></div>
      </dl>
      {result.flags?.map((flag, index) => <div key={`${flag.field}-${index}`} className="bg-base-200 p-4 space-y-1 rounded-lg"><h4 className="font-semibold">{flag.field === "date" ? "Date difference" : "Region difference"}</h4><p>{flag.message}</p><p>Catalog: {flag.listed}. Suggested: {flag.predicted}.</p></div>)}
    </div>}
    {!hasText ? <p>Add original inscription text to check its date and place.</p> : <div><button className="btn btn-outline" disabled={check.isPending} onClick={() => check.mutate()}>{check.isPending ? "Checking inscription..." : "Check inscription"}</button></div>}
    {check.error && <div role="alert" className="alert alert-error flex flex-wrap"><span>{check.error.response?.data?.error || "Couldn’t check the inscription."}</span><button className="btn btn-sm" disabled={check.isPending} onClick={() => check.mutate()}>Retry check</button></div>}
    <details><summary className="cursor-pointer font-medium">Analysis details</summary><div className="space-y-3 mt-3">
      <dl className="grid gap-3 sm:grid-cols-2"><div><dt className="font-semibold">Catalog date</dt><dd>{record.dateCulturePeriod || "Not recorded"}</dd></div><div><dt className="font-semibold">Catalog place</dt><dd>{record.productionPlace || record.findspot || "Not recorded"}</dd></div></dl>
      <p>Suggestions use saved inscription text and require researcher review. They do not change the record.</p>
      <p>The neural model reads up to 256 cleaned characters. Supported dates are 800 BCE–1000 CE.</p>
      {result && <><p>Model: {result.model}. Point estimate: {year(result.date.year)}.</p>{result.dateNote && <p>{result.dateNote}</p>}{result.region_note && <p>{result.region_note}</p>}</>}
    </div></details>
  </div></section>;
}

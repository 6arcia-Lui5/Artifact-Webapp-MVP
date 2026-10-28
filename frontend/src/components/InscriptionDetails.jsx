export default function InscriptionDetails({ entries = [] }) {
  return <section className="card border border-base-300"><div className="card-body">
    <h2 className="text-xl font-semibold">Inscriptions</h2>
    {entries.length === 0 ? <p className="text-base-content/70">No original inscription text has been recorded.</p>
      : entries.map((entry, index) => <section key={entry.id} className="border-t border-base-300 pt-4 mt-2 space-y-3 min-w-0">
        <h3 className="font-semibold">Inscription {index + 1}</h3>
        <p className="whitespace-pre-wrap break-words text-lg" dir="auto">{entry.content}</p>
        <dl className="grid gap-3 sm:grid-cols-2 text-sm">
          <div><dt className="font-semibold">Language</dt><dd>{entry.language || "Not recorded"}</dd></div>
          <div><dt className="font-semibold">Script</dt><dd>{entry.script || "Not recorded"}</dd></div>
          <div><dt className="font-semibold">Serifs present</dt><dd>{entry.serifsPresent ? "Yes" : "No"}</dd></div>
          <div><dt className="font-semibold">Stopmarks present</dt><dd>{entry.stopmarksPresent ? "Yes" : "No"}</dd></div>
          {entry.translation && <div className="sm:col-span-2"><dt className="font-semibold">English translation</dt><dd className="whitespace-pre-wrap break-words">{entry.translation}</dd></div>}
        </dl>
      </section>)}
  </div></section>;
}

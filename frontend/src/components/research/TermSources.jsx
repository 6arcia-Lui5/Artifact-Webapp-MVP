import { TERM_LANGUAGES } from '../../../lib/museumTerms';

export default function TermSources({ family }) {
  return <details className="text-sm">
    <summary className="cursor-pointer w-fit">Museum sources</summary>
    <ul className="mt-3 space-y-3">
      {family.terms.map(entry => <li key={entry.language}>
        <span>{TERM_LANGUAGES[entry.language]}: <span lang={entry.language}>{entry.term}</span> — </span>
        <a className="link" href={entry.source.url} target="_blank" rel="noreferrer">{entry.source.museum}: {entry.source.title}</a>
        <span className="block text-base-content/70">{entry.source.objectId} · {entry.source.field}</span>
      </li>)}
    </ul>
  </details>;
}

import { Link } from 'react-router';
import { useMuseumTerms } from '../../hooks/useMuseumTerms';
import { TERM_LANGUAGES, termSearchUrl } from '../../lib/museumTerms';
import { QueryError } from '../components/research/CatalogFeedback';
import TermSources from '../components/research/TermSources';

export default function MuseumTermsPage() {
  const terms = useMuseumTerms();
  return <div className="max-w-3xl mx-auto space-y-8">
    <div className="space-y-2">
      <Link className="link text-sm" to="/search">Back to search</Link>
      <h1 className="text-3xl font-bold">Museum terms</h1>
      <p>Search the catalog with related English, French, German and Italian object names.</p>
      <p className="text-sm text-base-content/70">Sourced from museum records. Not yet reviewed by Holly.</p>
    </div>
    {terms.isPending ? <p role="status">Loading museum terms…</p> : terms.isError ?
      <QueryError error={terms.error} retry={() => terms.refetch()} /> : <>
        {terms.data.concepts.filter(family => family.status === 'source-attested').map(family => <section key={family.id} className="space-y-4 border-t border-base-300 pt-5" aria-labelledby={`term-${family.id}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id={`term-${family.id}`} className="text-xl font-semibold">{family.label}</h2>
            <Link className="btn btn-primary btn-sm" to={termSearchUrl(family.terms[0].term)}>Search {family.label.toLowerCase()} terms</Link>
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {family.terms.map(entry => <div key={entry.language}><dt className="text-sm text-base-content/70">{TERM_LANGUAGES[entry.language]}</dt><dd lang={entry.language} className="font-medium">{entry.term}</dd></div>)}
          </dl>
          <TermSources family={family} />
        </section>)}
        <details className="text-sm border-t border-base-300 pt-5">
          <summary className="cursor-pointer w-fit">About these terms</summary>
          <div className="space-y-2 mt-3 max-w-prose">
            <p>These are broad object classes, not translations of every specialist term. Compound phrases and unlisted words keep their ordinary search meaning.</p>
            <p>Search terms do not set an inscription’s language or an object’s origin. They search saved catalog text; they do not search museum websites.</p>
            {terms.data.concepts.map(family => <p key={family.id}>{family.scope}</p>)}
            <p>Sources checked {terms.data.checkedAt}. Glossary {terms.data.version}.</p>
          </div>
        </details>
      </>}
  </div>;
}

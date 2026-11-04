export const TERM_LANGUAGES = { en: 'English', fr: 'French', de: 'German', it: 'Italian' };
const normalized = value => value.normalize('NFC').trim().toLowerCase();

export function findTermFamily(glossary, query) {
  if (typeof query !== 'string') return undefined;
  const key = normalized(query);
  return glossary?.concepts?.find(concept => concept.status === 'source-attested' &&
    concept.terms.some(entry => normalized(entry.term) === key));
}

export function termSearchUrl(term) {
  return `/search?${new URLSearchParams({ q: term, expandTerms: '1' })}`;
}

export function uniqueTerms(family) {
  const seen = new Set();
  return family.terms.map(entry => entry.term.normalize('NFC')).filter(term => {
    const key = normalized(term);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

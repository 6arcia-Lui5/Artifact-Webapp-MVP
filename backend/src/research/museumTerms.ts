import glossary from "./museumTerms.json";

export const museumTerms = glossary;
const normalized = (value: string) => value.normalize("NFC").trim().toLowerCase();

// Only whole, attested aliases opt into a bounded family. Do not translate
// arbitrary sentences, infer inscription language, or expand provisional terms.
export function museumTermFamily(query: string) {
    const key = normalized(query);
    return glossary.concepts.find(concept => concept.status === "source-attested" &&
        concept.terms.some(entry => normalized(entry.term) === key));
}

export function museumSearchAliases(query: string, expand: boolean): string[] {
    const family = expand ? museumTermFamily(query) : undefined;
    if (!family) return [query];
    const seen = new Set<string>();
    return family.terms.map(entry => entry.term.normalize("NFC")).filter(term => {
        const key = normalized(term);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

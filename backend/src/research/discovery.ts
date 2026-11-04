import type { Router } from "express";
import { ApiError } from "./validation";
import { boundedJson, normalizeMuseum } from "./sources";

export const discoveryLimits = Object.freeze({ maxQueries: 8, maxRequests: 20, maxResults: 12, deadlineMs: 18000 });
// Explicit, reviewable vocabulary. These are finite expansions, not upstream wildcard syntax.
export const discoveryRoots: Readonly<Record<string, readonly string[]>> = Object.freeze({
    "blunder*": ["blunder", "blundered", "blundering"],
    "erro*": ["error", "errors", "erroneous"],
    "forg*": ["forged", "forgery", "forgeries"],
    "garble*": ["garble", "garbled"],
    "imitate*": ["imitate", "imitated", "imitation"],
    "nonsens*": ["nonsense", "nonsensical"],
    "pseudo*": ["pseudo", "pseudo-coin", "pseudocoin"],
    "mistake*": ["mistake", "mistakes", "mistaken"],
});

export function discoveryQueries(value: unknown) {
    if (typeof value !== "string" || value.length > 80 || !value.trim())
        throw new ApiError(400, "Enter a search term of 1–80 characters.");
    const input = value.normalize("NFC").toLowerCase().trim().replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ");
    if (!/^[\p{L}\p{N} *'-]+$/u.test(input) || !/[\p{L}\p{N}]/u.test(input))
        throw new ApiError(400, "Use words, spaces, hyphens, or a supported root such as forg*.");
    const words = input.replace(/-/g, " ").split(/\s+/).filter(Boolean);
    if (words.length > 4) throw new ApiError(400, "Search up to four words at a time.");
    let phrases = [""];
    for (const word of words) {
        const choices = word.includes("*") ? discoveryRoots[word] : word === "jewelry" || word === "jewellery" ? [word, word === "jewelry" ? "jewellery" : "jewelry"] : [word];
        if (!choices) throw new ApiError(400, "Unsupported root. Try blunder*, erro*, forg*, garble*, imitate*, nonsens*, pseudo*, or mistake*.");
        // Bounded intermediate expansion as well as bounded upstream queries.
        phrases = phrases.flatMap(prefix => choices.map(choice => `${prefix} ${choice}`.trim())).slice(0, 9);
    }
    const variants = new Set<string>();
    for (const phrase of phrases) {
        variants.add(phrase);
        if (words.length > 1) variants.add(phrase.replace(/ /g, "-"));
        if (words.length === 2) {
            const reversed = phrase.split(" ").reverse().join(" ");
            variants.add(reversed);
            variants.add(reversed.replace(/ /g, "-"));
        }
    }
    return { input, queries: [...variants].slice(0, discoveryLimits.maxQueries), limited: variants.size > discoveryLimits.maxQueries };
}

type QueryResult = { query: string; total: number; returned: number; limited: boolean; error?: string };
type Candidate = { id: string; body?: any; matches: string[] };
export async function searchMuseums(provider: unknown, value: unknown, fetcher: typeof fetch = fetch, options: { signal?: AbortSignal; deadlineMs?: number } = {}) {
    if (provider !== "met" && provider !== "cleveland") throw new ApiError(400, "Choose Met or Cleveland.");
    const plan = discoveryQueries(value);
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), Math.min(options.deadlineMs ?? discoveryLimits.deadlineMs, discoveryLimits.deadlineMs));
    let requests = 0;
    const warnings = new Set<string>();
    const queryResults: QueryResult[] = [];
    const pages: Candidate[][] = [];
    const request = async (url: string) => {
        signal.throwIfAborted();
        if (requests >= discoveryLimits.maxRequests) throw Error("Request limit reached");
        requests++;
        return boundedJson(url, fetcher, signal);
    };
    async function parallel<T>(list: T[], action: (item: T, index: number) => Promise<void>) {
        let next = 0;
        await Promise.all([0, 1].map(async () => {
            for (;;) {
                const index = next++;
                if (index >= list.length) return;
                await action(list[index], index);
            }
        }));
    }
    const failure = (error: any) => signal.aborted ? "Search time limit reached. Try a narrower term." : ["AbortError", "TimeoutError"].includes(error?.name) ? "Museum request timed out. Try a narrower term or retry." : "Museum request failed. Retry this search.";
    try {
        await parallel(plan.queries, async (query, index) => {
            try {
                const url = new URL(provider === "met" ? "https://collectionapi.metmuseum.org/public/collection/v1.1/search" : "https://openaccess-api.clevelandart.org/api/artworks/");
                url.searchParams.set("q", query);
                url.searchParams.set("limit", String(discoveryLimits.maxResults));
                url.searchParams.set(provider === "met" ? "offset" : "skip", "0");
                if (provider === "cleveland") url.searchParams.set("fields", "id,title,images,accession_number,share_license_status");
                const body = await request(url.href);
                const total = provider === "met" ? body.total : body.info?.total;
                const raw = provider === "met" ? body.objectIDs : body.data;
                if (!Number.isSafeInteger(total) || total < 0 || !(Array.isArray(raw) || total === 0 && raw === null)) throw Error("Invalid source response");
                const entries = (raw || []).slice(0, discoveryLimits.maxResults);
                pages[index] = entries.map((entry: any) => {
                    const id = String(provider === "met" ? entry : entry?.id);
                    if (!/^[1-9]\d{0,9}$/.test(id)) throw Error("Invalid source ID");
                    return { id, ...(provider === "cleveland" ? { body: { data: entry } } : {}), matches: [query] };
                });
                queryResults[index] = { query, total, returned: entries.length, limited: total > entries.length || (raw?.length ?? 0) > entries.length };
            } catch (error) {
                pages[index] = [];
                queryResults[index] = { query, total: 0, returned: 0, limited: false, error: failure(error) };
            }
        });
        const candidates = new Map<string, Candidate>();
        // Round-robin gives later spelling/query variants room in the bounded sample.
        for (let position = 0; position < discoveryLimits.maxResults; position++) for (const page of pages) {
            const candidate = page[position];
            if (!candidate) continue;
            const previous = candidates.get(candidate.id);
            if (previous) previous.matches.push(...candidate.matches.filter(query => !previous.matches.includes(query)));
            else candidates.set(candidate.id, candidate);
        }
        if (plan.limited) warnings.add("Query variants were limited to eight. Search individual terms for wider coverage.");
        if (queryResults.some(query => query.limited) || candidates.size > discoveryLimits.maxResults)
            warnings.add("Showing a limited sample: at most 12 matches per query and 12 objects overall. Narrow your search to explore further.");
        if (queryResults.some(query => query.error)) warnings.add("Some museum queries failed. These results are incomplete; retry the search.");
        const items: any[] = [];
        await parallel([...candidates.values()].slice(0, discoveryLimits.maxResults), async (candidate, index) => {
            try {
                const body = candidate.body ?? await request(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${candidate.id}`);
                const normalized = normalizeMuseum(provider, candidate.id, body);
                if (normalized.errors.length) throw Error("Missing title");
                items[index] = { key: `${provider}:${candidate.id}`, provider, objectId: candidate.id, itemName: normalized.data.itemName, museumName: normalized.data.museumName, imageSourceUrl: normalized.data.imageSourceUrl, sourceUrl: normalized.source.url, retrievedAt: normalized.source.retrievedAt, matches: candidate.matches };
            } catch {
                warnings.add("Some object details could not be loaded. These results are incomplete; retry the search.");
            }
        });
        if (signal.aborted) warnings.add("Search time limit reached. Results may be incomplete; try a narrower term.");
        return { provider, input: plan.input, queries: queryResults, items: items.filter(Boolean), partial: warnings.size > 0, warnings: [...warnings], limits: discoveryLimits, requests };
    } finally {
        clearTimeout(timer);
        controller.abort();
    }
}

export function registerDiscovery(router: Router) {
    router.get("/discovery/search", async (req, res) => {
        if (Object.keys(req.query).some(key => !["provider", "q"].includes(key))) throw new ApiError(400, "Only provider and q are supported.");
        const controller = new AbortController();
        const cancel = () => { if (!res.writableEnded) controller.abort(); };
        res.on("close", cancel);
        res.setHeader("Cache-Control", "no-store");
        try { res.json(await searchMuseums(req.query.provider, req.query.q, fetch, { signal: controller.signal })); }
        finally { res.off("close", cancel); }
    });
}

import { ApiError, sourceUrl, text, year } from "./validation";
export const sources = [{ id: "met", name: "The Metropolitan Museum of Art", description: "Selected object IDs; source links only. Check isPublicDomain before reuse." }, { id: "cleveland", name: "Cleveland Museum of Art", description: "Selected artwork IDs; image reuse follows the returned share_license_status." }];
export async function boundedJson(url: string, fetcher: typeof fetch = fetch, signal?: AbortSignal) {
    const u = new URL(url);
    if (u.protocol !== "https:" || !["collectionapi.metmuseum.org", "openaccess-api.clevelandart.org"].includes(u.hostname) || u.port || u.username || u.password)
        throw new ApiError(400, "Untrusted upstream");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let response: Response | undefined;
    try {
        response = await fetcher(url, { redirect: "error", signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal, headers: { Accept: "application/json" } });
        if (!response.ok)
            throw new Error("Source returned HTTP " + response.status);
        if (Number(response.headers.get("content-length")) > 1048576)
            throw new Error("Source response too large");
        if (!response.body)
            throw new Error("Empty source response");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                size += value.byteLength;
                if (size > 1048576)
                    throw new Error("Source response too large");
                chunks.push(value);
            }
        }
        finally {
            await reader.cancel().catch(() => {
            });
        }
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    finally {
        controller.abort();
        await response?.body?.cancel().catch(() => {
        });
        clearTimeout(timer);
    }
}
function knownImage(value: unknown, provider: string) {
    if (!value)
        return null;
    const url = sourceUrl(value, true);
    const host = new URL(url).hostname;
    const allowed = provider === "met" ? ["images.metmuseum.org"] : ["openaccess-cdn.clevelandart.org"];
    if (!allowed.includes(host))
        throw new Error("Source supplied an untrusted image URL");
    return url;
}
const val = (v: unknown) => {
    if (typeof v !== "string" || !v.trim())
        return null;
    if (v.length > 16000)
        throw new Error("Source field exceeds 16000 characters");
    return v.trim();
};
const date = (v: unknown) => v === null || v === undefined || v === "" ? null : year(v);
export function normalizeMuseum(provider: string, id: string, body: any) {
    let o = body;
    const retrieved = new Date().toISOString();
    if (provider === "cleveland")
        o = Array.isArray(body.data) ? body.data[0] : body.data;
    if (!o || String(provider === "met" ? o.objectID : o.id) !== id)
        throw new Error("Source object ID did not match requested ID");
    const met = provider === "met";
    const image = knownImage(met ? o.primaryImageSmall : o.images?.web?.url, provider);
    const source = { provider, objectId: id, url: met ? `https://www.metmuseum.org/art/collection/search/${id}` : `https://www.clevelandart.org/art/${encodeURIComponent(String(o.accession_number ?? id))}`, retrievedAt: retrieved, isPublicDomain: met ? o.isPublicDomain === true : null, license: met ? (o.isPublicDomain === true ? "CC0" : "Reuse not confirmed") : val(o.share_license_status), credit: val(met ? o.creditLine : o.creditline), originalObjectType: val(met ? o.objectName : o.type) };
    const data: any = { itemName: val(o.title), objectTypeId: null, museumName: met ? "The Metropolitan Museum of Art" : "Cleveland Museum of Art", museumCity: met ? "New York" : "Cleveland", museumCountry: "United States", museumNumber: val(met ? o.accessionNumber : o.accession_number), museumDepartment: val(o.department), museumDescription: val(met ? null : o.description), dateCulturePeriod: val(met ? o.objectDate : o.creation_date), dateStart: date(met ? o.objectBeginDate : o.creation_date_earliest), dateEnd: date(met ? o.objectEndDate : o.creation_date_latest), materials: val(met ? o.medium : null), technique: val(met ? null : o.technique), dimensions: val(met ? o.dimensions : o.measurements), productionPlace: val(met ? o.city : null), imageSourceUrl: image, imageCopyrightDetails: source.license, inscribed: null, imagery: null, sourceProvider: provider, sourceObjectId: id, sourceUrl: source.url, sourceRetrievedAt: retrieved };
    // CMA explicitly distinguishes published inscription transcription from translation.
    const literal = !met && Array.isArray(o.inscriptions) ? o.inscriptions.filter((i: any) => typeof i.inscription === "string" && i.inscription.trim()).slice(0, 20).map((i: any) => ({ content: val(i.inscription), translation: val(i.inscription_translation), language: null, script: null, serifsPresent: null, stopmarksPresent: null })) : [];
    if (met && !val(o.objectDate)) {
        data.dateStart = null;
        data.dateEnd = null;
    }
    if (data.dateStart != null && data.dateEnd != null && data.dateStart > data.dateEnd)
        throw new Error("Source dates are reversed");
    if (literal.some((i: any) => i.content.length > 10000))
        throw new Error("Published inscription exceeds 10000 characters");
    if (literal.length) {
        data.inscriptions = literal;
        data.inscribed = true;
    }
    return { data, source, warnings: ["Imported as draft. Unknown fields are null; review source facts and reuse rights."], errors: data.itemName ? [] : ["Source has no title"] };
}
export async function museumRows(provider: string, ids: unknown, fetcher: typeof fetch = fetch) {
    if (!["met", "cleveland"].includes(provider) || !Array.isArray(ids) || ids.length < 1 || ids.length > 25 || ids.some(id => typeof id !== "string" || !/^\d{1,10}$/.test(id) || Number(id) < 1))
        throw new ApiError(400, "Choose 1-25 numeric source IDs as strings");
    const rows: any[] = [];
    const deadline = new AbortController();
    const deadlineTimer = setTimeout(() => deadline.abort(), 24000);
    let next = 0;
    try {
        await Promise.all([0, 1].map(async () => {
            for (;;) {
                const n = next++;
                if (n >= ids.length)
                    return;
                const id = String(Number(ids[n]));
                try {
                    deadline.signal.throwIfAborted();
                    const url = provider === "met" ? `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}` : `https://openaccess-api.clevelandart.org/api/artworks/${id}`;
                    rows[n] = { rowNumber: n + 1, ...normalizeMuseum(provider, id, await boundedJson(url, fetcher, deadline.signal)) };
                }
                catch (e: any) {
                    rows[n] = { rowNumber: n + 1, source: { provider, objectId: id }, data: {}, warnings: [], errors: [e.name === "AbortError" ? "Source timed out" : e.message] };
                }
            }
        }));
        return rows;
    }
    finally {
        clearTimeout(deadlineTimer);
        deadline.abort();
    }
}

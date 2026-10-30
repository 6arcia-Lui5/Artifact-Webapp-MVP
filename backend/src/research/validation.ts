import { getTableColumns } from "drizzle-orm";
import { records, inscriptions } from "../db/schema";
export class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}
export const uuid = (value: unknown): string => {
    if (typeof value !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value))
        throw new ApiError(400, "Invalid identifier");
    return value;
};
export function text(value: unknown, max = 4000, nullable = true): string | null {
    if (value == null && nullable)
        return null;
    if (typeof value !== "string" || value.length > max)
        throw new ApiError(400, "Invalid text field");
    return value.trim() || null;
}
export function sourceUrl(value: unknown, httpsOnly = false): string {
    if (typeof value !== "string" || value.length > 2048)
        throw new ApiError(400, "Invalid source URL");
    let u: URL;
    try {
        u = new URL(value);
    }
    catch {
        throw new ApiError(400, "Invalid source URL");
    }
    if (!(httpsOnly ? ["https:"] : ["http:", "https:"]).includes(u.protocol) || u.username || u.password || u.port || u.hostname === "localhost" || u.hostname.endsWith(".local") || /^[\d.:]+$/.test(u.hostname) || u.hostname.includes(":"))
        throw new ApiError(400, "Invalid source URL");
    return u.href;
}
export const columns: Record<string, string> = Object.fromEntries(Object.entries(getTableColumns(records)).map(([k, v]) => [k, v.name]));
export const extra: Record<string, string> = { reviewStatus: "review_status", reviewNotes: "review_notes", reviewerId: "reviewer_id", reviewedAt: "reviewed_at", dateStart: "date_start", dateEnd: "date_end", sourceProvider: "source_provider", sourceObjectId: "source_object_id", sourceUrl: "source_url", sourceRetrievedAt: "source_retrieved_at", revision: "revision" };
export const allColumns = { ...columns, ...extra };
const inscriptionColumns = Object.fromEntries(Object.entries(getTableColumns(inscriptions)).map(([k, v]) => [k, v.name]));
export function camel(row: any): any {
    if (!row)
        return row;
    return Object.fromEntries(Object.entries(row).filter(([k]) => k !== "search_vector").map(([k, v]) => [Object.entries({ ...allColumns, ...inscriptionColumns }).find(([, s]) => s === k)?.[0] ?? k, v]));
}
export const writable = Object.keys(columns).filter(k => !["id", "userId", "createdAt", "updatedAt", "collectionId", "reviewStatus", "reviewNotes", "reviewerId", "reviewedAt", "sourceProvenance", "sourceProvider", "sourceObjectId", "sourceUrl", "sourceRetrievedAt", "revision"].includes(k));
export function recordData(input: any): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of writable)
        if (k in input)
            out[k] = input[k];
    return out;
}
export function year(value: unknown): number {
    if (!/^-?\d{1,7}$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Math.abs(Number(value)) > 1000000)
        throw new ApiError(400, "Invalid signed year");
    return Number(value);
}
export function csvCell(v: unknown): string {
    let s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s))
        s = "'" + s;
    return "\"" + s.replace(/"/g, "\"\"") + "\"";
}
export function integer(v: unknown, fallback: number, min: number, max: number): number {
    if (v === undefined)
        return fallback;
    if (typeof v !== "string" || !/^\d+$/.test(v) || Number(v) < min || Number(v) > max)
        throw new ApiError(400, "Invalid pagination");
    return Number(v);
}
export function parseSearch(q: any, userId: string) {
    const values: unknown[] = [];
    const conditions: string[] = [];
    const bind = (v: unknown) => {
        values.push(v);
        return "$" + values.length;
    };
    for (const k of Object.keys(q))
        if (typeof q[k] !== "string")
            throw new ApiError(400, "Query values must be strings");
    const search = text(q.q, 300);
    if (search) {
        const p = bind(search);
        conditions.push(`(r.search_vector @@ plainto_tsquery('simple',${p}) OR EXISTS(SELECT 1 FROM inscriptions i WHERE i.record_id=r.id AND to_tsvector('simple',coalesce(i.content,'')||' '||coalesce(i.translation,'')) @@ plainto_tsquery('simple',${p})))`);
    }
    const filters: Record<string, string> = { objectTypeId: "object_type_id", museum: "museum_name", material: "materials", place: "production_place", reviewStatus: "review_status", sourceProvider: "source_provider" };
    for (const [k, c] of Object.entries(filters))
        if (q[k]) {
            if (k === "objectTypeId")
                uuid(q[k]);
            if (k === "reviewStatus" && !["draft", "reviewed", "uncertain"].includes(q[k]))
                throw new ApiError(400, "Invalid review status");
            conditions.push(`r.${c}=${bind(text(q[k], 500))}`);
        }
    for (const k of ["language", "script"])
        if (q[k])
            conditions.push(`EXISTS(SELECT 1 FROM inscriptions i WHERE i.record_id=r.id AND i.${k}=${bind(text(q[k], 500))})`);
    if (q.collectionId)
        conditions.push(`EXISTS(SELECT 1 FROM research_memberships m WHERE m.record_id=r.id AND m.collection_id=${bind(uuid(q.collectionId))})`);
    if (q.mine !== undefined) {
        if (!["0", "1"].includes(q.mine))
            throw new ApiError(400, "mine must be 0 or 1");
        if (q.mine === "1")
            conditions.push(`r.user_id=${bind(userId)}`);
    }
    if (q.dateFrom !== undefined)
        conditions.push(`r.date_end>=${bind(year(q.dateFrom))}`);
    if (q.dateTo !== undefined)
        conditions.push(`r.date_start<=${bind(year(q.dateTo))}`);
    if (q.dateFrom !== undefined && q.dateTo !== undefined && year(q.dateFrom) > year(q.dateTo))
        throw new ApiError(400, "Reversed date range");
    if (q.ids) {
        const ids = q.ids.split(",");
        if (ids.length > 100)
            throw new ApiError(400, "At most 100 IDs");
        conditions.push(`r.id=ANY(${bind(ids.map(uuid))}::uuid[])`);
    }
    const sorts: Record<string, string> = { newest: "r.created_at DESC,r.id DESC", oldest: "r.created_at ASC,r.id ASC", title: "r.item_name ASC,r.id ASC", updated: "r.updated_at DESC,r.id DESC" };
    if (q.sort && !sorts[q.sort])
        throw new ApiError(400, "Invalid sort");
    return { values, where: conditions.length ? "WHERE " + conditions.join(" AND ") : "", order: sorts[q.sort || "newest"], page: integer(q.page, 1, 1, 100000), pageSize: integer(q.pageSize, 24, 1, 100) };
}
export function restoreInscriptions(snapshot: unknown): Array<{
    content: string;
    language: string | null;
    script: string | null;
    translation: string | null;
    serifsPresent: boolean;
    stopmarksPresent: boolean;
}> {
    if (!Array.isArray(snapshot) || snapshot.length > 30)
        throw new ApiError(400, "Invalid inscription snapshot");
    return snapshot.map(input => {
        const i = camel(input);
        if (!i || typeof i.content !== "string" || !i.content.trim() || i.content.length > 10000)
            throw new ApiError(400, "Invalid inscription snapshot");
        const entry: any = { content: i.content };
        for (const key of ["language", "script", "translation"]) {
            if (i[key] !== null && (typeof i[key] !== "string" || i[key].length > 10000))
                throw new ApiError(400, "Invalid inscription snapshot");
            entry[key] = i[key];
        }
        for (const key of ["serifsPresent", "stopmarksPresent"]) {
            if (typeof i[key] !== "boolean")
                throw new ApiError(400, "Invalid inscription snapshot");
            entry[key] = i[key];
        }
        return entry;
    });
}

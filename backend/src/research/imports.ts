import type { Router } from "express";
import type { Pool } from "pg";
import { boundedUpload } from "./upload";
import { ApiError, uuid, allColumns, columns } from "./validation";
import { transaction, event } from "./database";
import { museumRows, sources } from "./sources";
import { spreadsheetRows } from "./spreadsheet";
import { canRead, catalogAccess, visibilitySql } from "./access";
const upload = boundedUpload("file", 2);
function identityOf(d: any): string | null {
    return d.sourceProvider && d.sourceObjectId ? d.sourceProvider + ':' + d.sourceObjectId : d.museumName && d.museumNumber ? d.museumName.toLowerCase() + ':' + d.museumNumber : d.hhwIdentifier ? 'hhw:' + d.hhwIdentifier : null;
}
function progress(rows: any[]) {
    const imported = rows.filter(r => r.state === "imported").length, skipped = rows.filter(r => r.state === "skipped").length, errors = rows.filter(r => r.errors.length).length;
    return { imported, skipped, errors, remaining: rows.filter(r => !r.state && !r.errors.length).length };
}
function view(job: any) {
    const rows = job.payload.rows, p = progress(rows);
    return { id: job.id, sourceType: job.source_type, sourceProvider: job.source_provider, status: job.status, ...job.payload, summary: { total: rows.length, valid: rows.filter((r: any) => !r.errors.length).length, invalid: p.errors, duplicates: rows.filter((r: any) => r.duplicate).length }, progress: p };
}
async function safeView(pool: Pool, job: any, userId: string) {
    const copy = structuredClone(job);
    const ids = copy.payload.rows.flatMap((r: any) => r.duplicateRecordId ? [r.duplicateRecordId] : []);
    if (ids.length) {
        const visible = new Set((await pool.query(`SELECT r.id FROM records r WHERE r.id=ANY($1::uuid[])
            AND ${visibilitySql('r', '$2', catalogAccess(userId))}`, [ids, userId])).rows.map(r => r.id));
        for (const row of copy.payload.rows) {
            if (row.duplicateRecordId && !visible.has(row.duplicateRecordId)) {
                delete row.duplicateRecordId;
                row.warnings = ["Existing identity is unavailable or pending; it will be skipped."];
            }
        }
    }
    return view(copy);
}
async function getJob(c: any, id: string, user: string, lock = false) {
    const j = (await c.query(`SELECT * FROM research_imports WHERE id=$1 AND user_id=$2 AND created_at>now()-interval '30 days'${lock ? " FOR UPDATE" : ""}`, [id, user])).rows[0];
    if (!j)
        throw new ApiError(404, "Import not found or expired");
    return j;
}
export function registerImports(router: Router, pool: Pool) {
    router.get("/sources", (_req, res) => res.json({ items: sources }));
    router.get('/imports', async (_req, res) => {
        const result = await pool.query(`SELECT id,source_type AS "sourceType",source_provider AS "sourceProvider",status,jsonb_array_length(payload->'rows') AS "totalRows",(SELECT count(*)::int FROM jsonb_array_elements(payload->'rows') r WHERE r->>'state'='imported') AS "importedCount",(SELECT count(*)::int FROM jsonb_array_elements(payload->'rows') r WHERE r->>'state'='skipped') AS "skippedCount",(SELECT count(*)::int FROM jsonb_array_elements(payload->'rows') r WHERE jsonb_array_length(r->'errors')>0) AS "errorCount",created_at AS "createdAt",updated_at AS "updatedAt" FROM research_imports WHERE user_id=$1 AND created_at>now()-interval '30 days' ORDER BY created_at DESC,id DESC LIMIT 20`, [res.locals.userId]);
        res.json({ items: result.rows });
    });
    router.post("/imports/preview", upload, async (req, res) => {
        let payload: any, sourceType: string, provider: string | null = null;
        if (req.file) {
            let mapping;
            try {
                mapping = req.body?.mapping ? JSON.parse(req.body.mapping) : {};
            }
            catch {
                throw new ApiError(400, "Invalid mapping JSON");
            }
            payload = spreadsheetRows(req.file.buffer, req.file.originalname, mapping);
            sourceType = "spreadsheet";
            const filename = req.file.originalname.split(/[\\/]/).pop()?.slice(0, 200) ?? 'spreadsheet';
            for (const row of payload.rows) {
                row.source = { kind: 'spreadsheet', filename, rowNumber: row.rowNumber };
                row.data.sourceProvider = 'spreadsheet';
                row.data.sourceRetrievedAt = new Date().toISOString();
            }
        }
        else {
            provider = req.body?.sourceProvider;
            payload = { rows: await museumRows(provider!, req.body?.objectIds) };
            sourceType = "museum";
        }
        const encoded = JSON.stringify(payload);
        if (Buffer.byteLength(encoded) > 2 * 1024 * 1024)
            throw new ApiError(413, 'Preview exceeds 2 MiB; split the input into smaller files or source selections');
        const job = await transaction(pool, res.locals.userId, async (c) => {
            await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [res.locals.userId + ":imports"]);
            await c.query("DELETE FROM research_imports WHERE user_id=$1 AND created_at<now()-interval '30 days'", [res.locals.userId]);
            const count = Number((await c.query("SELECT count(*) FROM research_imports WHERE user_id=$1", [res.locals.userId])).rows[0].count);
            if (count >= 20)
                throw new ApiError(429, "Import retention limit reached (20 jobs/30 days)");
            const seen = new Map<string, number>();
            for (const row of payload.rows) {
                const d = row.data;
                const identity = identityOf(d);
                if (identity && seen.has(identity)) {
                    row.duplicate = true;
                    row.warnings.push("Duplicate of preview row " + seen.get(identity) + "; skipped on commit.");
                }
                else if (identity)
                    seen.set(identity, row.rowNumber);
                let match;
                if (d.sourceProvider && d.sourceObjectId)
                    match = (await c.query("SELECT id,user_id,moderation_status FROM records WHERE source_provider=$1 AND source_object_id=$2", [d.sourceProvider, d.sourceObjectId])).rows[0];
                else if (d.museumName && d.museumNumber)
                    match = (await c.query("SELECT id,user_id,moderation_status FROM records WHERE lower(museum_name)=lower($1) AND museum_number=$2 ORDER BY id LIMIT 1", [d.museumName, d.museumNumber])).rows[0];
                else if (d.hhwIdentifier) {
                    row.warnings.push("HHW matching is not a globally unique source identity; verify manually.");
                    match = (await c.query("SELECT id,user_id,moderation_status FROM records WHERE hhw_identifier=$1 ORDER BY id LIMIT 1", [d.hhwIdentifier])).rows[0];
                }
                if (match) {
                    row.duplicate = true;
                    if (canRead(match, catalogAccess(res.locals.userId))) row.duplicateRecordId = match.id;
                    row.warnings.push(canRead(match, catalogAccess(res.locals.userId)) ? "Possible existing artifact; it will be skipped." : "Existing identity is unavailable or pending; it will be skipped.");
                }
            }
            return (await c.query("INSERT INTO research_imports(user_id,source_type,source_provider,payload) VALUES($1,$2,$3,$4) RETURNING *", [res.locals.userId, sourceType, provider, JSON.stringify(payload)])).rows[0];
        });
        res.status(201).json(await safeView(pool, job, res.locals.userId));
    });
    router.get("/imports/:id", async (req, res) => res.json(await safeView(pool, await getJob(pool, uuid(req.params.id), res.locals.userId), res.locals.userId)));
    router.post("/imports/:id/commit", async (req, res) => {
        if (req.body?.skipDuplicates !== undefined && req.body.skipDuplicates !== true)
            throw new ApiError(400, "Duplicates can only be skipped");
        const selected = req.body?.rowNumbers;
        if (selected !== undefined && (!Array.isArray(selected) || selected.length > 500 || selected.some(n => !Number.isInteger(n) || n < 1)))
            throw new ApiError(400, "Invalid row selection");
        const result = await transaction(pool, res.locals.userId, async (c) => {
            const job = await getJob(c, uuid(req.params.id), res.locals.userId, true);
            const rows = job.payload.rows;
            const candidates = rows.filter((r: any) => !r.state && !r.errors.length && (!selected || selected.includes(r.rowNumber))).slice(0, 25);
            const recordIds: string[] = [];
            // Acquire shared identities in a stable order across different jobs.
            const identities = Array.from(new Set(candidates.filter((r: any) => !r.duplicate).map((r: any) => identityOf(r.data)).filter(Boolean))) as string[];
            for (const identity of identities.sort())
                await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["import:" + identity]);
            for (const row of candidates) {
                if (row.duplicate) {
                    row.state = "skipped";
                    continue;
                }
                const d = { ...row.data, sourceProvenance: { ...row.source, importJobId: job.id, rowNumber: row.rowNumber, ...(job.payload.mapping ? { mapping: job.payload.mapping } : {}) } };
                let duplicate;
                if (d.sourceProvider && d.sourceObjectId)
                    duplicate = (await c.query("SELECT id,user_id,moderation_status FROM records WHERE source_provider=$1 AND source_object_id=$2", [d.sourceProvider, d.sourceObjectId])).rows[0];
                else if (d.museumName && d.museumNumber)
                    duplicate = (await c.query("SELECT id,user_id,moderation_status FROM records WHERE lower(museum_name)=lower($1) AND museum_number=$2 LIMIT 1", [d.museumName, d.museumNumber])).rows[0];
                else if (d.hhwIdentifier)
                    duplicate = (await c.query("SELECT id,user_id,moderation_status FROM records WHERE hhw_identifier=$1 LIMIT 1", [d.hhwIdentifier])).rows[0];
                if (duplicate) {
                    row.state = "skipped";
                    row.duplicate = true;
                    if (canRead(duplicate, catalogAccess(res.locals.userId))) row.duplicateRecordId = duplicate.id;
                    else row.warnings.push("Existing identity is unavailable or pending; it was skipped.");
                    continue;
                }
                if (d.objectTypeName && !d.objectTypeId) {
                    d.objectTypeId = (await c.query("INSERT INTO object_types(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id", [d.objectTypeName])).rows[0].id;
                }
                if (d.objectTypeId) {
                    let typeId;
                    try {
                        typeId = uuid(d.objectTypeId);
                    }
                    catch {
                        row.errors.push("Invalid object type ID");
                        continue;
                    }
                    const found = await c.query("SELECT id FROM object_types WHERE id=$1", [typeId]);
                    if (!found.rowCount) {
                        row.errors.push("Unknown object type");
                        continue;
                    }
                }
                const allowed = Object.keys(columns).filter(k => !["id", "userId", "createdAt", "updatedAt", "collectionId", "moderationStatus", "moderationNotes", "moderatedBy", "moderatedAt", "reviewStatus", "reviewNotes", "reviewerId", "reviewedAt", "revision"].includes(k)).concat(["dateStart", "dateEnd", "sourceProvider", "sourceObjectId", "sourceUrl", "sourceRetrievedAt"]);
                const keys = Array.from(new Set(allowed)).filter(k => k in d);
                const inserted = await c.query("INSERT INTO records(user_id," + keys.map(k => allColumns[k]).join(",") + ") VALUES($1," + keys.map((_, i) => "$" + (i + 2)).join(",") + ") ON CONFLICT DO NOTHING RETURNING id", [res.locals.userId, ...keys.map(k => d[k])]);
                if (!inserted.rowCount) {
                    row.state = "skipped";
                    continue;
                }
                const id = inserted.rows[0].id;
                for (const e of d.inscriptions ?? [])
                    await c.query("INSERT INTO inscriptions(record_id,content,language,translation,script,serifs_present,stopmarks_present) VALUES($1,$2,$3,$4,$5,$6,$7)", [id, e.content, e.language, e.translation, e.script, e.serifsPresent ?? null, e.stopmarksPresent ?? null]);
                if (d.imageSourceUrl) {
                    await c.query('INSERT INTO research_images(record_id,source_url,credit,license) VALUES($1,$2,$3,$4)', [id, d.imageSourceUrl, row.source?.credit ?? null, row.source?.license ?? null]);
                    await event(c, id, res.locals.userId, 'image_attach', 'Imported source image link');
                }
                row.state = "imported";
                row.recordId = id;
                recordIds.push(id);
            }
            const p = progress(rows);
            job.status = p.remaining ? "partial" : p.errors ? "completed_with_errors" : "completed";
            await c.query("UPDATE research_imports SET payload=$2,status=$3,updated_at=now() WHERE id=$1", [job.id, JSON.stringify(job.payload), job.status]);
            return { id: job.id, status: job.status, importedCount: p.imported, skippedCount: p.skipped, errorCount: p.errors, remaining: p.remaining, recordIds };
        });
        res.json(result);
    });
}

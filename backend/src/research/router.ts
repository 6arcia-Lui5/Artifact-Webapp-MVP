import { prepareExport } from "./export";
import { Router } from "express";
import type { Pool } from "pg";
import { getAuth } from "@clerk/express";
import { ApiError, uuid, text, sourceUrl, parseSearch, camel, allColumns, writable, restoreInscriptions } from "./validation";
import { transaction, owned, record, recordSelect, event } from "./database";
import { registerImports } from "./imports";
import { registerImages } from "./images";
export function createResearchRouter(pool: Pool) {
    const router = Router();
    router.use((req, res, next) => {
        const id = getAuth(req).userId;
        if (!id) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }
        res.locals.userId = id;
        next();
    });
    router.get("/records", async (req, res) => {
        const s = parseSearch(req.query, res.locals.userId);
        const c = await pool.connect();
        try {
            await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
            const total = Number((await c.query("SELECT count(*) FROM records r " + s.where, s.values)).rows[0].count);
            const result = await c.query(recordSelect + " " + s.where + ` ORDER BY ${s.order} LIMIT $${s.values.length + 1} OFFSET $${s.values.length + 2}`, [...s.values, s.pageSize, (s.page - 1) * s.pageSize]);
            await c.query("COMMIT");
            res.json({ items: result.rows.map(camel), total, page: s.page, pageSize: s.pageSize, totalPages: Math.ceil(total / s.pageSize) });
        }
        catch (e) {
            await c.query("ROLLBACK");
            throw e;
        }
        finally {
            c.release();
        }
    });
    router.get("/facets", async (_req, res) => {
        const facets: Record<string, unknown> = {};
        for (const [key, table, column] of [["museums", "records", "museum_name"], ["materials", "records", "materials"], ["languages", "inscriptions", "language"], ["scripts", "inscriptions", "script"], ["places", "records", "production_place"], ["sourceProviders", "records", "source_provider"]])
            facets[key] = (await pool.query(`SELECT DISTINCT ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL AND ${column}<>'' AND length(${column})<=500 ORDER BY ${column} LIMIT 100`)).rows.map(r => r.value);
        facets.objectTypes = (await pool.query("SELECT id,name FROM object_types WHERE length(name)<=500 ORDER BY name,id LIMIT 100")).rows;
        res.json(facets);
    });
    router.get("/export", async (req, res) => {
        const search = parseSearch(req.query, res.locals.userId);
        const format = req.query.format ?? "json";
        if (format !== "json" && format !== "csv")
            throw new ApiError(400, "format must be csv or json");
        const c = await pool.connect();
        try {
            await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
            const bytes = await prepareExport(c, search, format);
            await c.query("COMMIT");
            res.attachment("catalog." + format).type(format === "json" ? "json" : "csv").send(bytes);
        }
        catch (e) {
            await c.query("ROLLBACK");
            throw e;
        }
        finally {
            c.release();
        }
    });
    const collectionSelect = `SELECT c.*,c.user_id AS "userId",c.time_period AS "timePeriod",c.image_url AS "imageUrl",(SELECT count(*)::integer FROM research_memberships m WHERE m.collection_id=c.id) AS "recordCount" FROM collections c`;
    router.get("/collections", async (_req, res) => res.json({ items: (await pool.query(collectionSelect + " ORDER BY c.\"createdAt\" DESC,c.id LIMIT 200")).rows }));
    router.get("/collections/:id", async (req, res) => {
        const r = (await pool.query(collectionSelect + " WHERE c.id=$1", [uuid(req.params.id)])).rows[0];
        if (!r)
            throw new ApiError(404, "Collection not found");
        res.json(r);
    });
    function collectionData(body: any, partial = false) {
        const data: Record<string, unknown> = {};
        for (const key of ["title", "description", "timePeriod", "imageUrl"]) {
            if (partial && !(key in body))
                continue;
            const v = text(body[key], key === "title" ? 200 : 4000);
            if (key === "title" && !v)
                throw new ApiError(400, "Title is required");
            data[key === "timePeriod" ? "time_period" : key === "imageUrl" ? "image_url" : key] = key === "imageUrl" && v ? sourceUrl(v) : v ?? "";
        }
        return data;
    }
    router.post("/collections", async (req, res) => {
        const data = collectionData(req.body ?? {});
        const r = await pool.query(`INSERT INTO collections(title,description,time_period,image_url,user_id) VALUES($1,$2,$3,$4,$5) RETURNING id`, [data.title, data.description, data.time_period, data.image_url, res.locals.userId]);
        res.status(201).json((await pool.query(collectionSelect + " WHERE c.id=$1", [r.rows[0].id])).rows[0]);
    });
    router.patch("/collections/:id", async (req, res) => {
        const id = uuid(req.params.id);
        const data = collectionData(req.body ?? {}, true);
        if (!Object.keys(data).length)
            throw new ApiError(400, "No writable fields");
        await transaction(pool, res.locals.userId, async (c) => {
            await owned(c, "collections", id, res.locals.userId, true);
            await c.query("UPDATE collections SET " + Object.keys(data).map((k, i) => `${k}=$${i + 2}`).join(",") + ",\"updatedAt\"=now() WHERE id=$1", [id, ...Object.values(data)]);
        });
        res.json((await pool.query(collectionSelect + " WHERE c.id=$1", [id])).rows[0]);
    });
    router.delete("/collections/:id", async (req, res) => {
        await transaction(pool, res.locals.userId, async (c) => {
            const id = uuid(req.params.id);
            await owned(c, "collections", id, res.locals.userId, true);
            await c.query("UPDATE records SET collection_id=NULL WHERE collection_id=$1", [id]);
            await c.query("DELETE FROM collections WHERE id=$1", [id]);
        });
        res.sendStatus(204);
    });
    router.post("/collections/:id/records", async (req, res) => {
        const id = uuid(req.params.id), ids = req.body?.recordIds;
        if (!Array.isArray(ids) || !ids.length || ids.length > 100)
            throw new ApiError(400, "Choose 1-100 records");
        ids.forEach(uuid);
        const result = await transaction(pool, res.locals.userId, async (c) => {
            await owned(c, "collections", id, res.locals.userId, true);
            if (Number((await c.query("SELECT count(*) FROM records WHERE id=ANY($1::uuid[])", [Array.from(new Set(ids))])).rows[0].count) !== new Set(ids).size)
                throw new ApiError(400, "Unknown record");
            const added = await c.query("INSERT INTO research_memberships(collection_id,record_id) SELECT $1,unnest($2::uuid[]) ON CONFLICT DO NOTHING", [id, ids]);
            return { added: added.rowCount, recordCount: Number((await c.query("SELECT count(*) FROM research_memberships WHERE collection_id=$1", [id])).rows[0].count) };
        });
        res.json(result);
    });
    router.delete("/collections/:id/records/:recordId", async (req, res) => {
        await transaction(pool, res.locals.userId, async (c) => {
            const id = uuid(req.params.id);
            await owned(c, "collections", id, res.locals.userId, true);
            await c.query("DELETE FROM research_memberships WHERE collection_id=$1 AND record_id=$2", [id, uuid(req.params.recordId)]);
            await c.query("UPDATE records SET collection_id=NULL WHERE id=$1 AND collection_id=$2", [uuid(req.params.recordId), id]);
        });
        res.sendStatus(204);
    });
    router.get("/records/:id/history", async (req, res) => {
        const id = uuid(req.params.id);
        await owned(pool, "records", id, res.locals.userId);
        res.json({ items: (await pool.query("SELECT id,record_id AS \"recordId\",actor_id AS \"actorId\",created_at AS \"createdAt\",action,summary,CASE WHEN octet_length(snapshot::text)>65536 THEN NULL ELSE snapshot END AS snapshot,coalesce(octet_length(snapshot::text)>65536,false) AS \"snapshotOmitted\" FROM research_history WHERE record_id=$1 AND owner_id=$2 ORDER BY sequence DESC LIMIT 25", [id, res.locals.userId])).rows });
    });
    router.patch("/records/:id/review", async (req, res) => {
        const id = uuid(req.params.id);
        const hasStatus = req.body?.reviewStatus !== undefined;
        if (hasStatus && !["draft", "reviewed", "uncertain"].includes(req.body.reviewStatus))
            throw new ApiError(400, "Invalid review status");
        if (!hasStatus && req.body?.notes === undefined)
            throw new ApiError(400, "Supply reviewStatus or notes");
        const notes = text(req.body?.notes, 10000);
        const result = await transaction(pool, res.locals.userId, async (c) => {
            await owned(c, "records", id, res.locals.userId, true);
            if (hasStatus) {
                await c.query(`UPDATE records SET review_status=$2,
                    review_notes=CASE WHEN $5 THEN $3 ELSE review_notes END,
                    reviewer_id=CASE WHEN $2='draft' THEN NULL ELSE $4 END,
                    reviewed_at=CASE WHEN $2='draft' THEN NULL ELSE clock_timestamp() END
                    WHERE id=$1`, [id, req.body.reviewStatus, notes, res.locals.userId, req.body.notes !== undefined]);
            }
            else {
                await c.query("UPDATE records SET review_notes=$2 WHERE id=$1", [id, notes]);
            }
            await event(c, id, res.locals.userId, "review", hasStatus ? "Review status: " + req.body.reviewStatus : "Updated review notes");
            return record(c, id);
        });
        res.json({ record: result });
    });
    router.post("/records/:id/history/:revisionId/restore", async (req, res) => {
        const id = uuid(req.params.id);
        const expected = req.body?.expectedRevision;
        if (!Number.isInteger(expected) || expected < 1)
            throw new ApiError(400, "expectedRevision is required for safe restore");
        const result = await transaction(pool, res.locals.userId, async (c) => {
            const current = await owned(c, "records", id, res.locals.userId, true);
            if (current.revision !== expected)
                throw new ApiError(409, "Record changed; reload before restoring");
            const h = (await c.query("SELECT snapshot FROM research_history WHERE id=$1 AND record_id=$2 AND owner_id=$3", [uuid(req.params.revisionId), id, res.locals.userId])).rows[0];
            if (!h?.snapshot?.record)
                throw new ApiError(404, "Restorable snapshot not found");
            const data = camel(h.snapshot.record);
            const keys = writable.filter(k => k in data);
            await c.query("UPDATE records SET " + keys.map((k, i) => allColumns[k] + "=$" + (i + 2)).join(",") + " WHERE id=$1", [id, ...keys.map(k => data[k])]);
            const entries = restoreInscriptions(h.snapshot.inscriptions ?? []);
            await c.query("DELETE FROM inscriptions WHERE record_id=$1", [id]);
            for (const e of entries)
                await c.query("INSERT INTO inscriptions(record_id,content,language,translation,script,serifs_present,stopmarks_present) VALUES($1,$2,$3,$4,$5,$6,$7)", [id, e.content, e.language, e.translation, e.script, e.serifsPresent, e.stopmarksPresent]);
            await event(c, id, res.locals.userId, "restore", "Restored snapshot " + req.params.revisionId);
            return record(c, id);
        });
        res.json({ record: result });
    });
    registerImports(router, pool);
    registerImages(router, pool);
    router.use((error: any, _req: any, res: any, _next: any) => {
        if (res.headersSent)
            return;
        if (["42P01", "42703"].includes(error?.code)) {
            res.status(503).json({ error: "Research catalog migration is not applied. Ask the operator to apply the research migration to the configured schema." });
            return;
        }
        if (['40P01', '40001', '55P03'].includes(error?.code)) {
            res.status(409).json({ error: 'Concurrent operation; retry this request' });
            return;
        }
        const status = error instanceof ApiError ? error.status : error?.code === "LIMIT_FILE_SIZE" ? 413 : typeof error?.code === "string" && error.code.startsWith("LIMIT_") ? 400 : 500;
        if (status === 500)
            console.error("Research API operation failed", error?.message);
        res.status(status).json({ error: status === 500 ? "Research operation failed" : error.message });
    });
    return router;
}

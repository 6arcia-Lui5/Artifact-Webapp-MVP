import type { Router } from "express";
import type { Pool } from "pg";
import { ApiError, uuid } from "./validation";
import { transaction } from "./database";
import { museumRows } from "./sources";

export const DISCOVERY_LIMIT = 1000;
const pageSize = 25;
const selection = `id,source_provider AS "sourceProvider",source_object_id AS "sourceObjectId",title,
  museum_number AS "museumNumber",object_type AS "objectType",date_label AS "dateLabel",material,license,
  source_url AS "sourceUrl",retrieved_at AS "retrievedAt",decision,previous_decision AS "previousDecision",
  revision,created_at AS "createdAt",updated_at AS "updatedAt"`;

export function discoveryInput(body: any): { provider: string; ids: string[] } {
    const provider = body?.sourceProvider, ids = body?.objectIds;
    if (!["met", "cleveland"].includes(provider) || !Array.isArray(ids) || ids.length < 1 || ids.length > 25 ||
        ids.some(id => typeof id !== "string" || !/^\d{1,10}$/.test(id) || Number(id) < 1))
        throw new ApiError(400, "Choose a museum and 1–25 positive numeric object IDs.");
    return { provider, ids: [...new Set(ids.map(id => String(Number(id))))] };
}
const short = (value: unknown, max: number) => typeof value === "string" && value.trim()
    ? [...value.trim()].slice(0, max).join("") : null;
function compact(row: any) {
    const d = row.data, s = row.source;
    const values = [short(d.itemName, 500), short(d.museumNumber, 200), short(s.originalObjectType, 200),
        short(d.dateCulturePeriod, 200), short(d.materials, 300), short(s.license, 200), s.url];
    if (!values[0] || typeof s.url !== "string" || s.url.length > 2048 ||
        Buffer.byteLength(values.map(v => v ?? "").join(""), "utf8") > 8192)
        throw new Error("Source summary is too large to save. Open the museum record directly.");
    return values;
}
function expectedRevision(body: any): number {
    const n = body?.expectedRevision;
    if (!Number.isInteger(n) || n < 1 || n >= 2147483647)
        throw new ApiError(400, "A valid expectedRevision is required.");
    return n;
}

export function registerDiscoveries(router: Router, pool: Pool) {
    router.get("/discoveries", async (req, res) => {
        const status = req.query.status ?? "active", page = Number(req.query.page ?? 1);
        if (typeof status !== "string" || !["active", "pending", "kept", "dismissed", "all"].includes(status) ||
            !Number.isInteger(page) || page < 1 || page > 40)
            throw new ApiError(400, "Choose a valid list status and page (1–40).");
        // One statement gives counts and page rows the same database snapshot.
        const result = (await pool.query(`WITH owned AS MATERIALIZED (
                SELECT ${selection} FROM research_discoveries WHERE user_id=$1
            ), eligible AS (
                SELECT * FROM owned WHERE $2='all' OR ($2='active' AND decision<>'dismissed') OR decision=$2
            ) SELECT coalesce((SELECT json_agg(p) FROM (SELECT * FROM eligible ORDER BY "updatedAt" DESC,id LIMIT $3 OFFSET $4) p),'[]') AS items,
                (SELECT count(*)::int FROM eligible) AS total,
                (SELECT row_to_json(t) FROM (SELECT count(*)::int AS total,
                count(*) FILTER(WHERE decision='pending')::int AS pending,
                count(*) FILTER(WHERE decision='kept')::int AS kept,
                count(*) FILTER(WHERE decision='dismissed')::int AS dismissed
                FROM owned) t) AS counts`, [res.locals.userId, status, pageSize, (page - 1) * pageSize])).rows[0];
        res.json({ ...result, page, pageSize, totalPages: Math.ceil(result.total / pageSize), limit: DISCOVERY_LIMIT });
    });
    router.get("/discoveries/:id", async (req, res) => {
        const item = (await pool.query(`SELECT ${selection} FROM research_discoveries WHERE id=$1 AND user_id=$2`,
            [uuid(req.params.id), res.locals.userId])).rows[0];
        if (!item) throw new ApiError(404, "Discovery not found.");
        res.json({ item });
    });
    router.post("/discoveries", async (req, res) => {
        const { provider, ids } = discoveryInput(req.body), user = res.locals.userId;
        if (!(await pool.query("SELECT id FROM users WHERE id=$1", [user])).rowCount)
            throw new ApiError(409, "Your account profile is not connected yet. Reload the page and retry.");
        const existingIds = new Set((await pool.query("SELECT source_object_id FROM research_discoveries WHERE user_id=$1 AND source_provider=$2 AND source_object_id=ANY($3::text[])", [user, provider, ids])).rows.map(r => r.source_object_id));
        const missing = ids.filter(id => !existingIds.has(id));
        // Repeated adds do not refresh metadata, reset decisions, or refetch known objects.
        const count = Number((await pool.query("SELECT count(*) FROM research_discoveries WHERE user_id=$1", [user])).rows[0].count);
        if (count + missing.length > DISCOVERY_LIMIT) throw new ApiError(429, "Your research list is full (1,000 objects). Existing decisions are retained.");
        const rows = missing.length ? await museumRows(provider, missing) : [];
        const errors: { objectId: string; message: string }[] = [];
        const candidates: { row: any; values: (string | null)[] }[] = [];
        for (const row of rows) {
            try {
                if (row.errors.length) throw new Error(row.errors.join(" "));
                candidates.push({ row, values: compact(row) });
            } catch (error: any) {
                errors.push({ objectId: row.source.objectId, message: String(error.message).slice(0, 250) });
            }
        }
        const result = await transaction(pool, user, async c => {
            await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [user + ":discoveries"]);
            const total = Number((await c.query("SELECT count(*) FROM research_discoveries WHERE user_id=$1", [user])).rows[0].count);
            const nowExisting = new Set((await c.query("SELECT source_object_id FROM research_discoveries WHERE user_id=$1 AND source_provider=$2 AND source_object_id=ANY($3::text[])", [user, provider, ids])).rows.map(r => r.source_object_id));
            const fresh = candidates.filter(({ row }) => !nowExisting.has(row.source.objectId));
            if (total + fresh.length > DISCOVERY_LIMIT) throw new ApiError(429, "Your research list is full (1,000 objects). Existing decisions are retained.");
            for (const { row, values } of fresh) {
                await c.query(`INSERT INTO research_discoveries(user_id,source_provider,source_object_id,title,museum_number,object_type,date_label,material,license,source_url,retrieved_at)
                    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [user, provider, row.source.objectId, ...values, row.source.retrievedAt]);
            }
            return { added: fresh.length, existing: nowExisting.size, errors };
        });
        res.status(201).json(result);
    });
    const decide = (undo: boolean) => async (req: any, res: any) => {
        const id = uuid(req.params.id), expected = expectedRevision(req.body), user = res.locals.userId;
        if (!undo && !["kept", "dismissed"].includes(req.body?.decision)) throw new ApiError(400, "Choose Keep or Dismiss.");
        const item = await transaction(pool, user, async c => {
            const current = (await c.query("SELECT * FROM research_discoveries WHERE id=$1 AND user_id=$2 FOR UPDATE", [id, user])).rows[0];
            if (!current) throw new ApiError(404, "Discovery not found.");
            if (current.revision !== expected) throw new ApiError(409, "This decision changed. Reload the list before deciding again.");
            if (undo && current.previous_decision == null) throw new ApiError(409, "There is no previous decision to undo.");
            const next = undo ? current.previous_decision : req.body.decision;
            if (undo || next !== current.decision) {
                await c.query(`UPDATE research_discoveries SET decision=$3,previous_decision=$4,revision=revision+1,updated_at=clock_timestamp()
                    WHERE id=$1 AND user_id=$2`, [id, user, next, undo ? null : current.decision]);
            }
            return (await c.query(`SELECT ${selection} FROM research_discoveries WHERE id=$1 AND user_id=$2`, [id, user])).rows[0];
        });
        res.json({ item });
    };
    router.patch("/discoveries/:id", decide(false));
    router.post("/discoveries/:id/undo", decide(true));
}

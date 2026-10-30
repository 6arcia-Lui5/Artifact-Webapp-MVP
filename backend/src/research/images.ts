import type { Router } from "express";
import type { Pool } from "pg";
import { boundedUpload } from "./upload";
import { randomUUID } from "node:crypto";
import { ApiError, uuid, sourceUrl, text } from "./validation";
import { transaction, owned, event } from "./database";
import { Storage, createStorage, storageLimit } from "./storage";
import { MAX_FILE_BYTES, validateImage } from "./imageValidation";
import { imageLocation } from "./imageDto";
const upload = boundedUpload("photo", 5);
export async function reserve(pool: Pool, user: string, id: string, driver: string, bytes: number, max: number) {
    return transaction(pool, user, async (c) => {
        const r = await c.query("UPDATE research_storage SET used_bytes=used_bytes+$1 WHERE id=1 AND used_bytes+$1<=$2 RETURNING used_bytes", [bytes, max]);
        if (!r.rowCount)
            throw new ApiError(413, "Image storage quota exceeded");
        await c.query("INSERT INTO research_blobs(id,driver,original_key,thumbnail_key,byte_size,owner_id,mime,state) VALUES($1,$2,$3,$4,$5,$6,'pending','reserved')", [id, driver, id + "/original", id + "/thumbnail", bytes, user]);
    });
}
async function release(pool: Pool, user: string, id: string) {
    await transaction(pool, user, async (c) => {
        const r = await c.query("DELETE FROM research_blobs WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM research_images WHERE blob_id=$1) RETURNING byte_size", [id]);
        if (r.rowCount)
            await c.query("UPDATE research_storage SET used_bytes=used_bytes-$1 WHERE id=1", [r.rows[0].byte_size]);
    });
}
const select = `SELECT i.*,b.driver,b.byte_size,b.mime,b.original_key,b.thumbnail_key FROM research_images i LEFT JOIN research_blobs b ON b.id=i.blob_id`;
function publicImage(i: any) {
    return { ...imageLocation(i), recordId: i.record_id, sourceUrl: i.source_url, credit: i.credit, license: i.license, isPrimary: i.is_primary, byteSize: Number(i.byte_size ?? 0), createdAt: i.created_at };
}
export async function cleanupBlob(pool: Pool, storage: Storage, user: string, id: string) {
    const b = (await pool.query("SELECT * FROM research_blobs WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM research_images WHERE blob_id=$1)", [id])).rows[0];
    if (!b)
        return;
    if (b.driver !== storage.driver)
        throw new ApiError(503, "Original storage adapter is unavailable");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
        await storage.delete(b.original_key, controller.signal);
        await storage.delete(b.thumbnail_key, controller.signal);
        await release(pool, user, id);
    }
    finally {
        clearTimeout(timer);
    }
}
export function registerImages(router: Router, pool: Pool, injected?: Storage) {
    let adapter: Storage | undefined = injected;
    const storage = () => adapter ?? (adapter = createStorage());
    router.post("/storage/cleanup", async (_req, res) => {
        const store = storage();
        if (store.driver === "disabled")
            throw new ApiError(503, "Image storage disabled");
        const stale = (await pool.query("SELECT id FROM research_blobs b WHERE owner_id=$1 AND driver=$2 AND created_at<now()-interval '1 hour' AND NOT EXISTS(SELECT 1 FROM research_images i WHERE i.blob_id=b.id) ORDER BY created_at LIMIT 3", [res.locals.userId, store.driver])).rows;
        let cleaned = 0;
        for (const b of stale) {
            await cleanupBlob(pool, store, res.locals.userId, b.id);
            cleaned++;
        }
        res.json({ cleaned });
    });
    router.get("/storage/status", async (_req, res) => {
        const driver = storage().driver;
        const result = await pool.query("SELECT used_bytes FROM research_storage WHERE id=1");
        res.json({ driver, configured: driver !== "disabled", usedBytes: Number(result.rows[0]?.used_bytes ?? 0), maxBytes: storageLimit(), maxFileBytes: MAX_FILE_BYTES, uploadEnabled: driver !== "disabled", note: "Bytes include originals, thumbnails and pending cleanup reservations; provider billing is separate." });
    });
    router.get("/records/:id/images", async (req, res) => {
        const id = uuid(req.params.id);
        if (!(await pool.query("SELECT 1 FROM records WHERE id=$1", [id])).rowCount)
            throw new ApiError(404, "Record not found");
        res.json({ items: (await pool.query(select + " WHERE i.record_id=$1 ORDER BY i.is_primary DESC,i.created_at,i.id LIMIT 100", [id])).rows.map(publicImage) });
    });
    router.get("/records/:id/images/:imageId/file", async (req, res) => {
        const r = (await pool.query(select + " WHERE i.record_id=$1 AND i.id=$2", [uuid(req.params.id), uuid(req.params.imageId)])).rows[0];
        if (!r?.blob_id)
            throw new ApiError(404, "Image not found");
        if (r.driver !== storage().driver)
            throw new ApiError(503, "Stored image adapter is unavailable");
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        const abort = () => controller.abort();
        req.on("aborted", abort);
        try {
            const thumb = req.query.thumbnail === "1";
            const b = await storage().get(thumb ? r.thumbnail_key : r.original_key, controller.signal);
            res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" }).type(thumb ? "image/webp" : r.mime).send(b);
        }
        finally {
            clearTimeout(timer);
            req.off("aborted", abort);
        }
    });
    // Check ownership before parsing multipart data.
    router.post("/records/:id/images", async (req, res, next) => {
        try {
            await owned(pool, "records", uuid(req.params.id), res.locals.userId);
            next();
        }
        catch (e) {
            next(e);
        }
    }, upload, async (req, res) => {
        const id = uuid(req.params.id), user = res.locals.userId;
        const caption = text(req.body?.caption), credit = text(req.body?.credit), license = text(req.body?.license);
        if (!req.file) {
            const source = sourceUrl(req.body?.sourceUrl);
            if (req.body?.isPrimary !== undefined && typeof req.body.isPrimary !== "boolean")
                throw new ApiError(400, "isPrimary must be boolean");
            const image = await transaction(pool, user, async (c) => {
                await owned(c, "records", id, user, true);
                if (Number((await c.query("SELECT count(*) FROM research_images WHERE record_id=$1", [id])).rows[0].count) >= 100)
                    throw new ApiError(413, "At most 100 images per record");
                if (req.body.isPrimary)
                    await c.query("UPDATE research_images SET is_primary=false WHERE record_id=$1", [id]);
                const r = await c.query("INSERT INTO research_images(record_id,source_url,caption,credit,license,is_primary) VALUES($1,$2,$3,$4,$5,$6) RETURNING *", [id, source, caption, credit, license, req.body.isPrimary === true]);
                await event(c, id, user, "image_attach", "Attached source image link");
                return r.rows[0];
            });
            res.status(201).json(publicImage(image));
            return;
        }
        if (req.body?.rightsConfirmed !== "true")
            throw new ApiError(400, "Confirm image reuse rights");
        const store = storage();
        if (store.driver === "disabled")
            throw new ApiError(503, "Image storage disabled");
        const validated = await validateImage(req.file.buffer, req.file.mimetype);
        const blob = randomUUID(), bytes = req.file.buffer.length + validated.thumbnail.length;
        await reserve(pool, user, blob, store.driver, bytes, storageLimit());
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const abort = () => controller.abort();
        req.on("aborted", abort);
        try {
            await store.put(blob + "/original", req.file.buffer, validated.mime, controller.signal);
            await store.put(blob + "/thumbnail", validated.thumbnail, "image/webp", controller.signal);
            controller.signal.throwIfAborted();
            const image = await transaction(pool, user, async (c) => {
                await owned(c, "records", id, user, true);
                if (Number((await c.query("SELECT count(*) FROM research_images WHERE record_id=$1", [id])).rows[0].count) >= 100)
                    throw new ApiError(413, "At most 100 images per record");
                await c.query("UPDATE research_blobs SET state='ready',mime=$2 WHERE id=$1", [blob, validated.mime]);
                const r = await c.query("INSERT INTO research_images(record_id,blob_id,caption,credit,license) VALUES($1,$2,$3,$4,$5) RETURNING *", [id, blob, caption, credit, license]);
                await event(c, id, user, "image_upload", "Uploaded original and thumbnail");
                return { ...r.rows[0], driver: store.driver, byte_size: bytes };
            });
            res.status(201).json(publicImage(image));
        }
        catch (e) {
            try {
                await cleanupBlob(pool, store, user, blob);
            }
            catch {
                console.error("Image cleanup deferred; quota remains reserved", blob);
            }
            throw e;
        }
        finally {
            clearTimeout(timer);
            req.off("aborted", abort);
        }
    });
    router.patch("/records/:id/images/:imageId", async (req, res) => {
        const id = uuid(req.params.id), imageId = uuid(req.params.imageId);
        if (req.body?.isPrimary !== undefined && typeof req.body.isPrimary !== "boolean")
            throw new ApiError(400, "isPrimary must be boolean");
        const changes: Record<string, unknown> = {};
        for (const key of ["caption", "credit", "license"])
            if (key in (req.body ?? {}))
                changes[key] = text(req.body[key]);
        if ("isPrimary" in (req.body ?? {}))
            changes.is_primary = req.body.isPrimary;
        if (!Object.keys(changes).length)
            throw new ApiError(400, "No writable fields");
        await transaction(pool, res.locals.userId, async (c) => {
            await owned(c, "records", id, res.locals.userId, true);
            if (req.body.isPrimary)
                await c.query("UPDATE research_images SET is_primary=false WHERE record_id=$1", [id]);
            const r = await c.query("UPDATE research_images SET " + Object.keys(changes).map((k, i) => k + "=$" + (i + 3)).join(",") + " WHERE record_id=$1 AND id=$2", [id, imageId, ...Object.values(changes)]);
            if (!r.rowCount)
                throw new ApiError(404, "Image not found");
            await event(c, id, res.locals.userId, "image_update", "Updated image metadata/primary selection");
        });
        res.json(publicImage((await pool.query(select + " WHERE i.id=$1", [imageId])).rows[0]));
    });
    router.delete("/records/:id/images/:imageId", async (req, res) => {
        const blob = await transaction(pool, res.locals.userId, async (c) => {
            const id = uuid(req.params.id);
            await owned(c, "records", id, res.locals.userId, true);
            const result = await c.query("DELETE FROM research_images WHERE record_id=$1 AND id=$2 RETURNING blob_id", [id, uuid(req.params.imageId)]);
            if (!result.rowCount)
                throw new ApiError(404, "Image not found");
            await event(c, id, res.locals.userId, "image_delete", "Removed image association");
            return result.rows[0].blob_id;
        });
        if (blob) {
            try {
                await cleanupBlob(pool, storage(), res.locals.userId, blob);
            }
            catch {
                console.error("Image deletion retained storage reservation", blob);
            }
        }
        res.sendStatus(204);
    });
}

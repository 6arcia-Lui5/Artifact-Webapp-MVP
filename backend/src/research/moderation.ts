import type { Router } from "express";
import type { Pool } from "pg";
import { ApiError, camel, integer, uuid } from "./validation";
import { approvedTarget, approvedTargets, catalogAccess, elevated, resolveAccess } from "./access";
import { event, readable, record, recordSelect, transaction } from "./database";

export function registerModeration(router: Router, pool: Pool) {
    router.get("/access", (_req, res) => {
        const access = catalogAccess();
        res.json({ ...access, canReview: elevated(access), canManageRoles: access.role === "admin" });
    });
    router.get("/moderation", async (req, res) => {
        if (!elevated()) throw new ApiError(403, "Reviewer access required");
        const status = req.query.status ?? "pending";
        if (!["pending", "approved", "changes_requested"].includes(String(status)) || typeof status !== "string")
            throw new ApiError(400, "Invalid moderation status");
        const page = integer(req.query.page, 1, 1, 100000);
        const pageSize = integer(req.query.pageSize, 24, 1, 100);
        const result = await transaction(pool, catalogAccess().userId, async c => {
            const total = Number((await c.query("SELECT count(*) FROM records WHERE moderation_status=$1", [status])).rows[0].count);
            const items = (await c.query(recordSelect + " WHERE r.moderation_status=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT $2 OFFSET $3",
                [status, pageSize, (page - 1) * pageSize])).rows.map(camel);
            return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
        });
        res.json(result);
    });
    router.post("/records/:id/moderate", async (req, res) => {
        const access = catalogAccess();
        const id = uuid(req.params.id);
        if (!elevated(access)) {
            await readable(pool, id, access.userId);
            throw new ApiError(403, "Reviewer access required");
        }
        const { status, notes, expectedRevision } = req.body ?? {};
        if (!["approved", "changes_requested"].includes(status)) throw new ApiError(400, "Invalid decision");
        if (typeof notes !== "string" || !notes.trim() || notes.length > 10000)
            throw new ApiError(400, "Decision notes must contain 1-10000 characters");
        if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
            throw new ApiError(400, "expectedRevision is required");
        const result = await transaction(pool, access.userId, async c => {
            // Role changes take an UPDATE lock on the same user. A decision cannot
            // race a completed revocation and still use its earlier request role.
            await c.query("SELECT id FROM users WHERE id=$1 FOR SHARE", [access.userId]);
            const currentAccess = await resolveAccess(c, access.userId);
            if (!elevated(currentAccess)) throw new ApiError(403, "Reviewer access was revoked");
            const current = (await c.query("SELECT * FROM records WHERE id=$1 FOR UPDATE", [id])).rows[0];
            if (!current) throw new ApiError(404, "Record not found");
            if (current.user_id === access.userId && currentAccess.role !== "admin")
                throw new ApiError(403, "Reviewers cannot decide their own submissions");
            if (current.revision !== expectedRevision) throw new ApiError(409, "Record changed; reload before deciding");
            await c.query(`UPDATE records SET moderation_status=$2,moderation_notes=$3,
                moderated_by=$4,moderated_at=clock_timestamp() WHERE id=$1`, [id, status, notes.trim(), access.userId]);
            await event(c, id, access.userId, "moderation", "Publication decision: " + status);
            return record(c, id);
        });
        res.json({ record: result });
    });
    router.get("/roles", async (_req, res) => {
        if (catalogAccess().role !== "admin") throw new ApiError(403, "Administrator access required");
        const ids = approvedTargets();
        const users = (await pool.query(`SELECT u.id AS "userId",u.name,u.email,coalesce(r.role,'contributor') AS role
            FROM users u LEFT JOIN research_roles r ON r.user_id=u.id WHERE u.id=ANY($1::text[])
            ORDER BY u.id LIMIT 100`, [ids])).rows;
        const admins = new Set((process.env.CATALOG_ADMIN_USER_IDS ?? "").split(",").map(id => id.trim()));
        res.json({ items: users.map(user => ({ ...user, role: admins.has(user.userId) ? "admin" : user.role })) });
    });
    router.patch("/roles/:userId", async (req, res) => {
        const access = catalogAccess();
        if (access.role !== "admin") throw new ApiError(403, "Administrator access required");
        const target = String(req.params.userId);
        const role = req.body?.role;
        if (!["contributor", "reviewer"].includes(role)) throw new ApiError(400, "Only contributor/reviewer assignments are allowed");
        if (target === access.userId) throw new ApiError(400, "Self-role changes are not allowed");
        const admins = new Set((process.env.CATALOG_ADMIN_USER_IDS ?? "").split(",").map(id => id.trim()));
        if (!approvedTarget(target) || admins.has(target)) throw new ApiError(400, "Target must be an approved non-admin account");
        await transaction(pool, access.userId, async c => {
            // Lock the existing user so concurrent grants/revocations serialize, including the first grant.
            if (!(await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [target])).rowCount)
                throw new ApiError(404, "Existing approved account not found");
            const prior = (await c.query("SELECT role FROM research_roles WHERE user_id=$1", [target])).rows[0]?.role ?? "contributor";
            await c.query(`INSERT INTO research_roles(user_id,role,assigned_by) VALUES($1,$2,$3)
                ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,assigned_by=excluded.assigned_by,updated_at=clock_timestamp()`,
                [target, role, access.userId]);
            await c.query("INSERT INTO research_role_history(actor_id,target_id,old_role,new_role) VALUES($1,$2,$3,$4)",
                [access.userId, target, prior, role]);
        });
        res.json({ userId: target, role });
    });
}

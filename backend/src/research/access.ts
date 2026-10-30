import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";
import type { Pool } from "pg";
import { getAuth } from "@clerk/express";
import { ApiError } from "./validation";
import { approvedAccountIds, isApprovedUserId } from "../middleware/siteAccounts";

export type CatalogRole = "contributor" | "reviewer" | "admin";
export type CatalogAccess = { userId: string; role: CatalogRole };
const context = new AsyncLocalStorage<CatalogAccess>();
export const withCatalogAccess = <T>(access: CatalogAccess, work: () => T): T => context.run(access, work);
export const catalogAccess = (fallbackUser = ""): CatalogAccess => context.getStore() ?? { userId: fallbackUser, role: "contributor" };
export const elevated = (access = catalogAccess()) => access.role === "reviewer" || access.role === "admin";
export const isAdmin = () => catalogAccess().role === "admin";
export const approvedTargets = approvedAccountIds;
export const approvedTarget = isApprovedUserId;

export async function resolveAccess(pool: Pick<Pool, "query">, userId: string): Promise<CatalogAccess> {
    if (!isApprovedUserId(userId)) throw new ApiError(403, "This account does not have access");
    // No role cache: a revocation affects the next request, including requests on another process.
    const assignment = (await pool.query("SELECT role FROM research_roles WHERE user_id=$1", [userId])).rows[0];
    const admins = new Set((process.env.CATALOG_ADMIN_USER_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean));
    return { userId, role: admins.has(userId) ? "admin" : assignment?.role === "reviewer" ? "reviewer" : "contributor" };
}

export const catalogContext = (pool: Pool): RequestHandler => async (req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    res.vary("Cookie");
    res.vary("Authorization");
    if (context.getStore()) return next();
    const userId = getAuth(req).userId;
    if (!userId) return next(new ApiError(401, "Sign in to continue"));
    try {
        const access = await resolveAccess(pool, userId);
        res.locals.catalogAccess = access;
        context.run(access, next);
    } catch (error) { next(error); }
};

export function canRead(row: any, access = catalogAccess()): boolean {
    return elevated(access) || (row.user_id ?? row.userId) === access.userId ||
        (row.moderation_status ?? row.moderationStatus) === "approved";
}
export function canEdit(row: any, userId: string): boolean {
    return isAdmin() || (row.user_id ?? row.userId) === userId;
}
// All aliases are internal constants, never query/request text. User IDs remain parameters.
export function visibilitySql(alias: string, parameter: string, access = catalogAccess()): string {
    return elevated(access) ? `(${parameter}::text IS NOT NULL)` : `(${alias}.moderation_status='approved' OR ${alias}.user_id=${parameter})`;
}

export function appendVisibility<T extends { values: unknown[]; where: string }>(search: T, access: CatalogAccess): T {
    search.values.push(access.userId);
    const clause = visibilitySql("r", "$" + search.values.length, access);
    search.where += (search.where ? " AND " : "WHERE ") + clause;
    return search;
}

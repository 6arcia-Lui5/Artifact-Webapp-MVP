import type { Pool, PoolClient } from "pg";
import { ApiError, camel } from "./validation";
import { primaryImageSelect } from "./imageDto";
export type Connection = Pick<PoolClient, "query">;
export async function transaction<T>(pool: Pool, actor: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('research.actor',$1,true)", [actor]);
        await c.query("SELECT set_config('lock_timeout','5000',true),set_config('statement_timeout','20000',true)");
        const result = await fn(c);
        await c.query("COMMIT");
        return result;
    }
    catch (e) {
        await c.query("ROLLBACK");
        throw e;
    }
    finally {
        c.release();
    }
}
export async function owned(c: Connection, table: "records" | "collections", id: string, owner: string, lock = false) {
    const result = await c.query(`SELECT * FROM ${table} WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [id]);
    if (!result.rows[0])
        throw new ApiError(404, "Not found");
    if (result.rows[0].user_id !== owner)
        throw new ApiError(403, "Only the owner may change this item");
    return result.rows[0];
}
export const recordSelect = `SELECT r.*,row_to_json(o) AS "objectType",${primaryImageSelect},
    (SELECT json_build_object('id',u.id,'name',u.name,'imageUrl',u.image_url)
        FROM users u WHERE u.id=r.user_id) AS "user",
    coalesce((SELECT json_agg(json_build_object(
        'id',i.id,'recordId',i.record_id,'content',i.content,'translation',i.translation,
        'language',i.language,'script',i.script,'serifsPresent',i.serifs_present,
        'stopmarksPresent',i.stopmarks_present) ORDER BY i.id)
        FROM inscriptions i WHERE i.record_id=r.id),'[]') AS inscriptions
    FROM records r LEFT JOIN object_types o ON o.id=r.object_type_id`;
export async function record(c: Connection, id: string) {
    return camel((await c.query(recordSelect + " WHERE r.id=$1", [id])).rows[0]);
}
export async function event(c: Connection, id: string, owner: string, action: string, summary: string) {
    await c.query("UPDATE records SET updated_at=now() WHERE id=$1", [id]);
    await c.query(`INSERT INTO research_history(record_id,owner_id,actor_id,action,summary) VALUES($1,$2,$2,$3,$4)`, [id, owner, action, summary]);
}

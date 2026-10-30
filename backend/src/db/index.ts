import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { ENV } from "../config/env";

if (!ENV.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set in environment variables")
}

const databaseSchema = process.env.DATABASE_SCHEMA;
if (databaseSchema && (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(databaseSchema) || /^pg_/i.test(databaseSchema) || databaseSchema.toLowerCase() === 'information_schema')) throw new Error('Invalid DATABASE_SCHEMA');
export const pool = new Pool({ connectionString: ENV.DATABASE_URL,
    ...(databaseSchema ? { options: '-c search_path=' + databaseSchema + ',pg_catalog' } : {}) });


pool.on("connect", () => {
    console.log("Database connected successfuly");
})

pool.on("error", (err) => {
    console.error("Database connected error:", err);
})

export const db = drizzle({ client:pool, schema });


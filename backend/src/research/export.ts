import type { PoolClient } from "pg";
import { ApiError, allColumns, camel, csvCell, parseSearch } from "./validation";
import { recordSelect } from "./database";
// Cursor bounds node memory even for legacy records with unusually large text.
// PostgreSQL measures each row before sending it to the application.
export async function prepareExport(c: PoolClient, search: ReturnType<typeof parseSearch>, format: "json" | "csv") {
    const total = Number((await c.query("SELECT count(*) FROM records r " + search.where, search.values)).rows[0].count);
    if (total > 1000)
        throw new ApiError(413, "Export limited to 1000 records; narrow filters or select IDs");
    await c.query(`DECLARE research_export NO SCROLL CURSOR FOR SELECT CASE WHEN octet_length(row_to_json(e)::text)<=1048576 THEN row_to_json(e) ELSE NULL END AS payload FROM (${recordSelect} ${search.where} ORDER BY ${search.order} LIMIT 1000) e`, search.values);
    const keys = [...Object.keys(allColumns), "inscriptions"];
    const chunks: Buffer[] = [];
    let size = 0, first = true;
    const append = (s: string) => {
        const b = Buffer.from(s);
        size += b.length;
        if (size > 4 * 1024 * 1024)
            throw new ApiError(413, "Export exceeds 4 MiB; narrow filters or select fewer IDs");
        chunks.push(b);
    };
    append(format === "json" ? "[" : "\uFEFF" + keys.map(csvCell).join(",") + "\r\n");
    try {
        for (;;) {
            const result = await c.query("FETCH FORWARD 5 FROM research_export");
            if (!result.rowCount)
                break;
            for (const row of result.rows) {
                if (!row.payload)
                    throw new ApiError(413, "A record exceeds the export size budget");
                const item = camel(row.payload);
                if (format === "json")
                    append((first ? "" : ",") + JSON.stringify(item));
                else
                    append(keys.map(k => csvCell(item[k])).join(",") + "\r\n");
                first = false;
            }
        }
        if (format === "json")
            append("]");
        return Buffer.concat(chunks, size);
    }
    finally {
        await c.query("CLOSE research_export");
    }
}

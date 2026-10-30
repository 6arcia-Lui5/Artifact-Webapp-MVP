import * as XLSX from "xlsx";
import { inflateRawSync } from "node:zlib";
import { ApiError, columns, sourceUrl, year } from "./validation";
import { normalizeImportHeader } from "../lib/recordValidation";
export function checkWorkbook(buffer: Buffer) {
    if (buffer.subarray(0, 2).toString() !== "PK")
        return;
    let total = 0, count = 0;
    for (let p = 0; p + 46 <= buffer.length; p++) {
        if (buffer.readUInt32LE(p) !== 33639248)
            continue;
        const flags = buffer.readUInt16LE(p + 8), method = buffer.readUInt16LE(p + 10), compressed = buffer.readUInt32LE(p + 20), size = buffer.readUInt32LE(p + 24), names = buffer.readUInt16LE(p + 28), extra = buffer.readUInt16LE(p + 30), comment = buffer.readUInt16LE(p + 32), offset = buffer.readUInt32LE(p + 42);
        if (flags & 1 || size === 4294967295 || compressed === 4294967295 || ![0, 8].includes(method))
            throw new ApiError(400, "Unsupported spreadsheet archive");
        total += size;
        count++;
        if (total > 16 * 1024 * 1024 || count > 200 || size > 8 * 1024 * 1024)
            throw new ApiError(413, "Spreadsheet expansion is too large");
        if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 67324752)
            throw new ApiError(400, "Invalid spreadsheet archive");
        const dataOffset = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
        if (dataOffset + compressed > buffer.length)
            throw new ApiError(400, "Invalid spreadsheet archive");
        try {
            const packed = buffer.subarray(dataOffset, dataOffset + compressed);
            const decoded = method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: Math.max(1, size + 1) });
            if (decoded.length !== size)
                throw Error();
        }
        catch {
            throw new ApiError(400, "Invalid spreadsheet expansion");
        }
        p += 45 + names + extra + comment;
    }
    if (!count)
        throw new ApiError(400, "Invalid workbook");
}
const aliases: Record<string, string> = {
    "item name": "itemName",
    title: "itemName",
    "object type": "objectTypeName",
    "museum or institute's name": "museumName",
    museum: "museumName",
    city: "museumCity",
    country: "museumCountry",
    "museum or institute number": "museumNumber",
    "accession number": "museumNumber",
    "unique identifier within hhw (assigned)": "hhwIdentifier",
    hhw: "hhwIdentifier",
    "date/culture/time period": "dateCulturePeriod",
    "image source url": "imageSourceUrl",
};
const protectedFields = new Set([
    "id", "userId", "createdAt", "updatedAt", "collectionId", "revision",
    "reviewStatus", "reviewNotes", "reviewerId", "reviewedAt",
    "sourceProvenance", "sourceProvider", "sourceObjectId", "sourceUrl", "sourceRetrievedAt",
]);
const inscriptionFields = new Set([
    "inscriptionContent", "inscriptionLanguage", "inscriptionScript", "inscriptionTranslation",
]);
Object.assign(aliases, {
    "inscription content": "inscriptionContent",
    "inscription text": "inscriptionContent",
    "original inscription": "inscriptionContent",
    "original inscription text": "inscriptionContent",
    "inscription language": "inscriptionLanguage",
    "inscription script": "inscriptionScript",
    "inscription translation": "inscriptionTranslation",
});
export function spreadsheetRows(buffer: Buffer, filename: string, mappingInput: any = {}) {
    if (buffer.length > 4 * 1024 * 1024)
        throw new ApiError(413, "File too large");
    if (!/\.(csv|xlsx)$/i.test(filename))
        throw new ApiError(400, "Choose CSV or XLSX");
    if (/\.xlsx$/i.test(filename) && buffer.subarray(0, 2).toString() !== "PK")
        throw new ApiError(400, "Invalid XLSX");
    checkWorkbook(buffer);
    if (!mappingInput || typeof mappingInput !== "object" || Array.isArray(mappingInput))
        throw new ApiError(400, "Invalid mapping");
    const csv = /\.csv$/i.test(filename);
    const workbook = XLSX.read(csv ? buffer.toString("utf8") : buffer, {
        type: csv ? "string" : "buffer",
        raw: csv,
        dense: true,
        sheetRows: 502,
        cellHTML: false,
        cellFormula: false,
        cellStyles: false,
    });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet)
        throw new ApiError(400, "Empty spreadsheet");
    const grid = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: false, blankrows: false });
    if (grid.length > 501)
        throw new ApiError(413, "At most 500 data rows");
    const headers = (grid.shift() ?? []).map(v => String(v ?? "").trim());
    if (headers.length > 100 || new Set(headers).size !== headers.length)
        throw new ApiError(400, "At most 100 unique columns");
    const allowed = new Set([
        ...Object.keys(columns).filter(k => !protectedFields.has(k)),
        "objectTypeName", "dateStart", "dateEnd", ...inscriptionFields,
    ]);
    const mapping: Record<string, string> = {};
    headers.forEach(h => {
        const normalized = normalizeImportHeader(h);
        const field = mappingInput[h] ?? aliases[normalized] ?? [...allowed].find(k => normalizeImportHeader(k) === normalized);
        if (field) {
            if (!allowed.has(field))
                throw new ApiError(400, "Mapping contains a protected/unknown field");
            mapping[h] = field;
        }
    });
    if (new Set(Object.values(mapping)).size !== Object.values(mapping).length)
        throw new ApiError(400, "Multiple columns map to the same field");
    const rows = grid.map((row, n) => {
        const data: any = Object.fromEntries([...allowed].filter(k => k !== "objectTypeName" && !inscriptionFields.has(k)).map(k => [k, null]));
        const literal: Record<string, string> = {};
        data.inscribed = null;
        data.imagery = null;
        const warnings = ["Draft import; identity matches require review and are skipped, never overwritten."];
        const errors: string[] = [];
        headers.forEach((h, i) => {
            const field = mapping[h];
            if (!field)
                return;
            const v = row[i];
            try {
                if (v == null || !String(v).trim())
                    return;
                if (inscriptionFields.has(field)) {
                    if (String(v).length > 10000)
                        throw Error("Inscription fields must be at most 10000 characters");
                    // Preserve published literal text, including Unicode and line breaks.
                    literal[field] = String(v);
                    return;
                }
                if (String(v).length > 16000)
                    throw Error("Field too long");
                if (["inscribed", "imagery"].includes(field)) {
                    if (!/^(yes|no|y|n|true|false|0|1)$/i.test(String(v)))
                        throw Error("Invalid boolean");
                    data[field] = /^(yes|y|true|1)$/i.test(String(v));
                }
                else if (["dateStart", "dateEnd"].includes(field))
                    data[field] = year(String(v).trim());
                else if (field === "imageSourceUrl")
                    data[field] = sourceUrl(v);
                else
                    data[field] = String(v).trim();
            }
            catch (e: any) {
                errors.push(h + ": " + e.message);
            }
        });
        if (!data.itemName)
            errors.push("Item Name is required");
        if (data.dateStart != null && data.dateEnd != null && data.dateStart > data.dateEnd)
            errors.push("Date start must not follow date end");
        if (data.objectTypeId && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(data.objectTypeId))
            errors.push("Invalid object type ID");
        if (Object.keys(literal).length) {
            const missing = ["inscriptionContent", "inscriptionLanguage", "inscriptionScript"]
                .filter(field => !literal[field]?.trim());
            if (missing.length) {
                errors.push("Literal inscription requires original content, language and script; missing: " + missing.join(", "));
            }
            else if (data.inscribed === false) {
                errors.push("Literal inscription conflicts with Inscribed=false");
            }
            else {
                data.inscribed = true;
                data.inscriptions = [{
                    content: literal.inscriptionContent,
                    language: literal.inscriptionLanguage.trim(),
                    script: literal.inscriptionScript.trim(),
                    translation: literal.inscriptionTranslation ?? null,
                    serifsPresent: false,
                    stopmarksPresent: false,
                }];
            }
        }
        if (data.inscribed && !data.inscriptions && !Object.keys(literal).length)
            warnings.push("No literal transcription supplied; add original inscriptions after import.");
        return { rowNumber: n + 2, data, warnings, errors };
    });
    if (!rows.length)
        throw new ApiError(400, "No data rows");
    return { columns: headers, mapping, rows };
}

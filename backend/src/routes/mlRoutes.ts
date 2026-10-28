import { Router, type Request, type Response } from "express";
import * as queries from "../db/queries";
import { ENV } from "../config/env";

// Bridge to the Python ML service in /ml (FastAPI, default port 8001).
// The ML service predicts an inscription's date and region from its text
// and flags records whose listed values disagree.

const router = Router();
const ML_URL = ENV.ML_SERVICE_URL || "http://localhost:8001";

// Turn free-text dating ("2nd century CE", "100-200 CE", "1st c. BCE")
// into a year range. Returns nulls when nothing can be read.
export function parseDating(text?: string | null): { notBefore: number | null; notAfter: number | null } {
    const unknown = { notBefore: null, notAfter: null };
    if (!text) return unknown;
    const normalized = text.trim().toLowerCase().replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ");
    // Require an explicit era and a whole supported format. Avoid silently
    // treating museum numbers, mixed BCE/CE spans or prose as dates.
    const century = normalized.match(/^(\d{1,2})(?:st|nd|rd|th)?(?:\s*(?:-|to)\s*(\d{1,2})(?:st|nd|rd|th)?)?\s*(?:century|centuries|c\.?)\s*(bce|bc|ce|ad)$/);
    if (century) {
        const lo = Math.min(Number(century[1]), Number(century[2] || century[1]));
        const hi = Math.max(Number(century[1]), Number(century[2] || century[1]));
        if (lo === 0) return unknown;
        return century[3].startsWith("b")
            ? { notBefore: -hi * 100, notAfter: -(lo - 1) * 100 - 1 }
            : { notBefore: (lo - 1) * 100 + 1, notAfter: hi * 100 };
    }
    const years = normalized.match(/^(\d{1,4})(?:\s*(?:-|to)\s*(\d{1,4}))?\s*(bce|bc|ce|ad)$/);
    if (!years || Number(years[1]) === 0 || Number(years[2] || years[1]) === 0) return unknown;
    const sign = years[3].startsWith("b") ? -1 : 1;
    const first = Number(years[1]) * sign, last = Number(years[2] || years[1]) * sign;
    return { notBefore: Math.min(first, last), notAfter: Math.max(first, last) };
}

async function callMl(path: string, body: unknown) {
    const r = await fetch(`${ML_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`ML service returned ${r.status}`);
    return r.json();
}

// POST /api/ml/check  { text, not_before?, not_after?, region? }
router.post("/check", async (req: Request, res: Response) => {
    try {
        res.json(await callMl("/check", req.body));
    } catch (e) {
        res.status(502).json({ error: "ML service unavailable", detail: String(e) });
    }
});

// GET /api/ml/records/:id/check  - check a stored record's inscriptions
router.get("/records/:id/check", async (req: Request, res: Response) => {
    try {
        const record = await queries.getRecordById(String(req.params.id));
        if (!record) return res.status(404).json({ error: "Record not found" });
        const texts = (record.inscriptions || []).map(i => i.content).filter(Boolean);
        if (!texts.length) return res.status(400).json({ error: "Record has no inscription text" });

        const { notBefore, notAfter } = parseDating(record.dateCulturePeriod);
        const supportedDate = notBefore !== null && notAfter !== null && notBefore >= -800 && notAfter <= 1000;
        const listedRegion = record.productionPlace || record.findspot || null;
        const result = await callMl("/check", {
            id: record.id,
            text: texts.join(" "),
            not_before: supportedDate ? notBefore : null,
            not_after: supportedDate ? notAfter : null,
            region: listedRegion,
        });
        res.json({
            recordId: record.id, listedDating: record.dateCulturePeriod, listedRegion,
            dateNote: supportedDate ? null : notBefore === null
                ? "The catalog date was not parsed. Use an explicit range such as 100-200 CE or 2nd century BCE; date metadata was not checked."
                : "The catalog date is outside the model's supported range; date metadata was not checked.",
            ...result,
        });
    } catch (e) {
        res.status(502).json({ error: "ML check failed", detail: String(e) });
    }
});

export default router;

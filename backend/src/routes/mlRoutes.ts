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
    if (!text) return { notBefore: null, notAfter: null };
    const t = text.toLowerCase();
    const bce = /\b(bce|bc|b\.c\.)\b/.test(t);
    const sign = bce ? -1 : 1;

    // "2nd century", "2nd-3rd century", "5th to 4th c." -> list of centuries
    const cent: number[] = [];
    for (const m of t.matchAll(/(\d{1,2})(?:st|nd|rd|th)?(?:\s*(?:-|–|to)\s*(\d{1,2})(?:st|nd|rd|th))?\s*(?:c\b|c\.|cent)/g)) {
        cent.push(parseInt(m[1], 10));
        if (m[2]) cent.push(parseInt(m[2], 10));
    }
    if (cent.length) {
        const lo = Math.min(...cent), hi = Math.max(...cent);
        if (bce) return { notBefore: -hi * 100, notAfter: -(lo - 1) * 100 - 1 };
        return { notBefore: (lo - 1) * 100 + 1, notAfter: hi * 100 };
    }
    const years = [...t.matchAll(/\b(\d{1,4})\b/g)].map(m => parseInt(m[1], 10) * sign);
    if (years.length) return { notBefore: Math.min(...years), notAfter: Math.max(...years) };
    return { notBefore: null, notAfter: null };
}

async function callMl(path: string, body: unknown) {
    const r = await fetch(`${ML_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
        const result = await callMl("/check", {
            id: record.id,
            text: texts.join(" "),
            not_before: notBefore,
            not_after: notAfter,
            region: record.productionPlace || record.findspot || null,
        });
        res.json({ recordId: record.id, listedDating: record.dateCulturePeriod, ...result });
    } catch (e) {
        res.status(502).json({ error: "ML check failed", detail: String(e) });
    }
});

export default router;

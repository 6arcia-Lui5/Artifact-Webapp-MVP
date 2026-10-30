import { Router } from "express";
import sharp from "sharp";

// This is a narrow authenticated Met image gateway, not an arbitrary URL proxy.
// Met's image CDN does not allow browser fetches, although ordinary <img> works.
// Source downloads stay server-side; the normalized response is still <=3.5 MiB.
// The plaque's 4000px original is 8.6 MiB; its thumbnail is only 600px wide.
const MAX_BYTES = 12 * 1024 * 1024;
async function bytes(response: globalThis.Response, limit: number) {
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel().catch(() => {});
    throw new Error();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > limit) throw new Error();
      chunks.push(result.value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

const router = Router();
router.get("/museum-image/:objectId", async (req, res) => {
  if (!/^\d{1,9}$/.test(String(req.params.objectId))) {
    res.status(400).json({ error: "Choose a valid Met collection object." }); return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  const close = () => { if (!res.writableEnded) controller.abort(); };
  res.once("close", close);
  try {
    const object = JSON.parse((await bytes(await fetch(
      `https://collectionapi.metmuseum.org/public/collection/v1/objects/${req.params.objectId}`,
      { signal: controller.signal, redirect: "error" },
    ), 256 * 1024)).toString("utf8"));
    const imageUrl = new URL(object.primaryImage || object.primaryImageSmall);
    if (imageUrl.protocol !== "https:" || imageUrl.hostname !== "images.metmuseum.org" || imageUrl.port ||
        imageUrl.username || imageUrl.password || imageUrl.search || imageUrl.hash ||
        !imageUrl.pathname.startsWith("/CRDImages/")) throw new Error();
    const original = await bytes(await fetch(imageUrl, { signal: controller.signal, redirect: "error" }), MAX_BYTES);
    const image = sharp(original, { limitInputPixels: 20_000_000, failOn: "warning" });
    const meta = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format || "") || (meta.pages || 1) !== 1 || !meta.width || !meta.height) throw new Error();
    const scale = Math.min(1, 2400 / Math.max(meta.width, meta.height), Math.sqrt(4_000_000 / (meta.width * meta.height)));
    const bound = Math.max(1, Math.floor(Math.max(meta.width, meta.height) * scale));
    const prepared = await image.rotate().resize({ width: bound, height: bound, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "white" }).jpeg({ quality: 90 }).toBuffer();
    if (prepared.length > 3.5 * 1024 * 1024) throw new Error();
    if (!controller.signal.aborted) res.type("image/jpeg").setHeader("Cache-Control", "private, max-age=300");
    if (!controller.signal.aborted) res.send(prepared);
  } catch {
    if (!res.destroyed && !res.headersSent) res.status(502).json({ error: "The museum photo could not be loaded. Download it and choose the local file instead." });
  } finally { clearTimeout(timer); res.off("close", close); }
});
export default router;

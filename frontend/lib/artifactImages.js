export function sourceUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function metObjectId(value) {
  const source = sourceUrl(value);
  if (!source) return null;
  const url = new URL(source);
  if (!["www.metmuseum.org", "metmuseum.org"].includes(url.hostname)) return null;
  return url.pathname.match(/^\/art\/collection\/(?:search\/)?(\d+)\/?$/)?.[1] ?? null;
}

export async function resolveMetImage(objectId, signal) {
  const response = await fetch(
    `https://collectionapi.metmuseum.org/public/collection/v1/objects/${objectId}`,
    { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), credentials: "omit", referrerPolicy: "no-referrer" },
  );
  if (!response.ok) throw new Error("The museum image is unavailable.");
  const object = await response.json();
  return sourceUrl(object.primaryImageSmall) || sourceUrl(object.primaryImage);
}

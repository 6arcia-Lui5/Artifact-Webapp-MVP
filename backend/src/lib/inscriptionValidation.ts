import type { NewInscription } from "../db/schema";

export type InscriptionInput = Omit<NewInscription, "id" | "recordId" | "createdAt"> & { id?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Omission means preserve existing inscriptions; an explicit array replaces
// the set. Never accept a client-supplied parent, owner or creation timestamp.
export function readInscriptions(body: Record<string, unknown>, options: { draft?: boolean } = {}): {
    values?: InscriptionInput[]; error?: string;
} {
    if (!("inscriptions" in body)) return {};
    if (!Array.isArray(body.inscriptions) || body.inscriptions.length > 30)
        return { error: "Supply up to 30 inscription entries." };
    if (body.inscribed !== true && body.inscriptions.length)
        return { error: "Keep Inscribed checked while this artifact contains inscription entries." };
    const values: InscriptionInput[] = [];
    const ids = new Set<string>();
    for (const [index, input] of body.inscriptions.entries()) {
        const label = `Inscription ${index + 1}`;
        if (!input || typeof input !== "object" || Array.isArray(input))
            return { error: `${label}: supply text, language and script.` };
        for (const key of ["content", "language", "script"]) {
            if (options.draft && key !== "content" && (input[key] == null || (typeof input[key] === "string" && !input[key].trim()))) continue;
            if (typeof input[key] !== "string" || !input[key].trim())
                return { error: `${label}: ${key === "content" ? "original text" : key} is required.` };
        }
        for (const key of ["content", "language", "script", "translation"]) {
            if (options.draft && key !== "content" && input[key] === null) continue;
            if (input[key] !== undefined && (typeof input[key] !== "string" || input[key].length > 10000))
                return { error: `${label}: ${key} must be text of at most 10,000 characters.` };
        }
        if (input.id !== undefined && (typeof input.id !== "string" || !uuid.test(input.id) || ids.has(input.id)))
            return { error: `${label}: invalid or repeated inscription identifier.` };
        for (const key of ["serifsPresent", "stopmarksPresent"]) {
            if (input[key] !== undefined && !(options.draft && input[key] === null) && typeof input[key] !== "boolean")
                return { error: `${label}: ${key} must be true or false.` };
        }
        if (input.id) ids.add(input.id);
        values.push({
            ...(input.id ? { id: input.id } : {}),
            // Validate nonblank content above, but preserve literal text on an unchanged save.
            content: input.content, language: input.language?.trim() || null, script: input.script?.trim() || null,
            translation: input.translation ?? (options.draft ? null : ""),
            serifsPresent: input.serifsPresent ?? (options.draft ? null : false),
            stopmarksPresent: input.stopmarksPresent ?? (options.draft ? null : false),
        });
    }
    return { values };
}

import type { NewInscription } from "../db/schema";

export type InscriptionInput = Omit<NewInscription, "id" | "recordId" | "createdAt"> & { id?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Omission means preserve existing inscriptions; an explicit array replaces
// the set. Never accept a client-supplied parent, owner or creation timestamp.
export function readInscriptions(body: Record<string, unknown>): {
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
            if (typeof input[key] !== "string" || !input[key].trim())
                return { error: `${label}: ${key === "content" ? "original text" : key} is required.` };
        }
        for (const key of ["content", "language", "script", "translation"]) {
            if (input[key] !== undefined && (typeof input[key] !== "string" || input[key].length > 10000))
                return { error: `${label}: ${key} must be text of at most 10,000 characters.` };
        }
        if (input.id !== undefined && (typeof input.id !== "string" || !uuid.test(input.id) || ids.has(input.id)))
            return { error: `${label}: invalid or repeated inscription identifier.` };
        for (const key of ["serifsPresent", "stopmarksPresent"]) {
            if (input[key] !== undefined && typeof input[key] !== "boolean")
                return { error: `${label}: ${key} must be true or false.` };
        }
        if (input.id) ids.add(input.id);
        values.push({
            ...(input.id ? { id: input.id } : {}),
            content: input.content.trim(), language: input.language.trim(), script: input.script.trim(),
            translation: input.translation?.trim() || "",
            serifsPresent: input.serifsPresent ?? false, stopmarksPresent: input.stopmarksPresent ?? false,
        });
    }
    return { values };
}

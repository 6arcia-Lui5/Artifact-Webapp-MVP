export const requiredRecordFields: Record<string, string> = {
    itemName: "Item Name",
    objectTypeId: "Object Type",
    museumName: "Museum or Institute's Name",
    museumCity: "City",
    museumCountry: "Country",
    museumNumber: "Museum or Institute Number",
    dateCulturePeriod: "Date / Culture / Time Period",
    materials: "Materials",
    dimensions: "Dimensions",
};

export function recordValidationError(data: Record<string, unknown>, options: {
    partial?: boolean;
    objectTypeMode?: "id" | "name";
} = {}): string | null {
    for (const key of ["inscribed", "imagery"]) {
        if (options.objectTypeMode !== "name" && key in data && typeof data[key] !== "boolean")
            return `${key} must be true or false.`;
    }
    for (const [key, label] of Object.entries(requiredRecordFields)) {
        if (options.partial && !(key in data)) continue;
        if (typeof data[key] !== "string" || !data[key].trim()) return `${label} is required.`;
    }
    if (options.objectTypeMode !== "name" && data.objectTypeId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(data.objectTypeId))) {
        return "Choose an existing Object Type or create it before saving.";
    }
    const source = data.imageSourceUrl;
    if (source !== null && source !== undefined && source !== "") {
        try {
            const url = new URL(String(source).trim());
            if (!["http:", "https:"].includes(url.protocol)) throw new Error();
        } catch {
            return "Image Source URL must be an http or https URL, not an image description.";
        }
    }
    return null;
}

export function normalizeImportHeader(header: string): string {
    return header.replace(/[\u2018\u2019]/g, "'").replace(/^\uFEFF/, "")
        .trim().replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/").toLowerCase();
}

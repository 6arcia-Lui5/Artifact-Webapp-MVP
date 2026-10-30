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
    draft?: boolean;
    objectTypeMode?: "id" | "name";
} = {}): string | null {
    for (const key of ["inscribed", "imagery"]) {
        if (options.draft && data[key] === null) continue;
        if (options.objectTypeMode !== "name" && key in data && typeof data[key] !== "boolean")
            return `${key} must be true or false.`;
    }
    for (const [key, label] of Object.entries(requiredRecordFields)) {
        if (options.partial && !(key in data)) continue;
        if (options.draft && key !== 'itemName' && (data[key] === null || data[key] === undefined || data[key] === '')) continue;
        if (typeof data[key] !== "string" || !data[key].trim()) return `${label} is required.`;
    }
    if (options.objectTypeMode !== "name" && data.objectTypeId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(data.objectTypeId))) {
        return "Choose an existing Object Type or create it before saving.";
    }
    for (const key of ['dateStart','dateEnd']) {
        if (data[key] !== undefined && data[key] !== null && (!Number.isInteger(data[key]) || Math.abs(Number(data[key])) > 1000000)) return key + ' must be a signed integer year.';
    }
    if (data.dateStart != null && data.dateEnd != null && Number(data.dateStart) > Number(data.dateEnd)) return 'Date start must not follow date end.';
    for (const [key,value] of Object.entries(data)) {
        if (typeof value === 'string' && value.length > 16000) return key + ' must be at most 16,000 characters.';
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

export function normalizeDraftFields<T extends Record<string,unknown>>(data:T):T {const result={...data};for(const key of Object.keys(requiredRecordFields)){if(key!=='itemName'&&key in result&&typeof result[key]==='string'&&!String(result[key]).trim())(result as Record<string,unknown>)[key]=null;}return result;}

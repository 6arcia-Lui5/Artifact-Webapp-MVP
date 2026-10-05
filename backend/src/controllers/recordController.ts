import type { Request, Response } from "express"
import * as queries from "../db/queries"
import { getAuth } from "@clerk/express"
import * as XLSX from "xlsx"
import { db } from "../db";
import { objectTypes } from "../db/schema";

// Field map (Excel to DB)
const FIELD_MAP: Record<string, string> = {
    "Item Name": "itemName",

    "Unique Identifier within HHW (assigned)": "hhwIdentifier",

    "Object Type": "objectTypeId",

    "Museum or Institute’s Name": "museumName",
    "Museum Department (if known)": "museumDepartment",
    "City": "museumCity",
    "Country": "museumCountry",
    "Museum or Institute Number": "museumNumber",
    "Museum or Institute Description": "museumDescription",

    "Date/ Culture/ Time Period": "dateCulturePeriod",
    "Basis for dating (e.g. coin date)": "datingBasis",
    "Issuing Authority (if known)": "issuingAuthority",

    "Place of Production (if known)": "productionPlace",
    "Findspot": "findspot",
    "Acquisition date (if known)": "acquisitionDate",
    "Excavation information (if known)": "excavationInformation",

    "Materials": "materials",
    "Technique (if known)": "technique",
    "Dimensions": "dimensions",
    "Thickness": "thickness",
    "Weight": "weight",

    "Scientific Testing (if known, please add bibliography)": "scientificTesting",

    "Inscribed (Y/N)": "inscribed",
    "Imagery (Y/N)": "imagery",

    "Description of Imagery": "imageryDescription",

    "Placement of Imagery and Inscription {diagram}":
        "imageryInscriptionPlacement",

    "Image Source URL": "imageSourceUrl",
    "Image Type": "imageType",

    "Bibliography": "bibliography",
    "Image Copyright Details": "imageCopyrightDetails",
};





// Get all records
export const getAllRecords = async (req: Request, res: Response) => {
    try {
        const records = await queries.getAllRecords();
        res.status(200).json(records);
    } catch (error) {
        console.error("Error getting records:", error);
        res.status(500).json({error: "Failed to get records" })
    }
}

// Search records
export const searchRecords = async (req: Request, res: Response) => {
    try {
        const { query } = req.query;

        if (typeof query !== "string" || !query.trim()) {
            return res.status(400).json({
                error: "Search query is required",
            });
        }

        const records = await queries.searchRecords(query.trim());

        res.status(200).json(records);
    } catch (error) {
        console.error("Error searching records:", error);
        res.status(500).json({
            error: "Failed to search records",
        });
    }
};


export const getRecordById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const record = await queries.getRecordById(id.toString());

        if (!record) return res.status(404).json({ error: "Record not found" });

        return res.status(200).json(record);
    } catch(error) {
        console.error("Error getting collection by id:", error);
        res.status(500).json({ error: "Failed to get collection by id" });
    }
};


// Get user records
export const getMyRecords = async (req: Request, res: Response) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) return res.status(401).json({ error: "Unauthorize" });

        const records = await queries.getRecordsByUserId(userId);
        res.status(200).json(records);
    } catch (error) {
        console.error("Error getting user records:", error);
        res.status(500).json({error: "Failed to get user records" })
    }
};

// Create a new record
// export const createRecord = async (req: Request, res: Response) => {
//     try {
//         const { userId } = getAuth(req);
//         if (!userId) return res.status(401).json({ error: "Unauthorized" });

//         const { title, description, imageUrl, date, material, dimensions, classification, credit, objectNumber, collectionId } = req.body

//         if (!title || !description || !imageUrl || !date || !material || !dimensions || !classification || !credit || !objectNumber ) {
//             res.status(400).json({ error: "All fields required for a record" });
//             return;
//         }

//         const record = await queries.createRecord({
//             userId,
//             date,
//             imageUrl,
//             title,
//             description,
//             material,
//             dimensions,
//             classification,
//             credit,
//             objectNumber,
//             collectionId,
//         });

//         res.status(201).json(record);
//     } catch (error) {
//         console.error("Error creating records:", error);
//         res.status(500).json({error: "Failed to create records" })
//     }
// }

//New create record:

export const createRecord = async (req: Request, res: Response) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) return res.status(401).json({ error: "Unauthorized" });

        const payload = { userId, ...req.body };

        const record = await queries.createRecord(payload);

        res.status(201).json(record);
    } catch (error) {
        console.error("Error creating record:", error);
        res.status(500).json({ error: "Failed to create record" });
    }
};

// Update an existing record
// export const updateRecord = async (req: Request, res: Response) => {
//     try {
//         const { userId } = getAuth(req);
//         if (!userId) return res.status(401).json({ error: "Unauthorized" });

//         const { id } = req.params;
//         const { title, description, imageUrl, date, material, dimensions, classification, credit, objectNumber, collectionId } = req.body;

//         const existingRecord = await queries.getRecordById(id.toString());
//         if (!existingRecord) {
//             res.status(404).json({ error: "Record not found" });
//             return;
//         }

//         if (existingRecord.userId !== userId) {
//             res.status(403).json({ error: "You can only update your own records" });
//             return;
//         }

//         const record = await queries.updateRecord(id.toString(), {
//             date,
//             title,
//             description,
//             material,
//             dimensions,
//             classification,
//             credit,
//             objectNumber,
//             collectionId,
//             imageUrl,
//         })

//         res.status(200).json(record);
//     } catch (error) {
//         console.error("Error updating records:", error);
//         res.status(500).json({error: "Failed to update records" })
//     }
// }

//New update existing record
export const updateRecord = async (req: Request, res: Response) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) return res.status(401).json({ error: "Unauthorized" });

        const id  = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;;

        const existing = await queries.getRecordById(id);
        if (!existing) return res.status(404).json({ error: "Record not found" });

        if (existing.userId !== userId)
            return res.status(403).json({ error: "You can only update your own records" });

        const updated = await queries.updateRecord(id, req.body);

        res.status(200).json(updated);
    } catch (error) {
        console.error("Error updating record:", error);
        res.status(500).json({ error: "Failed to update record" });
    }
};

// Delete records
export const deleteRecord = async (req: Request, res: Response) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) return res.status(401).json({ error: "Unauthorized" });

        const { id } = req.params;

        const existingRecord = await queries.getRecordById(id.toString());
        if (!existingRecord) {
            res.status(404).json({ error: "Record not found" });
            return;
        }

        if (existingRecord.userId !== userId) {
            res.status(403).json({ error: "You can only delete your own records" });
            return;
        }

        await queries.deleteRecord(id.toString());
        res.status(200).json({ message: "record deleted successfully" });
    } catch (error) {
        console.error("Error deleting record:", error);
        res.status(500).json({ error: "Failed to delete record" });
    }
};

// Import records (Excel + CSV)
export const importRecords = async (req: Request, res: Response) => {
    try {
        const { userId } = getAuth(req);

        if (!userId) {
            return res.status(401).json({
                error: "Unauthorized",
            });
        }

        if (!req.file) {
            return res.status(400).json({
                error: "No file uploaded",
            });
        }

        const fileName = req.file.originalname.toLowerCase();
        const isCSV = fileName.endsWith(".csv");

        let rows: any[] = [];

        // ----------------------------------------
        // Parse CSV / Excel
        // ----------------------------------------

        if (isCSV) {
            const csvString = req.file.buffer.toString("utf-8");

            const workbook = XLSX.read(csvString, {
                type: "string",
            });

            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            rows = XLSX.utils.sheet_to_json(worksheet, {
                defval: null,
            });
        } else {
            const workbook = XLSX.read(req.file.buffer, {
                type: "buffer",
            });

            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            rows = XLSX.utils.sheet_to_json(worksheet, {
                defval: null,
            });
        }

        if (rows.length === 0) {
            return res.status(400).json({
                error: "File contains no records",
            });
        }

        // ----------------------------------------
        // Cache object types
        // ----------------------------------------

        const objectTypeCache = new Map<string, string>();

        const getOrCreateObjectType = async (
            objectTypeName: string
        ): Promise<string | null> => {
            const normalizedName = objectTypeName.trim();

            if (!normalizedName) {
                return null;
            }

            const cacheKey = normalizedName.toLowerCase();

            // Check cache
            const cachedId = objectTypeCache.get(cacheKey);

            if (cachedId) {
                return cachedId;
            }

            // Check database
            const existingType =
                await db.query.objectTypes.findFirst({
                    where: (objectTypes, { eq }) =>
                        eq(objectTypes.name, normalizedName),
                });

            if (existingType) {
                objectTypeCache.set(cacheKey, existingType.id);

                return existingType.id;
            }

            // Create new object type
            const [newType] = await db
                .insert(objectTypes)
                .values({
                    name: normalizedName,
                })
                .returning();

            objectTypeCache.set(cacheKey, newType.id);

            return newType.id;
        };

        // ----------------------------------------
        // Map CSV rows to database records
        // ----------------------------------------

        const mappedRecords = [];

        for (const row of rows) {
            const mapped: any = {
                userId,
            };

            for (const [csvKey, dbKey] of Object.entries(FIELD_MAP)) {
                // Never allow CSV to set database ID
                if (dbKey === "id") {
                    continue;
                }

                const value = row[csvKey];

                // --------------------------------
                // Object Type
                // --------------------------------
                if (dbKey === "objectTypeId") {
                    if (
                        value !== null &&
                        value !== undefined &&
                        String(value).trim() !== ""
                    ) {
                        mapped.objectTypeId =
                            await getOrCreateObjectType(
                                String(value)
                            );
                    } else {
                        mapped.objectTypeId = null;
                    }

                    continue;
                }

                // --------------------------------
                // Boolean fields
                // --------------------------------
                if (
                    dbKey === "inscribed" ||
                    dbKey === "imagery"
                ) {
                    if (
                        value === null ||
                        value === undefined ||
                        String(value).trim() === ""
                    ) {
                        mapped[dbKey] = false;
                    } else {
                        const normalized = String(value)
                            .trim()
                            .toLowerCase();

                        mapped[dbKey] =
                            normalized === "y" ||
                            normalized === "yes" ||
                            normalized === "true" ||
                            normalized === "1";
                    }

                    continue;
                }

                // --------------------------------
                // Normal fields
                // --------------------------------
                mapped[dbKey] = value ?? null;
            }

            mappedRecords.push(mapped);
        }

        // ----------------------------------------
        // Insert
        // ----------------------------------------

        const inserted =
            await queries.createRecordsBatch(mappedRecords);

        return res.status(201).json({
            message: "Records imported successfully",
            count: inserted.length,
            records: inserted,
        });
    } catch (error) {
        console.error("Error importing records:", error);

        return res.status(500).json({
            error: "Failed to import records",
        });
    }
};


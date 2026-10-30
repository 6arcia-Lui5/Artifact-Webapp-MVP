import { catalogAccess, elevated, visibilitySql } from "../research/access";
import { recordSelect } from "../research/database";
import { ApiError, camel } from "../research/validation";
import { db, pool } from "./index";
import { and, eq, notInArray, or, sql } from "drizzle-orm";
import type { InscriptionInput } from "../lib/inscriptionValidation";
import { users, records, collections, type NewUser, type NewRecord, type NewCollection, type NewInscription, objectTypes, inscriptions } from "./schema";


const visibleRecords = (r: Pick<typeof records, 'moderationStatus' | 'userId'> = records) => {
    const access = catalogAccess();
    return elevated(access) ? sql`true` : or(eq(r.moderationStatus, 'approved'), eq(r.userId, access.userId));
};
const setActor = async (tx: any) => {
    const actor = catalogAccess().userId;
    if (actor) await tx.execute(sql`SELECT set_config('research.actor', ${actor}, true)`);
};

// User queries
export const createUser = async (data: NewUser) => {
    const [user] = await db.insert(users).values(data).returning();
    return user;
}

export const getUserById = async (id: string) => {
    return db.query.users.findFirst({ where: eq(users.id, id) });
};

export const updateUser = async (id: string, data:Partial<NewUser>) => {
    const existingUser = await getUserById(id);
    if (!existingUser) {
        throw new Error(`User with id ${id} not found`);
    }
    const [user] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return user;
};

export const upsertUser = async (data:NewUser) => {
    // Originally done - provides a race condition if two requests try to upsert the same user at the same time
    // const existingUser = await getUserById(data.id);
    // if (existingUser) {
    //     return updateUser(data.id, data);
    // }
    // return createUser(data);

    // Updated upsert method
    const [user] = await db.insert(users).values(data).onConflictDoUpdate({
        target: users.id,
        set: data,
    }).returning();
    return user;
}

//Collection queries===================================================
export const createCollection = async(data:NewCollection) => {
    const [collection] = await db.insert(collections).values(data).returning();
    return collection;
};

//gets collection info for cards
export const getAllCollections = async() => {
    return readableCollections();
}

//Used in collection page for all collection details
export const getCollectionById = async(id: string) => {
    return (await readableCollections(id))[0];
};

async function readableCollections(id?: string) {
    const access = catalogAccess();
    const visible = visibilitySql('r', '$1', access);
    const membership = 'EXISTS(SELECT 1 FROM research_memberships m WHERE m.collection_id=c.id AND m.record_id=r.id)';
    const result = await pool.query(`SELECT c.*,c.user_id AS "userId",c.time_period AS "timePeriod",c.image_url AS "imageUrl",
        (SELECT count(*)::int FROM records r WHERE ${membership} AND ${visible}) AS "recordCount",
        coalesce((SELECT json_agg(row_to_json(e)) FROM (${recordSelect} WHERE ${membership} AND ${visible}
            ORDER BY r.created_at DESC,r.id DESC LIMIT 100) e),'[]') AS records
        FROM collections c ${id ? 'WHERE c.id=$2' : ''} ORDER BY c."createdAt" DESC,c.id LIMIT 200`,
        id ? [access.userId, id] : [access.userId]);
    return result.rows.map(c => ({ ...c, records: c.records.map(camel) }));
}

export const deleteCollection = async(id: string) => {
    const existingCollection = await getCollectionById(id);
    if (!existingCollection) {
        throw new Error(`Collection with id ${id} not found`);
    }

    const [collection] = await db.delete(collections).where(eq(collections.id, id)).returning();
    return collection;
}

// Object type========================================
export const getAllObjectTypes = async () => {
    return db.query.objectTypes.findMany({
        orderBy: (objectTypes, { asc }) => [
            asc(objectTypes.name),
        ],
    });
};

export const getObjectTypeById = async (id: string) => {
    return db.query.objectTypes.findFirst({
        where: eq(objectTypes.id, id),
    });
};

export const createObjectType = async (name: string) => {
    const [objectType] = await db
        .insert(objectTypes)
        .values({ name })
        .returning();

    return objectType;
};


// Record queries=====================================
export const createRecord = async(data:NewRecord) => {
    return db.transaction(async tx => {
        await setActor(tx);
        const [record] = await tx.insert(records).values(data).returning();
        return record;
    });
};

export const createRecordWithInscriptions = async (data: NewRecord, entries: InscriptionInput[]) => {
    return db.transaction(async tx => {
        await setActor(tx);
        const [record] = await tx.insert(records).values(data).returning();
        const saved = entries.length ? await tx.insert(inscriptions).values(entries.map(entry => ({
            content: entry.content, language: entry.language, script: entry.script,
            translation: entry.translation, serifsPresent: entry.serifsPresent,
            stopmarksPresent: entry.stopmarksPresent, recordId: record.id,
        }))).returning() : [];
        const [current] = await tx.select().from(records).where(eq(records.id, record.id));
        return { ...current, inscriptions: saved };
    });
};

export const updateRecordWithInscriptions = async (id: string, data: Partial<NewRecord>, entries: InscriptionInput[], expectedRevision?: number) => {
    return db.transaction(async tx => {
        await setActor(tx);
        // Serialize edits to the parent and its children as one unit.
        const [existing] = await tx.select().from(records).where(eq(records.id, id)).for("update");
        if (!existing) throw new ApiError(404, "Record not found");
        if (expectedRevision !== undefined && existing.revision !== expectedRevision)
            throw new ApiError(409, "This artifact changed. Inspect the latest record before retrying your saved edits.");
        const savedEntries = await tx.select().from(inscriptions).where(eq(inscriptions.recordId, id));
        const knownIds = new Set(savedEntries.map(entry => entry.id));
        if (entries.some(entry => entry.id && !knownIds.has(entry.id)))
            throw new ApiError(409, "An inscription changed. Inspect the latest record before retrying your saved edits.");
        const [record] = await tx.update(records).set({ ...data, updatedAt: new Date() }).where(eq(records.id, id)).returning();
        const retained = entries.flatMap(entry => entry.id ? [entry.id] : []);
        await tx.delete(inscriptions).where(retained.length
            ? and(eq(inscriptions.recordId, id), notInArray(inscriptions.id, retained))
            : eq(inscriptions.recordId, id));
        for (const entry of entries) {
            const { id: inscriptionId, ...content } = entry;
            if (inscriptionId) {
                await tx.update(inscriptions).set(content)
                    .where(and(eq(inscriptions.id, inscriptionId), eq(inscriptions.recordId, id)));
            } else {
                await tx.insert(inscriptions).values({ ...content, recordId: id });
            }
        }
        const saved = await tx.select().from(inscriptions).where(eq(inscriptions.recordId, id));
        const [current] = await tx.select().from(records).where(eq(records.id, id));
        return { ...current, inscriptions: saved };
    });
};

//gets record info for cards
export const getAllRecords = async() => {
    return db.query.records.findMany({
        where: visibleRecords(),
        limit: 200,
        with: { user: true },
        orderBy: (records, {desc}) => [desc(records.createdAt)]
    });
}

export const searchRecords = async (query: string) => {
    const searchTerm = `%${query}%`;

    return db.query.records.findMany({
        limit: 200,
        where: (records, { or, ilike }) =>
            and(visibleRecords(), or(
                ilike(records.itemName, searchTerm),
                ilike(records.hhwIdentifier, searchTerm),
                ilike(records.museumName, searchTerm),
                ilike(records.museumDepartment, searchTerm),
                ilike(records.museumCity, searchTerm),
                ilike(records.museumCountry, searchTerm),
                ilike(records.museumNumber, searchTerm),
                ilike(records.museumDescription, searchTerm),
                ilike(records.dateCulturePeriod, searchTerm),
                ilike(records.datingBasis, searchTerm),
                ilike(records.issuingAuthority, searchTerm),
                ilike(records.productionPlace, searchTerm),
                ilike(records.findspot, searchTerm),
                ilike(records.acquisitionDate, searchTerm),
                ilike(records.excavationInformation, searchTerm),
                ilike(records.materials, searchTerm),
                ilike(records.technique, searchTerm),
                ilike(records.dimensions, searchTerm),
                ilike(records.thickness, searchTerm),
                ilike(records.weight, searchTerm),
                ilike(records.scientificTesting, searchTerm),
                ilike(records.imageryDescription, searchTerm),
                ilike(records.bibliography, searchTerm),
                ilike(records.imageCopyrightDetails, searchTerm)
            )),

        with: {
            user: true,
            objectType: true,
            inscriptions: true,
        },

        orderBy: (records, { desc }) => [
            desc(records.createdAt),
        ],
    });
};



//Used in record page for all details
// Get record by ID
export const getRecordById = async (id: string) => {
    return db.query.records.findFirst({
        where: and(eq(records.id, id), visibleRecords()),

        with: {
            user: true,
            objectType: true,
            collection: true,
            inscriptions: true,
        },
    });
};

// Get records belonging to a user
export const getRecordsByUserId = async (userId: string) => {
    return db.query.records.findMany({
        where: and(eq(records.userId, userId), visibleRecords()),
        limit: 200,

        with: {
            user: true,
            objectType: true,
            inscriptions: true,
        },

        orderBy: (records, { desc }) => [
            desc(records.createdAt),
        ],
    });
};

// Update record
export const updateRecord = async (
    id: string,
    data: Partial<NewRecord>,
    expectedRevision?: number
) => {
    const existingRecord = await getRecordById(id);

    if (!existingRecord) {
        throw new Error(`Record with id ${id} not found`);
    }

    return db.transaction(async tx => {
        await setActor(tx);
        const [existing] = await tx.select().from(records).where(eq(records.id, id)).for("update");
        if (!existing) throw new ApiError(404, "Record not found");
        if (expectedRevision !== undefined && existing.revision !== expectedRevision)
            throw new ApiError(409, "This artifact changed. Inspect the latest record before retrying your saved edits.");
        const [record] = await tx.update(records).set(data).where(eq(records.id, id)).returning();
        return record;
    });
};

// Delete record
export const deleteRecord = async (id: string) => {
    const existingRecord = await getRecordById(id);

    if (!existingRecord) {
        throw new Error(`Record with id ${id} not found`);
    }

    return db.transaction(async tx => {
        await setActor(tx);
        // Match the editor's parent-first lock order before removing children.
        await tx.select().from(records).where(eq(records.id, id)).for("update");
        await tx.delete(inscriptions).where(eq(inscriptions.recordId, id));
        const [record] = await tx.delete(records).where(eq(records.id, id)).returning();
        return record;
    });
};

// Inscription========================================
export const createInscription = async (
    data: NewInscription
) => {
    const [inscription] = await db
        .insert(inscriptions)
        .values(data)
        .returning();

    return inscription;
};

export const createInscriptionsBatch = async (
    data: NewInscription[]
) => {
    if (data.length === 0) {
        return [];
    }

    return db
        .insert(inscriptions)
        .values(data)
        .returning();
};

export const deleteInscription = async (id: string) => {
    const [inscription] = await db
        .delete(inscriptions)
        .where(eq(inscriptions.id, id))
        .returning();

    return inscription;
};

//Batch==========================================================

export const createRecordsBatch = async (data: NewRecord[]) => {
    return db.transaction(async tx => {
        await setActor(tx);
        return tx.insert(records).values(data).returning();
    });
};

export const getOrCreateObjectType = async (name: string) => {
    const trimmedName = name.trim();

    if (!trimmedName) {
        throw new Error("Object type name cannot be empty");
    }

    // Check whether it already exists
    const existing = await db.query.objectTypes.findFirst({
        where: eq(objectTypes.name, trimmedName),
    });

    if (existing) {
        return existing;
    }

    // Create it if it doesn't exist
    const [created] = await db
        .insert(objectTypes)
        .values({ name: trimmedName })
        .onConflictDoNothing({
            target: objectTypes.name,
        })
        .returning();

    // In case another request created it at the same time
    if (!created) {
        const existingAfterConflict =
            await db.query.objectTypes.findFirst({
                where: eq(objectTypes.name, trimmedName),
            });

        if (!existingAfterConflict) {
            throw new Error(
                `Could not create or find object type "${trimmedName}"`
            );
        }

        return existingAfterConflict;
    }

    return created;
};

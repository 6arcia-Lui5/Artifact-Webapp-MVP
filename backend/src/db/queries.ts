import { db } from "./index";
import { eq } from "drizzle-orm";
import { users, records, collections, type NewUser, type NewRecord, type NewCollection, type NewInscription, objectTypes, inscriptions } from "./schema";


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
    return db.query.collections.findMany({ 
        with: { records: true },
        orderBy: (collections, {desc}) => [desc(collections.createdAt)] 
    });
}

//Used in collection page for all collection details
export const getCollectionById = async(id: string) => {
    return db.query.collections.findFirst({ 
        where: eq(collections.id, id), 
        with: {
            records: true,
        },
    });
};

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
    const [record] = await db.insert(records).values(data).returning();
    return record;
};

//gets record info for cards
export const getAllRecords = async() => {
    return db.query.records.findMany({ 
        with: { user: true },
        orderBy: (records, {desc}) => [desc(records.createdAt)] 
    });
}

export const searchRecords = async (query: string) => {
    const searchTerm = `%${query}%`;

    return db.query.records.findMany({
        where: (records, { or, ilike }) =>
            or(
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
            ),

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
        where: eq(records.id, id),

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
        where: eq(records.userId, userId),

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
    data: Partial<NewRecord>
) => {
    const existingRecord = await getRecordById(id);

    if (!existingRecord) {
        throw new Error(`Record with id ${id} not found`);
    }

    const [record] = await db
        .update(records)
        .set(data)
        .where(eq(records.id, id))
        .returning();

    return record;
};

// Delete record
export const deleteRecord = async (id: string) => {
    const existingRecord = await getRecordById(id);

    if (!existingRecord) {
        throw new Error(`Record with id ${id} not found`);
    }

    const [record] = await db
        .delete(records)
        .where(eq(records.id, id))
        .returning();

    return record;
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
    const recordsCreated = await db
        .insert(records)
        .values(data)
        .returning();

    return recordsCreated;
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

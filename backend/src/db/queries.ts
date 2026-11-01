
import { db } from "./index";
import { eq, and, desc, isNull, count } from "drizzle-orm";

import {
    users,
    records,
    collections,
    type NewUser,
    type NewRecord,
    type NewCollection,
    type NewInscription,
    objectTypes,
    inscriptions,

    modificationRequests,
    modificationChanges,
    recordVersions,
    notifications,

    type NewModificationChange,
} from "./schema";


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


/* =========================================================
   MODIFICATION REQUEST QUERIES
========================================================= */

// Only these record fields can be modified through suggestions.
// Never allow contributors to change ownership, IDs, or timestamps.
const editableRecordFields = [
    "itemName",
    "hhwIdentifier",
    "objectTypeId",
    "museumName",
    "museumDepartment",
    "museumCity",
    "museumCountry",
    "museumNumber",
    "museumDescription",
    "dateCulturePeriod",
    "datingBasis",
    "issuingAuthority",
    "productionPlace",
    "findspot",
    "acquisitionDate",
    "excavationInformation",
    "materials",
    "technique",
    "dimensions",
    "thickness",
    "weight",
    "scientificTesting",
    "inscribed",
    "imagery",
    "imageryDescription",
    "imageryInscriptionPlacement",
    "imageSourceUrl",
    "imageType",
    "bibliography",
    "imageCopyrightDetails",
] as const;

type EditableRecordField = typeof editableRecordFields[number];

type ProposedFieldChange = {
    fieldName: EditableRecordField;
    proposedValue: string | boolean | null;
};

const booleanRecordFields = [
    "inscribed",
    "imagery",
] as const;

const requiredRecordFields = [
    "itemName",
    "objectTypeId",
    "museumName",
    "museumCity",
    "museumCountry",
    "museumNumber",
    "dateCulturePeriod",
    "materials",
    "dimensions",
] as const;

const isEditableRecordField = (
    fieldName: string
): fieldName is EditableRecordField => {
    return editableRecordFields.some((field) => field === fieldName);
};

const validateProposedFieldChange = (
    fieldName: string,
    proposedValue: unknown
): string | null => {
    if (!isEditableRecordField(fieldName)) {
        return `Field "${fieldName}" cannot be modified.`;
    }

    const isBooleanField = booleanRecordFields.some(
        (field) => field === fieldName
    );

    if (isBooleanField && typeof proposedValue !== "boolean") {
        return `Field "${fieldName}" must have a boolean value.`;
    }

    if (
        !isBooleanField &&
        proposedValue !== null &&
        typeof proposedValue !== "string"
    ) {
        return `Field "${fieldName}" must have a string or null value.`;
    }

    const isRequiredField = requiredRecordFields.some(
        (field) => field === fieldName
    );

    if (
        isRequiredField &&
        (proposedValue === null ||
            (typeof proposedValue === "string" && !proposedValue.trim()))
    ) {
        return `Field "${fieldName}" cannot be empty.`;
    }

    return null;
};



/**
 * Submit a modification request.
 *
 * One request can contain multiple proposed field changes.
 * Each change stores its own original value and proposed value.
 */
export const createModificationRequest = async (
    recordId: string,
    modifierId: string,
    changes: ProposedFieldChange[]
) => {
    if (changes.length === 0) {
        throw new Error("At least one proposed change is required.");
    }

    for (const change of changes) {
    const validationError = validateProposedFieldChange(
        change.fieldName,
        change.proposedValue
    );

    if (validationError) {
        throw new Error(validationError);
    }
}

    // Prevent duplicate proposals for the same field in one request.
    const fieldNames = changes.map(change => change.fieldName);

    if (new Set(fieldNames).size !== fieldNames.length) {
        throw new Error("A field can only be proposed once per request.");
    }

    return db.transaction(async (tx) => {
        const record = await tx.query.records.findFirst({
            where: eq(records.id, recordId),
        });

        if (!record) {
            throw new Error("Record not found.");
        }

        if (record.userId === modifierId) {
            throw new Error(
                "You cannot submit a modification request for your own record."
            );
        }

        for (const change of changes) {
            if (change.fieldName === "objectTypeId") {
                const objectType = await tx.query.objectTypes.findFirst({
                    where: eq(objectTypes.id, change.proposedValue as string),
                });

                if (!objectType) {
                    throw new Error("The selected object type does not exist.");
                }
            }
        }

        // Create the parent request.
        const [request] = await tx
            .insert(modificationRequests)
            .values({
                recordId,
                modifierId,
                publisherId: record.userId,
            })
            .returning();

        // Capture the actual current values from the database.
        const changesToInsert: NewModificationChange[] = changes.map(
            (change) => {
                const originalValue = record[change.fieldName];

                return {
                    requestId: request.id,
                    fieldName: change.fieldName,
                    originalValue,
                    proposedValue: change.proposedValue,
                };
            }
        );

        const insertedChanges = await tx
            .insert(modificationChanges)
            .values(changesToInsert)
            .returning();

        // Notify the original publisher.
        await tx.insert(notifications).values({
            recipientId: record.userId,
            type: "MODIFICATION_REQUEST",
            title: "New modification request",
            message: `Someone suggested ${changes.length} change(s) to your record "${record.itemName}".`,
            href: `/modifications/${request.id}/review`,
            relatedModificationRequestId: request.id,
        });

        return {
            ...request,
            changes: insertedChanges,
        };
    });
};


/**
 * Get one modification request with all relevant information.
 */
export const getModificationRequestById = async (id: string) => {
    return db.query.modificationRequests.findFirst({
        where: eq(modificationRequests.id, id),
        with: {
            record: true,
            modifier: true,
            publisher: true,
            changes: {
                with: {
                    reviewer: true,
                },
            },
        },
    });
};


/**
 * Get modification requests awaiting review by a publisher.
 */
export const getIncomingModificationRequests = async (
    publisherId: string
) => {
    return db.query.modificationRequests.findMany({
        where: eq(modificationRequests.publisherId, publisherId),

        with: {
            record: true,
            modifier: true,
            changes: true,
        },

        orderBy: [
            desc(modificationRequests.createdAt),
        ],
    });
};


/**
 * Get requests submitted by a contributor.
 */
export const getOutgoingModificationRequests = async (
    modifierId: string
) => {
    return db.query.modificationRequests.findMany({
        where: eq(modificationRequests.modifierId, modifierId),

        with: {
            record: true,
            publisher: true,
            changes: true,
        },

        orderBy: [
            desc(modificationRequests.createdAt),
        ],
    });
};


/**
 * Approve or reject one proposed field change.
 *
 * Decisions are independent: approving one field does not
 * automatically approve or reject the other fields.
 */
export const reviewModificationChange = async (
    requestId: string,
    changeId: string,
    reviewerId: string,
    decision: "APPROVED" | "REJECTED",
    rejectionReason?: string
) => {
    return db.transaction(async (tx) => {

        // Fetch the request.
        const request = await tx.query.modificationRequests.findFirst({
            where: eq(modificationRequests.id, requestId),
        });

        if (!request) {
            throw new Error("Modification request not found.");
        }

        // Only the original publisher can review the request.
        if (request.publisherId !== reviewerId) {
            throw new Error(
                "You are not authorized to review this modification request."
            );
        }

        // Lock the proposed change while reviewing it.
        const [change] = await tx
            .select()
            .from(modificationChanges)
            .where(
                and(
                    eq(modificationChanges.id, changeId),
                    eq(modificationChanges.requestId, requestId)
                )
            )
            .for("update");

        if (!change) {
            throw new Error("Modification change not found.");
        }

        if (change.status !== "PENDING") {
            throw new Error("This field has already been reviewed.");
        }

        // Fetch and lock the public record.
        const [record] = await tx
            .select()
            .from(records)
            .where(eq(records.id, request.recordId))
            .for("update");

        if (!record) {
            throw new Error("Associated record not found.");
        }

        // Validate the field again before updating.
        if (
            !editableRecordFields.includes(
                change.fieldName as EditableRecordField
            )
        ) {
            throw new Error("This field cannot be modified.");
        }

        const fieldName = change.fieldName as EditableRecordField;

        // Ensure the field has not changed since the suggestion.
        const currentValue = record[fieldName];

        if (
            JSON.stringify(currentValue) !==
            JSON.stringify(change.originalValue)
        ) {
            throw new Error(
                "This field has changed since the suggestion was submitted. The proposal is now outdated."
            );
        }

        const now = new Date();

        if (decision === "APPROVED") {

            // Update only the approved field.
            await tx
                .update(records)
                .set({
                    [fieldName]: change.proposedValue,
                } as Partial<NewRecord>)
                .where(eq(records.id, request.recordId));

            // Save the approved change in version history.
            await tx.insert(recordVersions).values({
                recordId: request.recordId,
                contributorId: request.modifierId,
                approvedBy: reviewerId,
                modificationChangeId: change.id,
                fieldName: change.fieldName,
                oldValue: change.originalValue,
                newValue: change.proposedValue,
            });
        }

        // Update the individual proposal.
        await tx
            .update(modificationChanges)
            .set({
                status: decision,
                reviewedBy: reviewerId,
                reviewedAt: now,
                rejectionReason:
                    decision === "REJECTED"
                        ? rejectionReason?.trim() || null
                        : null,
            })
            .where(eq(modificationChanges.id, change.id));

        // Determine the overall request status.
        const remainingChanges = await tx
            .select()
            .from(modificationChanges)
            .where(eq(modificationChanges.requestId, requestId));

        const hasPending = remainingChanges.some((item) =>
            item.id === change.id
                ? false
                : item.status === "PENDING"
        );

        const hasDecided = remainingChanges.some((item) =>
            item.id === change.id
                ? true
                : item.status !== "PENDING"
        );

        const requestStatus = hasPending
            ? hasDecided
                ? "PARTIALLY_REVIEWED"
                : "PENDING"
            : "COMPLETED";

        await tx
            .update(modificationRequests)
            .set({
                status: requestStatus,
                updatedAt: now,
            })
            .where(eq(modificationRequests.id, requestId));

        // Notify the contributor.
        const approved = decision === "APPROVED";

        await tx.insert(notifications).values({
            recipientId: request.modifierId,
            type: approved
                ? "MODIFICATION_APPROVED"
                : "MODIFICATION_REJECTED",
            title: approved
                ? "Your suggested change was approved"
                : "Your suggested change was rejected",
            message: approved
                ? `Your suggested change to "${change.fieldName}" was approved.`
                : `Your suggested change to "${change.fieldName}" was rejected.${
                    rejectionReason
                        ? ` Reason: ${rejectionReason}`
                        : ""
                }`,
            href: `/modifications/${request.id}/review`,
            relatedModificationRequestId: request.id,
            relatedModificationChangeId: change.id,
        });

        return {
            success: true,
            decision,
            requestStatus,
        };
    });
};


/* =========================================================
   RECORD VERSION QUERIES
========================================================= */

/**
 * Get the approved modification history for a record.
 */
export const getRecordVersions = async (recordId: string) => {
    return db.query.recordVersions.findMany({
        where: eq(recordVersions.recordId, recordId),

        with: {
            contributor: true,
            approver: true,
            change: true,
        },

        orderBy: [
            desc(recordVersions.createdAt),
        ],
    });
};


/**
 * Get the number of approved contributions to a record.
 */
export const getRecordContributionCount = async (recordId: string) => {
    const [result] = await db
        .select({ count: count() })
        .from(recordVersions)
        .where(eq(recordVersions.recordId, recordId));

    return result.count;
};



/* =========================================================
   NOTIFICATION QUERIES
========================================================= */

/**
 * Get notifications for a user.
 *
 * isRead is included for compatibility with the frontend.
 */
export const getNotificationsByUserId = async (
    userId: string
) => {
    const results = await db.query.notifications.findMany({
        where: eq(notifications.recipientId, userId),

        orderBy: [
            desc(notifications.createdAt),
        ],
    });

    return results.map((notification) => ({
        ...notification,
        isRead: notification.readAt !== null,
    }));
};



export const getUnreadNotificationCount = async (
    userId: string
) => {
    const results = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
            and(
                eq(notifications.recipientId, userId),
                isNull(notifications.readAt)
            )
        );

    return results.length;
};


export const markAllNotificationsAsRead = async (
    userId: string
) => {
    return db
        .update(notifications)
        .set({
            readAt: new Date(),
        })
        .where(
            and(
                eq(notifications.recipientId, userId),
                isNull(notifications.readAt)
            )
        )
        .returning();
};

export const markNotificationAsRead = async (
    notificationId: string,
    userId: string
) => {
    const [notification] = await db
        .update(notifications)
        .set({
            readAt: new Date(),
        })
        .where(
            and(
                eq(notifications.id, notificationId),
                eq(notifications.recipientId, userId)
            )
        )
        .returning();

    return notification;
};

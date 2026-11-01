import {
    pgTable,
    text,
    boolean,
    integer,
    timestamp,
    uuid,
    jsonb,
    pgEnum,
    index,
    uniqueIndex,
} from "drizzle-orm/pg-core";

import { relations } from "drizzle-orm";

export const modificationStatusEnum = pgEnum("modification_status", [
    "PENDING",
    "PARTIALLY_REVIEWED",
    "COMPLETED",
]);

export const modificationChangeStatusEnum = pgEnum(
    "modification_change_status",
    [
        "PENDING",
        "APPROVED",
        "REJECTED",
    ]
);

export const users = pgTable("users", {
    id: text("id").primaryKey(), // clerkID
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    imageUrl: text("image_url"),

    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const collections = pgTable("collections", {
    id: uuid("id").defaultRandom().primaryKey(),

    title: text("title").notNull(),
    description: text("description").notNull(),
    imageUrl: text("image_url"),
    timePeriod: text("time_period").notNull(),

    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const objectTypes = pgTable("object_types", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow(),
});


export const records = pgTable("records", {
    // Database identifier
    id: uuid("id").defaultRandom().primaryKey(),

    // User who created the record
    userId: text("user_id").notNull(),

    // Item name
    itemName: text("item_name").notNull(),

    // HHW identifier, separate from the database UUID
    // Examples: 1.1, 1.2, 2.1, 2.2
    hhwIdentifier: text("hhw_identifier"),

    // Object type
    objectTypeId: uuid("object_type_id").notNull(),

    // Museum / Institute
    museumName: text("museum_name").notNull(),
    museumDepartment: text("museum_department"),
    museumCity: text("museum_city").notNull(),
    museumCountry: text("museum_country").notNull(),
    museumNumber: text("museum_number").notNull(),
    museumDescription: text("museum_description"),

    // Dating / Origin
    dateCulturePeriod: text("date_culture_period").notNull(),
    datingBasis: text("dating_basis"),
    issuingAuthority: text("issuing_authority"),
    productionPlace: text("production_place"),
    findspot: text("findspot"),

    // Acquisition / Excavation
    acquisitionDate: text("acquisition_date"),
    excavationInformation: text("excavation_information"),

    // Physical characteristics
    materials: text("materials").notNull(),
    technique: text("technique"),
    dimensions: text("dimensions").notNull(),
    thickness: text("thickness"),
    weight: text("weight"),
    scientificTesting: text("scientific_testing"),

    // Inscription
    inscribed: boolean("inscribed").notNull().default(false),

    // Imagery
    imagery: boolean("imagery").notNull().default(false),
    imageryDescription: text("imagery_description"),
    imageryInscriptionPlacement: text("imagery_inscription_placement"),

    // Images / Sources
    imageSourceUrl: text("image_source_url"),
    imageType: text("image_type"),

    // Bibliography / Copyright
    bibliography: text("bibliography"),
    imageCopyrightDetails: text("image_copyright_details"),

    // Collection
    collectionId: uuid("collection_id"),

    createdAt: timestamp("created_at", { mode: "date" })
        .notNull()
        .defaultNow(),

    updatedAt: timestamp("updated_at", { mode: "date" })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
});

export const inscriptions = pgTable("inscriptions", {
    id: uuid("id").defaultRandom().primaryKey(),

    recordId: uuid("record_id").notNull(),

    content: text("content").notNull(),
    language: text("language").notNull(),
    translation: text("translation").notNull(),
    script: text("script").notNull(),

    serifsPresent: boolean("serifs_present").notNull(),
    stopmarksPresent: boolean("stopmarks_present").notNull(),

    createdAt: timestamp("created_at", { mode: "date" })
        .notNull()
        .defaultNow(),
});


// One request can contain multiple proposed field changes.
export const modificationRequests = pgTable(
    "modification_requests",
    {
        id: uuid("id").defaultRandom().primaryKey(),

        // Artifact being modified
        recordId: uuid("record_id")
            .notNull()
            .references(() => records.id, { onDelete: "cascade" }),

        // User proposing the changes
        modifierId: text("modifier_id")
            .notNull()
            .references(() => users.id),

        // Original publisher responsible for reviewing the request
        publisherId: text("publisher_id")
            .notNull()
            .references(() => users.id),

        status: modificationStatusEnum("status")
            .notNull()
            .default("PENDING"),

        createdAt: timestamp("created_at", { mode: "date" })
            .notNull()
            .defaultNow(),

        updatedAt: timestamp("updated_at", { mode: "date" })
            .notNull()
            .defaultNow()
            .$onUpdate(() => new Date()),
    },
    (table) => [
        index("modification_requests_record_idx").on(table.recordId),
        index("modification_requests_modifier_idx").on(table.modifierId),
        index("modification_requests_publisher_idx").on(table.publisherId),
        index("modification_requests_status_idx").on(table.status),
    ]
);


// One row represents one proposed field change.
export const modificationChanges = pgTable(
    "modification_changes",
    {
        id: uuid("id").defaultRandom().primaryKey(),

        requestId: uuid("request_id")
            .notNull()
            .references(() => modificationRequests.id, {
                onDelete: "cascade",
            }),

        // Exact database field name, e.g. "itemName"
        fieldName: text("field_name").notNull(),

        // Values are JSONB so we can preserve strings, booleans, and null.
        originalValue: jsonb("original_value")
            .$type<string | boolean | null>(),

        proposedValue: jsonb("proposed_value")
            .$type<string | boolean | null>()
            .notNull(),

        status: modificationChangeStatusEnum("status")
            .notNull()
            .default("PENDING"),

        // Optional explanation when a proposal is rejected
        rejectionReason: text("rejection_reason"),

        reviewedBy: text("reviewed_by")
            .references(() => users.id),

        reviewedAt: timestamp("reviewed_at", { mode: "date" }),

        createdAt: timestamp("created_at", { mode: "date" })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        index("modification_changes_request_idx").on(table.requestId),
        index("modification_changes_status_idx").on(table.status),
    ]
);


// Permanent history of approved changes to public records.
export const recordVersions = pgTable(
    "record_versions",
    {
        id: uuid("id").defaultRandom().primaryKey(),

        recordId: uuid("record_id")
            .notNull()
            .references(() => records.id, { onDelete: "cascade" }),

        // Contributor who originally proposed the approved change
        contributorId: text("contributor_id")
            .notNull()
            .references(() => users.id),

        // Publisher who approved the change
        approvedBy: text("approved_by")
            .notNull()
            .references(() => users.id),

        // Connects this history entry to the approved proposal
        modificationChangeId: uuid("modification_change_id")
            .notNull()
            .references(() => modificationChanges.id),

        fieldName: text("field_name").notNull(),

        oldValue: jsonb("old_value")
            .$type<string | boolean | null>(),

        newValue: jsonb("new_value")
            .$type<string | boolean | null>()
            .notNull(),

        createdAt: timestamp("created_at", { mode: "date" })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        index("record_versions_record_idx").on(table.recordId),
        index("record_versions_contributor_idx").on(table.contributorId),
        uniqueIndex("record_versions_change_unique")
            .on(table.modificationChangeId),
    ]
);


// Notifications for publishers and contributors.
export const notifications = pgTable(
    "notifications",
    {
        id: uuid("id").defaultRandom().primaryKey(),

        recipientId: text("recipient_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),

        type: text("type").notNull(),

        title: text("title").notNull(),

        message: text("message").notNull(),

        // Optional destination when a notification is clicked
        href: text("href"),

        relatedModificationRequestId: uuid(
            "related_modification_request_id"
        ).references(() => modificationRequests.id, {
            onDelete: "set null",
        }),

        relatedModificationChangeId: uuid(
            "related_modification_change_id"
        ).references(() => modificationChanges.id, {
            onDelete: "set null",
        }),

        // Null means unread; a timestamp means read.
        readAt: timestamp("read_at", { mode: "date" }),

        createdAt: timestamp("created_at", { mode: "date" })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        index("notifications_recipient_idx").on(table.recipientId),
        index("notifications_created_at_idx").on(table.createdAt),
    ]
);





// Relations:

// Users
export const userRelations = relations(users, ({ many }) => ({
    records: many(records),

    submittedModificationRequests: many(modificationRequests, {
        relationName: "modification_modifier",
    }),

    receivedModificationRequests: many(modificationRequests, {
        relationName: "modification_publisher",
    }),

    reviewedChanges: many(modificationChanges, {
        relationName: "modification_reviewer",
    }),

    contributedVersions: many(recordVersions, {
        relationName: "version_contributor",
    }),

    approvedVersions: many(recordVersions, {
        relationName: "version_approver",
    }),

    notifications: many(notifications),
}));

// Collections
export const collectionRelations = relations(collections, ({ many }) => ({
    records: many(records),
}));

// Object types
export const objectTypeRelations = relations(objectTypes, ({ many }) => ({
    records: many(records),
}));

// Records
export const recordRelations = relations(records, ({ one, many }) => ({
    user: one(users, {
        fields: [records.userId],
        references: [users.id],
    }),

    collection: one(collections, {
        fields: [records.collectionId],
        references: [collections.id],
    }),

    objectType: one(objectTypes, {
        fields: [records.objectTypeId],
        references: [objectTypes.id],
    }),

    inscriptions: many(inscriptions),

    modificationRequests: many(modificationRequests),

    versions: many(recordVersions),
}));

// Inscriptions
export const inscriptionRelations = relations(inscriptions, ({ one }) => ({
    record: one(records, {
        fields: [inscriptions.recordId],
        references: [records.id],
    }),
}));

// Modification requests
export const modificationRequestRelations = relations(
    modificationRequests,
    ({ one, many }) => ({
        record: one(records, {
            fields: [modificationRequests.recordId],
            references: [records.id],
        }),

        modifier: one(users, {
            fields: [modificationRequests.modifierId],
            references: [users.id],
            relationName: "modification_modifier",
        }),

        publisher: one(users, {
            fields: [modificationRequests.publisherId],
            references: [users.id],
            relationName: "modification_publisher",
        }),

        changes: many(modificationChanges),
    })
);

// Individual proposed changes
export const modificationChangeRelations = relations(
    modificationChanges,
    ({ one }) => ({
        request: one(modificationRequests, {
            fields: [modificationChanges.requestId],
            references: [modificationRequests.id],
        }),

        reviewer: one(users, {
            fields: [modificationChanges.reviewedBy],
            references: [users.id],
            relationName: "modification_reviewer",
        }),

        version: one(recordVersions),
    })
);

// Approved record history
export const recordVersionRelations = relations(
    recordVersions,
    ({ one }) => ({
        record: one(records, {
            fields: [recordVersions.recordId],
            references: [records.id],
        }),

        contributor: one(users, {
            fields: [recordVersions.contributorId],
            references: [users.id],
            relationName: "version_contributor",
        }),

        approver: one(users, {
            fields: [recordVersions.approvedBy],
            references: [users.id],
            relationName: "version_approver",
        }),

        change: one(modificationChanges, {
            fields: [recordVersions.modificationChangeId],
            references: [modificationChanges.id],
        }),
    })
);

// Notifications
export const notificationRelations = relations(
    notifications,
    ({ one }) => ({
        recipient: one(users, {
            fields: [notifications.recipientId],
            references: [users.id],
        }),

        modificationRequest: one(modificationRequests, {
            fields: [notifications.relatedModificationRequestId],
            references: [modificationRequests.id],
        }),

        modificationChange: one(modificationChanges, {
            fields: [notifications.relatedModificationChangeId],
            references: [modificationChanges.id],
        }),
    })
);


//Types

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;

export type Record = typeof records.$inferSelect;
export type NewRecord = typeof records.$inferInsert;

export type Inscription = typeof inscriptions.$inferSelect;
export type NewInscription = typeof inscriptions.$inferInsert;

export type ModificationRequest =
    typeof modificationRequests.$inferSelect;

export type NewModificationRequest =
    typeof modificationRequests.$inferInsert;

export type ModificationChange =
    typeof modificationChanges.$inferSelect;

export type NewModificationChange =
    typeof modificationChanges.$inferInsert;

export type RecordVersion =
    typeof recordVersions.$inferSelect;

export type NewRecordVersion =
    typeof recordVersions.$inferInsert;

export type Notification =
    typeof notifications.$inferSelect;

export type NewNotification =
    typeof notifications.$inferInsert;
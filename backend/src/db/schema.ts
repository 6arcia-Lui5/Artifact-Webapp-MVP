import { pgTable, text, boolean, integer, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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



// Relations:

// User can have many records
export const userRelations = relations(users, ({many}) => ({
    records: many(records)
}));

// Collection can have many records
export const collectionRelations = relations(collections, ({many}) => ({
    records: many(records),
}));

// Records can have one users and belong to one collection
// Record relations
export const recordRelations = relations(
    records,
    ({ one, many }) => ({
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
    })
);

// Inscription relations
export const inscriptionRelations = relations(
    inscriptions,
    ({ one }) => ({
        record: one(records, {
            fields: [inscriptions.recordId],
            references: [records.id],
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
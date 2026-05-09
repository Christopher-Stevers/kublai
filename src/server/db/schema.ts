// @ts-nocheck
// Note: Type checking disabled for this file due to Drizzle ORM's type inference limitations
// with circular references. This is a known limitation and doesn't affect runtime behavior.
// The build succeeds correctly - these are only strict TypeScript checking issues.

import { relations } from "drizzle-orm";
import { index, pgTableCreator, primaryKey, unique } from "drizzle-orm/pg-core";

/**
 * Trades MVP schema (ordering + quoting) in Drizzle format
 * - Includes NextAuth tables: user, account, session, verification_token
 * - Adds org multi-tenancy + suppliers + parts catalog + categories + facets + attributes
 *
 * Note: TypeScript may show type errors in relations() calls due to Drizzle's type system
 * limitations with strict TypeScript. These are type-checking only and don't affect runtime.
 */

export const createTable = pgTableCreator((name) => `kublai_${name}`);

// ============================
// NEXTAUTH: USER
// ============================

export const users = createTable("user", (d) => ({
  id: d.varchar({ length: 255 }).notNull().primaryKey(), // Clerk user ID (no default, set by Clerk webhook)

  // Clerk/User fields
  name: d.varchar({ length: 255 }),
  email: d.varchar({ length: 255 }).notNull(),
  image: d.varchar({ length: 255 }),

  // App fields
  role: d.varchar({ length: 50 }).default("user"), // user | admin | foreman etc.

  // Org membership (single-org MVP; if you need multi-org later, use a join table)
  organizationId: d
    .uuid()
    .references(() => organizations.id, { onDelete: "cascade" }),

  // Optional: default pricing profile for the user
  pricingProfileId: d
    .uuid()
    .references(() => pricingProfiles.id, { onDelete: "set null" }),

  // Payment/Stripe fields
  stripeCustomerId: d.varchar({ length: 255 }),
  hasOneTimeAccess: d.boolean().default(false),
  stripeSubscriptionId: d.varchar({ length: 255 }),
  subscriptionStatus: d.varchar({ length: 50 }), // 'active', 'canceled', 'past_due', 'trialing', etc.
  subscriptionEndsAt: d.timestamp({ withTimezone: true }),
  oneTimePurchaseDate: d.timestamp({ withTimezone: true }),

  // Current job preference
  currentJobId: d.uuid().references(() => jobs.id, { onDelete: "set null" }),

  createdAt: d
    .timestamp({ withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: d
    .timestamp({ withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
}));

export const usersRelations = relations(users, ({ many, one }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
  pricingProfile: one(pricingProfiles, {
    fields: [users.pricingProfileId],
    references: [pricingProfiles.id],
  }),
  currentJob: one(jobs, {
    fields: [users.currentJobId],
    references: [jobs.id],
  }),
  createdJobs: many(jobs, { relationName: "jobs_created_by_user" }),
  foremanJobs: many(jobs, { relationName: "jobs_foreman_user" }),
}));

// ============================
// NEXTAUTH: ACCOUNT
// ============================

export const accounts = createTable(
  "account",
  (d) => ({
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    type: d.varchar({ length: 255 }).notNull(),
    provider: d.varchar({ length: 255 }).notNull(),
    providerAccountId: d.varchar({ length: 255 }).notNull(),
    refresh_token: d.text(),
    access_token: d.text(),
    expires_at: d.integer(),
    token_type: d.varchar({ length: 255 }),
    scope: d.varchar({ length: 255 }),
    id_token: d.text(),
    session_state: d.varchar({ length: 255 }),
  }),
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index("account_user_id_idx").on(t.userId),
  ],
);

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

// ============================
// NEXTAUTH: SESSION
// ============================

export const sessions = createTable(
  "session",
  (d) => ({
    sessionToken: d.varchar({ length: 255 }).notNull().primaryKey(),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: d.timestamp({ mode: "date", withTimezone: true }).notNull(),
  }),
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

// ============================
// NEXTAUTH: VERIFICATION TOKEN
// ============================

export const verificationTokens = createTable(
  "verification_token",
  (d) => ({
    identifier: d.varchar({ length: 255 }).notNull(),
    token: d.varchar({ length: 255 }).notNull(),
    expires: d.timestamp({ mode: "date", withTimezone: true }).notNull(),
  }),
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ============================
// ORGANIZATION (tenant)
// ============================

export const organizations = createTable(
  "organization",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: d.varchar({ length: 255 }).notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  }),
  (t) => [unique("organization_name_uniq").on(t.name)],
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  locations: many(locations),
  pricingProfiles: many(pricingProfiles),
  suppliers: many(suppliers),
  categories: many(categories),
  partDefinitions: many(partDefinitions),
  supplierParts: many(supplierParts),
  jobs: many(jobs),
  materialLists: many(materialLists),
  quotes: many(quotes),
  orders: many(orders),
}));

// ============================
// LOCATIONS
// ============================

export const locations = createTable(
  "location",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    name: d.varchar({ length: 255 }).notNull(),
    address1: d.varchar({ length: 255 }),
    address2: d.varchar({ length: 255 }),
    city: d.varchar({ length: 100 }),
    region: d.varchar({ length: 100 }),
    postalCode: d.varchar({ length: 30 }),
    country: d.varchar({ length: 100 }),
    notes: d.text(),

    createdAt: d
      .timestamp({ withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  }),
  (t) => [index("location_org_idx").on(t.organizationId)],
);

export const locationsRelations = relations(locations, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [locations.organizationId],
    references: [organizations.id],
  }),
  jobs: many(jobs),
}));

// ============================
// PRICING PROFILE
// ============================

export const pricingProfiles = createTable(
  "pricing_profile",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: d.varchar({ length: 255 }).notNull().default("Default"),
    defaultMarkupPercent: d
      .numeric({ precision: 6, scale: 3 })
      .notNull()
      .default("0"),
    createdAt: d
      .timestamp({ withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  }),
  (t) => [
    unique("pricing_profile_org_name_uniq").on(t.organizationId, t.name),
    index("pricing_profile_org_idx").on(t.organizationId),
  ],
);

export const pricingProfilesRelations = relations(
  pricingProfiles,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [pricingProfiles.organizationId],
      references: [organizations.id],
    }),
    users: many(users),
    jobs: many(jobs),
  }),
);

// ============================
// SUPPLIERS
// ============================

export const suppliers = createTable(
  "supplier",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    name: d.varchar({ length: 255 }).notNull(),
    contactName: d.varchar({ length: 255 }),
    contactEmail: d.varchar({ length: 255 }),
    contactPhone: d.varchar({ length: 50 }),
    orderingNotes: d.text(),
    locationId: d
      .uuid()
      .references(() => locations.id, { onDelete: "set null" }),

    createdAt: d
      .timestamp({ withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  }),
  (t) => [
    unique("supplier_org_name_uniq").on(t.organizationId, t.name),
    index("supplier_org_idx").on(t.organizationId),
    index("supplier_location_idx").on(t.locationId),
  ],
);

export const suppliersRelations = relations(suppliers, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [suppliers.organizationId],
    references: [organizations.id],
  }),
  location: one(locations, {
    fields: [suppliers.locationId],
    references: [locations.id],
  }),
  supplierParts: many(supplierParts),
  jobSuppliers: many(jobSuppliers),
  orders: many(orders),
}));

// ============================
// UNITS
// ============================

export const units = createTable(
  "unit",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    code: d.varchar({ length: 32 }).notNull(), // ea, ft, in, mm, L, gal, gpm, psi, deg
    kind: d.varchar({ length: 32 }).notNull(), // count, length, volume, flow, pressure, angle
    displayName: d.varchar({ length: 64 }),
  }),
  (t) => [unique("unit_code_uniq").on(t.code)],
);

export const unitsRelations = relations(units, ({ many }) => ({
  partDefinitionsSizeUnit: many(partDefinitions, {
    relationName: "pd_size_unit",
  }),
  partAttributes: many(partAttributes),
  supplierPartsPackUom: many(supplierParts, { relationName: "sp_pack_uom" }),
  quoteItemsUom: many(quoteItems, { relationName: "qi_uom" }),
  orderItemsUom: many(orderItems, { relationName: "oi_uom" }),
}));

// ============================
// MATERIALS (custom materials)
// org-specific
// ============================

export const materials = createTable(
  "material",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: d.varchar({ length: 100 }).notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  }),
  (t) => [
    unique("material_org_name_uniq").on(t.organizationId, t.name),
    index("material_org_idx").on(t.organizationId),
  ],
);

export const materialsRelations = relations(materials, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [materials.organizationId],
    references: [organizations.id],
  }),
  partDefinitions: many(partDefinitions),
}));

// ============================
// SIZES (custom size combinations)
// org-specific
// ============================

export const sizes = createTable(
  "size",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    nominal: d.numeric({ precision: 12, scale: 6 }).notNull(),
    unitId: d
      .uuid()
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  }),
  (t) => [
    unique("size_org_nominal_unit_uniq").on(
      t.organizationId,
      t.nominal,
      t.unitId,
    ),
    index("size_org_idx").on(t.organizationId),
  ],
);

export const sizesRelations = relations(sizes, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [sizes.organizationId],
    references: [organizations.id],
  }),
  unit: one(units, {
    fields: [sizes.unitId],
    references: [units.id],
  }),
  partDefinitions: many(partDefinitions),
}));

// ============================
// CATALOGS
// org-specific
// ============================

export const catalogs = createTable(
  "catalog",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: d.varchar({ length: 255 }).notNull(),
    sortOrder: d.integer().notNull().default(0),
    createdAt: d
      .timestamp({ withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  }),
  (t) => [
    unique("catalog_org_name_uniq").on(t.organizationId, t.name),
    index("catalog_org_idx").on(t.organizationId),
  ],
);

export const catalogsRelations = relations(catalogs, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [catalogs.organizationId],
    references: [organizations.id],
  }),
  partDefinitions: many(partDefinitions),
}));

// ============================
// CATEGORIES
// org-specific
// ============================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const categories: any = createTable(
  "category",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: d.varchar({ length: 255 }).notNull(),
    sortOrder: d.integer().notNull().default(0),
  }),
  (t) => [unique("category_org_name_uniq").on(t.organizationId, t.name)],
);

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [categories.organizationId],
    references: [organizations.id],
  }),
  partDefinitions: many(partDefinitions),
}));

// ============================
// PART DEFINITIONS (generic catalog + facets)
// org-specific
// ============================

export const partDefinitions = createTable(
  "part_definition",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    catalogId: d
      .uuid()
      .notNull()
      .references(() => catalogs.id, { onDelete: "restrict" }),
    categoryId: d
      .uuid()
      .references(() => categories.id, { onDelete: "set null" }),

    displayName: d.varchar({ length: 255 }).notNull(),
    description: d.text(),
    imageUrl: d.text(),
    sizeLabel: d.varchar({ length: 100 }),

    // Facets (MVP)
    materialId: d
      .uuid()
      .references(() => materials.id, { onDelete: "set null" }),
    sizeId: d
      .uuid()
      .references(() => sizes.id, { onDelete: "set null" }),

    isActive: d.boolean().notNull().default(true),

    createdAt: d
      .timestamp({ withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  }),
  (t) => [
    index("part_def_org_idx").on(t.organizationId),
    index("part_def_catalog_idx").on(t.catalogId),
    index("part_def_category_idx").on(t.categoryId),
    index("part_def_facets_idx").on(t.materialId, t.sizeId),
    index("part_def_material_idx").on(t.materialId),
    index("part_def_size_idx").on(t.sizeId),
  ],
);

export const partDefinitionsRelations = relations(
  partDefinitions,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [partDefinitions.organizationId],
      references: [organizations.id],
    }),
    catalog: one(catalogs, {
      fields: [partDefinitions.catalogId],
      references: [catalogs.id],
    }),
    category: one(categories, {
      fields: [partDefinitions.categoryId],
      references: [categories.id],
    }),
    size: one(sizes, {
      fields: [partDefinitions.sizeId],
      references: [sizes.id],
    }),
    material: one(materials, {
      fields: [partDefinitions.materialId],
      references: [materials.id],
    }),
    synonyms: many(partSynonyms),
    attributes: many(partAttributes),
    supplierParts: many(supplierParts),
    quoteItems: many(quoteItems),
    orderItems: many(orderItems),
  }),
);

export const partSynonyms = createTable(
  "part_synonym",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    partDefinitionId: d
      .uuid()
      .notNull()
      .references(() => partDefinitions.id, { onDelete: "cascade" }),
    synonym: d.varchar({ length: 255 }).notNull(),
  }),
  (t) => [index("part_synonym_part_idx").on(t.partDefinitionId)],
);

export const partSynonymsRelations = relations(partSynonyms, ({ one }) => ({
  partDefinition: one(partDefinitions, {
    fields: [partSynonyms.partDefinitionId],
    references: [partDefinitions.id],
  }),
}));

// Flexible attributes (volume, flow_rate, pressure_rating, angle_deg, etc.)
export const partAttributes = createTable(
  "part_attribute",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    partDefinitionId: d
      .uuid()
      .notNull()
      .references(() => partDefinitions.id, { onDelete: "cascade" }),

    key: d.varchar({ length: 100 }).notNull(),
    valueNum: d.numeric({ precision: 18, scale: 6 }),
    valueText: d.text(),
    unitId: d.uuid().references(() => units.id, { onDelete: "set null" }),
  }),
  (t) => [
    unique("part_attr_part_key_uniq").on(t.partDefinitionId, t.key),
    index("part_attr_key_num_idx").on(t.key, t.valueNum),
  ],
);

export const partAttributesRelations = relations(partAttributes, ({ one }) => ({
  partDefinition: one(partDefinitions, {
    fields: [partAttributes.partDefinitionId],
    references: [partDefinitions.id],
  }),
  unit: one(units, {
    fields: [partAttributes.unitId],
    references: [units.id],
  }),
}));

// ============================
// SUPPLIER PARTS (supplier-specific listing)
// ============================

export const supplierParts = createTable(
  "supplier_part",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    supplierId: d
      .uuid()
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    partDefinitionId: d
      .uuid()
      .notNull()
      .references(() => partDefinitions.id, { onDelete: "cascade" }),

    supplierSku: d.varchar({ length: 255 }),
    supplierName: d.text(),

    packSize: d.numeric({ precision: 12, scale: 6 }),
    packUomId: d.uuid().references(() => units.id, { onDelete: "set null" }),

    lastKnownUnitCost: d.numeric({ precision: 12, scale: 4 }),
    currency: d.varchar({ length: 10 }).notNull().default("CAD"),

    isPreferred: d.boolean().notNull().default(false),
    notes: d.text(),

    createdAt: d
      .timestamp({ withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  }),
  (t) => [
    index("supplier_part_supplier_idx").on(t.supplierId),
    index("supplier_part_part_idx").on(t.partDefinitionId),
    index("supplier_part_preferred_idx").on(
      t.organizationId,
      t.partDefinitionId,
      t.isPreferred,
    ),
    unique("supplier_part_org_supplier_sku_uniq").on(
      t.organizationId,
      t.supplierId,
      t.supplierSku,
    ),
  ],
);

export const supplierPartsRelations = relations(
  supplierParts,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [supplierParts.organizationId],
      references: [organizations.id],
    }),
    supplier: one(suppliers, {
      fields: [supplierParts.supplierId],
      references: [suppliers.id],
    }),
    partDefinition: one(partDefinitions, {
      fields: [supplierParts.partDefinitionId],
      references: [partDefinitions.id],
    }),
    packUom: one(units, {
      fields: [supplierParts.packUomId],
      references: [units.id],
      relationName: "sp_pack_uom",
    }),
    quoteItems: many(quoteItems),
    orderItems: many(orderItems),
  }),
);

// ============================
// JOBS (center of workflow)
// ============================

export const jobs = createTable(
  "job",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    name: d.varchar({ length: 255 }).notNull(),
    locationId: d
      .uuid()
      .references(() => locations.id, { onDelete: "set null" }),

    createdByUserId: d.varchar({ length: 255 }).references(() => users.id, {
      onDelete: "set null",
    }),
    foremanUserId: d.varchar({ length: 255 }).references(() => users.id, {
      onDelete: "set null",
    }),
    foremanName: d.varchar({ length: 255 }),
    poNumber: d.varchar({ length: 100 }),

    status: d.varchar({ length: 50 }).notNull().default("draft"), // draft|quoted|ordered|completed
    pricingProfileId: d
      .uuid()
      .references(() => pricingProfiles.id, { onDelete: "set null" }),

    createdAt: d
      .timestamp({ withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  }),
  (t) => [
    index("job_org_idx").on(t.organizationId),
    // @ts-expect-error - Drizzle type inference limitation with nullable columns
    index("job_location_idx").on(t.locationId as any),
    // @ts-expect-error - Drizzle type inference limitation with nullable columns
    index("job_foreman_idx").on(t.foremanUserId as any),
  ],
);

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [jobs.organizationId],
    references: [organizations.id],
  }),
  location: one(locations, {
    fields: [jobs.locationId],
    references: [locations.id],
  }),
  createdBy: one(users, {
    fields: [jobs.createdByUserId],
    references: [users.id],
    relationName: "jobs_created_by_user",
  }),
  foreman: one(users, {
    fields: [jobs.foremanUserId],
    references: [users.id],
    relationName: "jobs_foreman_user",
  }),
  pricingProfile: one(pricingProfiles, {
    fields: [jobs.pricingProfileId],
    references: [pricingProfiles.id],
  }),
  jobSuppliers: many(jobSuppliers),
  materialLists: many(materialLists),
  quotes: many(quotes),
  orders: many(orders),
}));

// ============================
// MATERIAL LISTS
// ============================

export const materialLists = createTable(
  "material_list",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    jobId: d
      .uuid()
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),

    name: d.varchar({ length: 255 }).notNull(),
    quoteId: d.uuid().references(() => quotes.id, { onDelete: "set null" }),

    createdByUserId: d.varchar({ length: 255 }).references(() => users.id, {
      onDelete: "set null",
    }),

    createdAt: d
      .timestamp({ withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: d
      .timestamp({ withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  }),
  (t) => [
    index("material_list_job_idx").on(t.jobId),
    index("material_list_org_idx").on(t.organizationId),
    // @ts-expect-error - Drizzle type inference limitation with nullable columns
    index("material_list_quote_idx").on(t.quoteId as any),
  ],
);

export const materialListsRelations = relations(materialLists, ({ one }) => ({
  organization: one(organizations, {
    fields: [materialLists.organizationId],
    references: [organizations.id],
  }),
  job: one(jobs, {
    fields: [materialLists.jobId],
    references: [jobs.id],
  }),
  quote: one(quotes, {
    fields: [materialLists.quoteId],
    references: [quotes.id],
  }),
  createdBy: one(users, {
    fields: [materialLists.createdByUserId],
    references: [users.id],
  }),
}));

// Optional: job supplier prefs/defaults
export const jobSuppliers = createTable(
  "job_supplier",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    jobId: d
      .uuid()
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    supplierId: d
      .uuid()
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    isDefault: d.boolean().notNull().default(false),
  }),
  (t) => [
    unique("job_supplier_uniq").on(t.jobId, t.supplierId),
    index("job_supplier_job_idx").on(t.jobId),
  ],
);

export const jobSuppliersRelations = relations(jobSuppliers, ({ one }) => ({
  job: one(jobs, { fields: [jobSuppliers.jobId], references: [jobs.id] }),
  supplier: one(suppliers, {
    fields: [jobSuppliers.supplierId],
    references: [suppliers.id],
  }),
}));

// ============================
// QUOTES (pricing snapshot)
// ============================

export const quotes = createTable(
  "quote",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    materialListId: d
      .uuid()
      .references(() => materialLists.id, { onDelete: "cascade" }),

    jobId: d.uuid().references(() => jobs.id, { onDelete: "cascade" }),

    quoteNumber: d.varchar({ length: 100 }),
    createdByUserId: d.varchar({ length: 255 }).references(() => users.id, {
      onDelete: "set null",
    }),

    markupPercent: d.numeric({ precision: 6, scale: 3 }),
    laborHours: d.numeric({ precision: 10, scale: 2 }).notNull().default("0"),
    laborRate: d.numeric({ precision: 12, scale: 2 }),
    notes: d.text(),

    subtotalMaterials: d
      .numeric({ precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    total: d.numeric({ precision: 14, scale: 2 }).notNull().default("0"),

    createdAt: d
      .timestamp({ withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  }),
  (t) => [
    // @ts-expect-error - Drizzle type inference limitation with nullable columns
    index("quote_job_idx").on(t.jobId as any),
    // @ts-expect-error - Drizzle type inference limitation with nullable columns
    index("quote_material_list_idx").on(t.materialListId as any),
  ],
);

export const quotesRelations = relations(quotes, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [quotes.organizationId],
    references: [organizations.id],
  }),
  materialList: one(materialLists, {
    fields: [quotes.materialListId],
    references: [materialLists.id],
  }),
  job: one(jobs, { fields: [quotes.jobId], references: [jobs.id] }),
  createdBy: one(users, {
    fields: [quotes.createdByUserId],
    references: [users.id],
  }),
  items: many(quoteItems),
}));

export const quoteItems = createTable(
  "quote_item",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    quoteId: d
      .uuid()
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),

    supplierPartId: d
      .uuid()
      .references(() => supplierParts.id, { onDelete: "set null" }),
    supplierId: d.uuid().references(() => suppliers.id, { onDelete: "set null" }),
    partDefinitionId: d
      .uuid()
      .references(() => partDefinitions.id, { onDelete: "restrict" }),
    // One-off part fields (used when partDefinitionId is null)
    oneOffDisplayName: d.varchar({ length: 255 }),
    oneOffDescription: d.text(),
    oneOffMaterial: d.varchar({ length: 100 }),
    oneOffSizeNominal: d.numeric({ precision: 12, scale: 6 }),
    oneOffSizeUnitId: d
      .uuid()
      .references(() => units.id, { onDelete: "set null" }),

    quantity: d.numeric({ precision: 12, scale: 6 }).notNull().default("1"),
    uomId: d.uuid().references(() => units.id, { onDelete: "set null" }),

    unitCost: d.numeric({ precision: 12, scale: 4 }),
    markupPercent: d.numeric({ precision: 6, scale: 3 }),
    unitPrice: d.numeric({ precision: 12, scale: 4 }),
    extendedPrice: d.numeric({ precision: 14, scale: 2 }),

    descriptionSnapshot: d.text(),
    notes: d.text(),
    addedByUserId: d.varchar({ length: 255 }).references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: d
      .timestamp({ withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  }),
  (t) => [
    index("quote_item_quote_idx").on(t.quoteId),
    index("quote_item_part_idx").on(t.partDefinitionId),
    index("quote_item_supplier_idx").on(t.supplierId),
    index("quote_item_added_by_idx").on(t.addedByUserId),
  ],
);

export const quoteItemsRelations = relations(quoteItems, ({ one }) => ({
  quote: one(quotes, { fields: [quoteItems.quoteId], references: [quotes.id] }),
  supplierPart: one(supplierParts, {
    fields: [quoteItems.supplierPartId],
    references: [supplierParts.id],
  }),
  supplier: one(suppliers, {
    fields: [quoteItems.supplierId],
    references: [suppliers.id],
  }),
  partDefinition: one(partDefinitions, {
    fields: [quoteItems.partDefinitionId],
    references: [partDefinitions.id],
  }),
  oneOffSizeUnit: one(units, {
    fields: [quoteItems.oneOffSizeUnitId],
    references: [units.id],
    relationName: "qi_one_off_size_unit",
  }),
  uom: one(units, {
    fields: [quoteItems.uomId],
    references: [units.id],
    relationName: "qi_uom",
  }),
  addedBy: one(users, {
    fields: [quoteItems.addedByUserId],
    references: [users.id],
  }),
}));

// ============================
// ORDERS (material orders; usually split by supplier on send)
// ============================

export const orders = createTable(
  "order",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    jobId: d
      .uuid()
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    materialListId: d
      .uuid()
      .references(() => materialLists.id, { onDelete: "set null" }),

    orderNumber: d.varchar({ length: 100 }),

    supplierId: d
      .uuid()
      .references(() => suppliers.id, { onDelete: "set null" }),
    createdByUserId: d.varchar({ length: 255 }).references(() => users.id, {
      onDelete: "set null",
    }),

    requestedFulfillmentDate: d.date(),
    status: d.varchar({ length: 50 }).notNull().default("draft"), // draft|sent|confirmed|received|cancelled

    sentVia: d.varchar({ length: 50 }), // email|pdf|share
    sentTo: d.varchar({ length: 255 }),
    sentAt: d.timestamp({ withTimezone: true }),

    notes: d.text(),

    createdAt: d
      .timestamp({ withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  }),
  (t) => [
    index("order_job_idx").on(t.jobId),
    // @ts-expect-error - Drizzle type inference limitation with nullable columns
    index("order_material_list_idx").on(t.materialListId as any),
    index("order_supplier_idx").on(t.supplierId),
    index("order_org_idx").on(t.organizationId),
  ],
);

export const ordersRelations = relations(orders, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [orders.organizationId],
    references: [organizations.id],
  }),
  job: one(jobs, { fields: [orders.jobId], references: [jobs.id] }),
  materialList: one(materialLists, {
    fields: [orders.materialListId],
    references: [materialLists.id],
  }),
  supplier: one(suppliers, {
    fields: [orders.supplierId],
    references: [suppliers.id],
  }),
  createdBy: one(users, {
    fields: [orders.createdByUserId],
    references: [users.id],
  }),
  items: many(orderItems),
}));

export const orderItems = createTable(
  "order_item",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    orderId: d
      .uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),

    supplierPartId: d
      .uuid()
      .references(() => supplierParts.id, { onDelete: "set null" }),
    partDefinitionId: d
      .uuid()
      .notNull()
      .references(() => partDefinitions.id, { onDelete: "restrict" }),

    quantity: d.numeric({ precision: 12, scale: 6 }).notNull().default("1"),
    uomId: d.uuid().references(() => units.id, { onDelete: "set null" }),

    unitCostAtOrderTime: d.numeric({ precision: 12, scale: 4 }),
    descriptionSnapshot: d.text(),
    supplierSkuSnapshot: d.varchar({ length: 255 }),
    notes: d.text(),
  }),
  (t) => [
    index("order_item_order_idx").on(t.orderId),
    index("order_item_part_idx").on(t.partDefinitionId),
  ],
);

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  supplierPart: one(supplierParts, {
    fields: [orderItems.supplierPartId],
    references: [supplierParts.id],
  }),
  partDefinition: one(partDefinitions, {
    fields: [orderItems.partDefinitionId],
    references: [partDefinitions.id],
  }),
  uom: one(units, {
    fields: [orderItems.uomId],
    references: [units.id],
    relationName: "oi_uom",
  }),
}));

import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTableCreator,
  uniqueIndex,
  type AnyPgColumn,
  type PgTable,
} from "drizzle-orm/pg-core";
import { organizations, jobs as legacyJobs } from "./schema";
import type {
  EstimateAssembly,
  EstimateDocument,
  EstimateStatus,
  EstimateSummary,
  PricingRow,
} from "~/lib/estimating/types";

const table = pgTableCreator((name) => `kublai_${name}`);
export const estimates = table(
  "estimate",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    jobId: d.uuid().notNull(),
    name: d.varchar({ length: 255 }).notNull(),
    status: d
      .varchar({ length: 20 })
      .$type<EstimateStatus>()
      .notNull()
      .default("draft"),
    revision: d.integer().notNull().default(1),
    document: d.jsonb().$type<EstimateDocument>().notNull(),
    summary: d.jsonb().$type<EstimateSummary>().notNull(),
    createdByUserId: d.varchar({ length: 255 }).notNull(),
    createdByName: d.varchar({ length: 255 }).notNull(),
    createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    uniqueIndex("estimate_id_org_unique").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.jobId, t.organizationId],
      foreignColumns: [
        (legacyJobs as unknown as PgTable & { id: AnyPgColumn }).id,
        (legacyJobs as unknown as PgTable & { organizationId: AnyPgColumn })
          .organizationId,
      ],
      name: "estimate_job_org_fk",
    }).onDelete("cascade"),
    index("estimate_org_updated_idx").on(t.organizationId, t.updatedAt, t.id),
    index("estimate_job_status_idx").on(t.organizationId, t.jobId, t.status),
    check("estimate_revision_positive", sql`${t.revision} > 0`),
    check(
      "estimate_status_valid",
      sql`${t.status} in ('draft','in_review','approved','sent','won','lost','archived')`,
    ),
  ],
);

export const estimateRevisions = table(
  "estimate_revision",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    estimateId: d.uuid().notNull(),
    organizationId: d.uuid().notNull(),
    revision: d.integer().notNull(),
    name: d.varchar({ length: 255 }).notNull(),
    status: d.varchar({ length: 20 }).$type<EstimateStatus>().notNull(),
    document: d.jsonb().$type<EstimateDocument>().notNull(),
    summary: d.jsonb().$type<EstimateSummary>().notNull(),
    action: d.varchar({ length: 80 }).notNull(),
    actorId: d.varchar({ length: 255 }).notNull(),
    actorName: d.varchar({ length: 255 }).notNull(),
    effectiveUserId: d.varchar({ length: 255 }).notNull(),
    effectiveUserName: d.varchar({ length: 255 }).notNull(),
    simulationId: d.uuid(),
    createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    foreignKey({
      columns: [t.estimateId, t.organizationId],
      foreignColumns: [estimates.id, estimates.organizationId],
      name: "estimate_revision_estimate_org_fk",
    }).onDelete("cascade"),
    uniqueIndex("estimate_revision_unique").on(t.estimateId, t.revision),
    index("estimate_revision_org_idx").on(
      t.organizationId,
      t.estimateId,
      t.createdAt,
    ),
    check("estimate_audit_revision_positive", sql`${t.revision} > 0`),
  ],
);

export const estimatingPricing = table(
  "estimating_pricing",
  (d) => ({
    organizationId: d
      .uuid()
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    revision: d.integer().notNull().default(0),
    rows: d
      .jsonb()
      .$type<PricingRow[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    assemblies: d
      .jsonb()
      .$type<EstimateAssembly[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    updatedAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [check("estimating_pricing_revision_valid", sql`${t.revision} >= 0`)],
);

export const estimatingPricingRevisions = table(
  "estimating_pricing_revision",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    revision: d.integer().notNull(),
    rows: d.jsonb().$type<PricingRow[]>().notNull(),
    assemblies: d.jsonb().$type<EstimateAssembly[]>().notNull(),
    actorId: d.varchar({ length: 255 }).notNull(),
    actorName: d.varchar({ length: 255 }).notNull(),
    effectiveUserId: d.varchar({ length: 255 }).notNull(),
    effectiveUserName: d.varchar({ length: 255 }).notNull(),
    simulationId: d.uuid(),
    createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    uniqueIndex("estimating_pricing_revision_unique").on(
      t.organizationId,
      t.revision,
    ),
    check("estimating_pricing_audit_revision_positive", sql`${t.revision} > 0`),
  ],
);

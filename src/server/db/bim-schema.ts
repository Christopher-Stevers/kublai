import type { ModelDesign } from "~/lib/bim/design";
import {
  pgTableCreator,
  uniqueIndex,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { organizations } from "./schema";
import { jobs as legacyJobs } from "./schema";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
const jobColumn = (name: "id" | "organizationId") =>
  (
    legacyJobs as unknown as PgTable &
      Record<"id" | "organizationId", AnyPgColumn>
  )[name];
import type { BimModel, BimIssue, BimSavedView } from "~/lib/bim/types";
const table = pgTableCreator((n) => `kublai_${n}`);
export const bimModels = table(
  "bim_model",
  (d) => ({
    id: d.uuid().primaryKey(),
    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    jobId: d
      .uuid()
      .notNull()
      .references(() => jobColumn("id"), { onDelete: "cascade" }),
    seriesId: d.uuid().notNull(),
    version: d.integer().notNull(),
    // Retain revision identity and audit references after deletion. Deleted
    // revisions must never be served or resumed by the conversion queue.
    data: d.jsonb().$type<BimModel & { deletedAt?: string }>().notNull(),
    sourceSha: d.varchar({ length: 64 }).notNull(),
    viewSha: d.varchar({ length: 64 }),
    conversionRequestedBy: d.varchar({ length: 255 }),
    conversionCheckedAt: d.timestamp({ withTimezone: true }),
    conversionUrn: d.text(),
    conversionLease: d.timestamp({ withTimezone: true }),
    createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    uniqueIndex("bim_model_series_version_uniq").on(t.seriesId, t.version),
    index("bim_model_job_idx").on(t.organizationId, t.jobId),
    foreignKey({
      columns: [t.jobId, t.organizationId],
      foreignColumns: [jobColumn("id"), jobColumn("organizationId")],
      name: "bim_model_job_org_fk",
    }).onDelete("cascade"),
  ],
);
export const bimViews = table(
  "bim_view",
  (d) => ({
    id: d.uuid().primaryKey(),
    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    jobId: d
      .uuid()
      .notNull()
      .references(() => jobColumn("id"), { onDelete: "cascade" }),
    data: d.jsonb().$type<BimSavedView>().notNull(),
  }),
  (t) => [
    index("bim_view_job_idx").on(t.organizationId, t.jobId),
    foreignKey({
      columns: [t.jobId, t.organizationId],
      foreignColumns: [jobColumn("id"), jobColumn("organizationId")],
      name: "bim_view_job_org_fk",
    }).onDelete("cascade"),
  ],
);
export const bimIssues = table(
  "bim_issue",
  (d) => ({
    id: d.uuid().primaryKey(),
    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    jobId: d
      .uuid()
      .notNull()
      .references(() => jobColumn("id"), { onDelete: "cascade" }),
    revision: d.integer().notNull(),
    data: d.jsonb().$type<BimIssue>().notNull(),
  }),
  (t) => [
    index("bim_issue_job_idx").on(t.organizationId, t.jobId),
    foreignKey({
      columns: [t.jobId, t.organizationId],
      foreignColumns: [jobColumn("id"), jobColumn("organizationId")],
      name: "bim_issue_job_org_fk",
    }).onDelete("cascade"),
  ],
);
export const bimActivity = table(
  "bim_activity",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    jobId: d
      .uuid()
      .notNull()
      .references(() => jobColumn("id"), { onDelete: "cascade" }),
    actorId: d.varchar({ length: 255 }).notNull(),
    action: d.varchar({ length: 100 }).notNull(),
    entityId: d.uuid().notNull(),
    data: d.jsonb().notNull(),
    createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    index("bim_activity_job_idx").on(t.organizationId, t.jobId, t.createdAt),
    foreignKey({
      columns: [t.jobId, t.organizationId],
      foreignColumns: [jobColumn("id"), jobColumn("organizationId")],
      name: "bim_activity_job_org_fk",
    }).onDelete("cascade"),
  ],
);

export const bimDesigns = table(
  "bim_design",
  (d) => ({
    modelId: d
      .uuid()
      .primaryKey()
      .references(() => bimModels.id, { onDelete: "cascade" }),
    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    jobId: d.uuid().notNull(),
    revision: d.integer().notNull(),
    data: d.jsonb().$type<ModelDesign>().notNull(),
    updatedBy: d.varchar({ length: 255 }).notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    index("bim_design_job_idx").on(t.organizationId, t.jobId),
    foreignKey({
      columns: [t.jobId, t.organizationId],
      foreignColumns: [jobColumn("id"), jobColumn("organizationId")],
      name: "bim_design_job_org_fk",
    }).onDelete("cascade"),
  ],
);

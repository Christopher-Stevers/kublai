import {
  index,
  pgTableCreator,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { jobDrawingSheets, organizations } from "./schema";
import { chatPushSubscriptions } from "./chat-push-schema";
import { jobs, users } from "~/server/chat/tables";
import type {
  DrawingActivity,
  DrawingEntity,
  DrawingMetadata,
} from "~/lib/drawing-workspace";
const table = pgTableCreator((name) => `kublai_${name}`);
export const drawingWorkspaceEntities = table(
  "drawing_workspace_entity",
  (d) => ({
    id: d.uuid().primaryKey(),
    sheetId: d
      .uuid()
      .notNull()
      .references(() => jobDrawingSheets.id, { onDelete: "cascade" }),
    jobId: d
      .uuid()
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entity: d.jsonb().$type<DrawingEntity>().notNull(),
    revision: d.integer().notNull(),
  }),
  (t) => [
    index("drawing_workspace_entity_sheet_idx").on(t.sheetId),
    index("drawing_workspace_entity_job_idx").on(t.organizationId, t.jobId),
  ],
);
export const drawingWorkspaceMetadata = table(
  "drawing_workspace_metadata",
  (d) => ({
    sheetId: d
      .uuid()
      .primaryKey()
      .references(() => jobDrawingSheets.id, { onDelete: "cascade" }),
    data: d.jsonb().$type<DrawingMetadata>().notNull(),
    revision: d.integer().notNull(),
  }),
);
export const drawingWorkspaceFavorites = table(
  "drawing_workspace_favorite",
  (d) => ({
    sheetId: d
      .uuid()
      .notNull()
      .references(() => jobDrawingSheets.id, { onDelete: "cascade" }),
    userId: d.varchar({ length: 255 }).notNull(),
  }),
  (t) => [primaryKey({ columns: [t.sheetId, t.userId] })],
);
export const drawingWorkspaceActivity = table(
  "drawing_workspace_activity",
  (d) => ({
    id: d.uuid().primaryKey(),
    sheetId: d
      .uuid()
      .notNull()
      .references(() => jobDrawingSheets.id, { onDelete: "cascade" }),
    entry: d.jsonb().$type<DrawingActivity>().notNull(),
    createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    index("drawing_workspace_activity_sheet_idx").on(t.sheetId, t.createdAt),
  ],
);

export const drawingWorkspaceWatches = table(
  "drawing_workspace_watch",
  (d) => ({
    sheetId: d
      .uuid()
      .notNull()
      .references(() => jobDrawingSheets.id, { onDelete: "cascade" }),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  }),
  (t) => [primaryKey({ columns: [t.sheetId, t.userId] })],
);
export const drawingNotifications = table(
  "drawing_notification",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    sheetId: d
      .uuid()
      .notNull()
      .references(() => jobDrawingSheets.id, { onDelete: "cascade" }),
    entityId: d
      .uuid()
      .notNull()
      .references(() => drawingWorkspaceEntities.id, { onDelete: "cascade" }),
    revision: d.integer().notNull(),
    senderId: d.varchar({ length: 255 }).notNull(),
    recipientId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: d
      .varchar({ length: 16 })
      .$type<"watch" | "assignment" | "review">()
      .notNull(),
    createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
    readAt: d.timestamp({ withTimezone: true }),
  }),
  (t) => [
    uniqueIndex("drawing_notification_revision_recipient_uniq").on(
      t.entityId,
      t.revision,
      t.recipientId,
    ),
    index("drawing_notification_recipient_idx").on(t.recipientId, t.createdAt),
  ],
);
export const drawingPushOutbox = table(
  "drawing_push_outbox",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    notificationId: d
      .uuid()
      .notNull()
      .references(() => drawingNotifications.id, { onDelete: "cascade" }),
    subscriptionId: d
      .uuid()
      .notNull()
      .references(() => chatPushSubscriptions.id, { onDelete: "cascade" }),
    attempts: d.integer().notNull().default(0),
    availableAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
    leaseToken: d.uuid(),
    leasedUntil: d.timestamp({ withTimezone: true }),
    completedAt: d.timestamp({ withTimezone: true }),
    outcome: d.varchar({ length: 32 }),
    createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    uniqueIndex("drawing_push_notification_device_uniq").on(
      t.notificationId,
      t.subscriptionId,
    ),
    index("drawing_push_ready_idx").on(
      t.completedAt,
      t.availableAt,
      t.leasedUntil,
    ),
  ],
);

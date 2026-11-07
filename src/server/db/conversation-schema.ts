import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  bigint,
  bigserial,
  pgTableCreator,
  integer,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { organizations, users as legacyUsers } from "./schema";
import { chatPushSubscriptions } from "./chat-push-schema";
const chatPushSubscriptionId = (): AnyPgColumn => chatPushSubscriptions.id;
import type { SnapshotSource } from "~/lib/snapshot-source";

// Keep this reference lazy: schema.ts re-exports these tables. The legacy user
// table has loose inferred types; the FK still points to its actual ID column.
const userIdColumn = (): AnyPgColumn =>
  (legacyUsers as unknown as { id: AnyPgColumn }).id;

// Membership is checked for every read, write and file download. These private
// conversations are separate from the existing organization-visible job rooms.
export const conversations = pgTable(
  "kublai_conversation",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: varchar({ length: 8 }).$type<"direct" | "group">().notNull(),
    name: varchar({ length: 120 }).notNull().default(""),
    directKey: varchar({ length: 64 }),
    createdById: varchar({ length: 255 }).references(userIdColumn, {
      onDelete: "set null",
    }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("conversation_direct_key_unique").on(
      t.organizationId,
      t.directKey,
    ),
    index("conversation_org_idx").on(t.organizationId, t.updatedAt),
  ],
);
export const conversationMembers = pgTable(
  "kublai_conversation_member",
  {
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: varchar({ length: 255 })
      .notNull()
      .references(userIdColumn, { onDelete: "cascade" }),
    lastReadSequence: bigint({ mode: "number" }).notNull().default(0),
    joinedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    index("conversation_member_user_idx").on(t.userId),
  ],
);
export const conversationMessages = pgTable(
  "kublai_conversation_message",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sequence: bigserial({ mode: "number" }).notNull().unique(),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    authorId: varchar({ length: 255 }).references(userIdColumn, {
      onDelete: "set null",
    }),
    clientId: uuid().notNull(),
    requestHash: varchar({ length: 64 }).notNull(),
    body: text().notNull(),
    source: jsonb().$type<SnapshotSource>(),
    revision: integer().notNull().default(1),
    editedAt: timestamp({ withTimezone: true }),
    editClientId: uuid(),
    editRequestHash: varchar({ length: 64 }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("conversation_message_retry_unique").on(
      t.conversationId,
      t.authorId,
      t.clientId,
    ),
    index("conversation_message_page_idx").on(t.conversationId, t.sequence),
    index("conversation_message_author_time_idx").on(t.authorId, t.createdAt),
  ],
);
export const conversationAttachments = pgTable(
  "kublai_conversation_attachment",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    uploadedById: varchar({ length: 255 }).references(userIdColumn, {
      onDelete: "set null",
    }),
    messageId: uuid().references(() => conversationMessages.id, {
      onDelete: "cascade",
    }),
    name: varchar({ length: 200 }).notNull(),
    mimeType: varchar({ length: 80 }).notNull(),
    size: integer().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversation_attachment_message_idx").on(t.messageId),
    index("conversation_attachment_uploader_idx").on(
      t.uploadedById,
      t.createdAt,
    ),
  ],
);

// Shares device subscriptions with job chat; private conversation access is rechecked at delivery.
const pushTable = pgTableCreator((name) => `kublai_${name}`);
export const conversationPushOutbox = pushTable(
  "conversation_push_outbox",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    conversationId: d
      .uuid()
      .notNull()
      .references(() => conversations.id, {
        onDelete: "cascade",
      }),
    messageId: d
      .uuid()
      .notNull()
      .references(() => conversationMessages.id, { onDelete: "cascade" }),
    subscriptionId: d
      .uuid()
      .notNull()
      .references(() => chatPushSubscriptionId(), { onDelete: "cascade" }),
    recipientId: d
      .varchar({ length: 255 })
      .notNull()
      .references(userIdColumn, { onDelete: "cascade" }),
    senderId: d.varchar({ length: 255 }).notNull(),
    sequence: d.bigint({ mode: "number" }).notNull(),
    attempts: d.integer().notNull().default(0),
    availableAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
    leaseToken: d.uuid(),
    leasedUntil: d.timestamp({ withTimezone: true }),
    completedAt: d.timestamp({ withTimezone: true }),
    outcome: d.varchar({ length: 32 }),
    createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    uniqueIndex("conversation_push_message_device_uniq").on(
      t.messageId,
      t.subscriptionId,
    ),
    index("conversation_push_ready_idx").on(
      t.completedAt,
      t.availableAt,
      t.leasedUntil,
    ),
  ],
);

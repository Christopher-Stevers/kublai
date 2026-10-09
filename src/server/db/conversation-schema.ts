import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  bigint,
  bigserial,
  integer,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organizations, users as legacyUsers } from "./schema";

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
    createdById: varchar({ length: 255 }).references(() => legacyUsers.id!, {
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
      .references(() => legacyUsers.id!, { onDelete: "cascade" }),
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
    authorId: varchar({ length: 255 }).references(() => legacyUsers.id!, {
      onDelete: "set null",
    }),
    clientId: uuid().notNull(),
    requestHash: varchar({ length: 64 }).notNull(),
    body: text().notNull(),
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
    uploadedById: varchar({ length: 255 }).references(() => legacyUsers.id!, {
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

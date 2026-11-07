import {
  type AnyPgColumn,
  index,
  pgTableCreator,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { jobs, jobChatMessages, organizations, users } from "./schema";
import type { PushDeviceType } from "~/lib/member-notifications";

const table = pgTableCreator((name) => `kublai_${name}`);

// One browser endpoint belongs to one account at a time. Do not log these keys.
export const chatPushSubscriptions = table(
  "chat_push_subscription",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => (users as unknown as { id: AnyPgColumn }).id, {
        onDelete: "cascade",
      }),
    endpoint: d.text().notNull(),
    p256dh: d.text().notNull(),
    auth: d.text().notNull(),
    revokeTokenHash: d.varchar({ length: 64 }).notNull(),
    deviceType: d
      .varchar({ length: 16 })
      .$type<PushDeviceType>()
      .notNull()
      .default("unknown"),
    createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    uniqueIndex("chat_push_endpoint_uniq").on(t.endpoint),
    index("chat_push_user_idx").on(t.userId),
  ],
);

// Atomic with the message; a transport failure cannot delete/roll back a sent chat message.
export const chatPushOutbox = table(
  "chat_push_outbox",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    organizationId: d
      .uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    jobId: d
      .uuid()
      .notNull()
      .references(() => (jobs as unknown as { id: AnyPgColumn }).id, {
        onDelete: "cascade",
      }),
    messageId: d
      .uuid()
      .notNull()
      .references(
        () => (jobChatMessages as unknown as { id: AnyPgColumn }).id,
        { onDelete: "cascade" },
      ),
    subscriptionId: d
      .uuid()
      .notNull()
      .references(() => chatPushSubscriptions.id, { onDelete: "cascade" }),
    recipientId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => (users as unknown as { id: AnyPgColumn }).id, {
        onDelete: "cascade",
      }),
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
    uniqueIndex("chat_push_message_device_uniq").on(
      t.messageId,
      t.subscriptionId,
    ),
    index("chat_push_ready_idx").on(
      t.completedAt,
      t.availableAt,
      t.leasedUntil,
    ),
  ],
);

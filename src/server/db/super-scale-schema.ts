import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import type { SuperScaleOutput } from "~/lib/super-scale-job";
export const superScaleJobs = pgTable(
  "kublai_super_scale_job",
  {
    id: uuid().primaryKey(),
    userId: varchar({ length: 255 }).notNull(),
    organizationId: uuid().notNull(),
    sheetId: uuid().notNull(),
    first: text().notNull().default(""),
    second: text().notNull().default(""),
    status: text()
      .$type<"queued" | "running" | "completed" | "failed" | "cancelled">()
      .notNull()
      .default("queued"),
    progress: text().notNull().default("Queued"),
    attempts: integer().notNull().default(0),
    output: jsonb().$type<SuperScaleOutput>(),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("super_scale_user_sheet_idx").on(t.userId, t.sheetId, t.createdAt),
    index("super_scale_queue_idx").on(t.status, t.createdAt),
  ],
);

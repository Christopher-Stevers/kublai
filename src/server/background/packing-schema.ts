import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
export const packingSlipJobs = pgTable(
  "kublai_packing_slip_job",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    jobId: uuid().notNull(),
    documentId: uuid().notNull(),
    orderId: uuid(),
    versionId: uuid().notNull(),
    userId: varchar({ length: 255 }).notNull(),
    status: text()
      .$type<"queued" | "running" | "done" | "failed">()
      .notNull()
      .default("queued"),
    workerId: uuid(),
    leaseUntil: timestamp({ withTimezone: true }),
    attempts: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("packing_slip_job_queue_idx").on(t.status, t.createdAt)],
);

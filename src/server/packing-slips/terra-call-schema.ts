import {
  pgTable,
  uuid,
  text,
  timestamp,
  doublePrecision,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import type { readTerraFallback } from "./terra-fallback";
export const packingSlipTerraCalls = pgTable(
  "kublai_packing_slip_terra_call",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    jobId: uuid().notNull(),
    documentId: uuid().notNull(),
    versionId: uuid().notNull(),
    sourceHash: text().notNull(),
    requestHash: text().notNull(),
    status: text().$type<"reserved" | "done" | "failed">().notNull(),
    budgetUsd: doublePrecision().notNull(),
    result: jsonb().$type<Awaited<ReturnType<typeof readTerraFallback>>>(),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("packing_slip_terra_budget_idx").on(t.createdAt)],
);

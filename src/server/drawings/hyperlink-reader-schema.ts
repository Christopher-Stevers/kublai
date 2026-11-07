import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import type {
  HyperlinkDetection,
  VisionHyperlinkReader,
} from "~/lib/hyperlink-readers";

export const hyperlinkReaderRuns = pgTable(
  "kublai_hyperlink_reader_run",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    jobId: uuid().notNull(),
    sourceSheetId: uuid().notNull(),
    userId: text().notNull(),
    reader: text().$type<VisionHyperlinkReader>().notNull(),
    fingerprint: text().notNull(),
    status: text().$type<"reserved" | "done" | "failed">().notNull(),
    result: jsonb().$type<HyperlinkDetection>(),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("hyperlink_reader_budget_idx").on(t.organizationId, t.createdAt),
    index("hyperlink_reader_cache_idx").on(
      t.organizationId,
      t.sourceSheetId,
      t.reader,
      t.fingerprint,
    ),
  ],
);

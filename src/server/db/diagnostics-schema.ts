import {
  date,
  index,
  integer,
  pgTableCreator,
  primaryKey,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { organizations } from "./schema";
const table = pgTableCreator((name) => `kublai_${name}`);
export const diagnosticCounts = table(
  "diagnostic_count",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    day: date("day").notNull().defaultNow(),
    kind: varchar("kind", { length: 32 }).notNull(),
    feature: varchar("feature", { length: 24 }).notNull(),
    device: varchar("device", { length: 12 }).notNull(),
    release: varchar("release", { length: 40 }).notNull(),
    code: varchar("code", { length: 24 }).notNull(),
    duration: varchar("duration", { length: 16 }).notNull(),
    count: integer("count").notNull().default(1),
  },
  (t) => [
    primaryKey({
      columns: [
        t.organizationId,
        t.day,
        t.kind,
        t.feature,
        t.device,
        t.release,
        t.code,
        t.duration,
      ],
    }),
    index("diagnostic_count_day_idx").on(t.day),
  ],
);

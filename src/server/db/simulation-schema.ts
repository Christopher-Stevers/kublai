import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { organizations } from "./schema";
export const employeeSimulationSessions = pgTable(
  "kublai_employee_simulation_session",
  {
    id: uuid().primaryKey().defaultRandom(),
    tokenHash: varchar({ length: 64 }).notNull(),
    organizationId: uuid()
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: "cascade" }),
    actorId: varchar({ length: 255 }).notNull(),
    employeeId: varchar({ length: 255 }).notNull(),
    actorName: varchar({ length: 255 }).notNull(),
    employeeName: varchar({ length: 255 }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    endedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("simulation_token_hash_unique").on(t.tokenHash),
    index("simulation_actor_created_idx").on(t.actorId, t.createdAt),
  ],
);
export const employeeSimulationAudit = pgTable(
  "kublai_employee_simulation_audit",
  {
    id: uuid().primaryKey().defaultRandom(),
    sessionId: uuid()
      .notNull()
      .references(() => employeeSimulationSessions.id, { onDelete: "cascade" }),
    action: varchar({ length: 512 }).notNull(),
    outcome: varchar({ length: 32 }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("simulation_audit_session_created_idx").on(t.sessionId, t.createdAt),
  ],
);

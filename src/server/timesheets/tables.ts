/** Typed boundary for the existing circular user/job schema, shared with timesheet queries. */
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { users as legacyUsers, jobs as legacyJobs } from "~/server/db/schema";
type TextColumn = AnyPgColumn<{ data: string; notNull: true }>;
export const users = legacyUsers as unknown as PgTable & {
  id: TextColumn;
  organizationId: TextColumn;
  name: AnyPgColumn<{ data: string; notNull: false }>;
  email: TextColumn;
};
export const jobs = legacyJobs as unknown as PgTable & {
  id: TextColumn;
  organizationId: TextColumn;
  name: TextColumn;
};

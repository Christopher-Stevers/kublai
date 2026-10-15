/** Narrow the legacy circular Drizzle tables at this module boundary. */
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import {
  jobs as rawJobs,
  materialLists as rawLists,
  suppliers as rawSuppliers,
  users as rawUsers,
} from "~/server/db/schema";
type Text = AnyPgColumn<{ data: string; notNull: true }>;
type OptionalText = AnyPgColumn<{ data: string | null; notNull: false }>;
export const pricingJobs = rawJobs as unknown as PgTable & {
  id: Text;
  organizationId: Text;
  name: Text;
};
export const pricingMaterialLists = rawLists as unknown as PgTable & {
  id: Text;
  organizationId: Text;
  jobId: Text;
  name: Text;
  quoteId: OptionalText;
  kind: OptionalText;
};
export const pricingSuppliers = rawSuppliers as unknown as PgTable & {
  id: Text;
  organizationId: Text;
  name: Text;
};

export const pricingUsers = rawUsers as unknown as PgTable & {
  id: Text;
  name: OptionalText;
};

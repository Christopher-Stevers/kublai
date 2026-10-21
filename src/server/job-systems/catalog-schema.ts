import { pgTable, uuid, varchar } from "drizzle-orm/pg-core";
/** Read-only projection avoids the main schema's self-referential category inference. */
export const systemCatalogCategories = pgTable("kublai_category", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organizationId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
});

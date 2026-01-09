import { type Config } from "drizzle-kit";

import { env } from "~/env";

export default {
  schema: "./src/server/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  tablesFilter: ["kublai_*"],
  out: "./drizzle",
  schemaFilter: ["public"],
  // Note: drizzle-kit uses "drizzle" schema for migrations by default
  // We'll handle kublai_drizzle schema in the migration scripts
} satisfies Config;

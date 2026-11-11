// drizzle-kit 0.31 cannot serialize bigint column defaults in its snapshot diff.
// This process-local shim is restricted to the disposable schema builder.
Object.defineProperty(BigInt.prototype, "toJSON", {
  value() {
    return this.toString();
  },
  configurable: true,
});
import type { Config } from "drizzle-kit";
const directory = process.env.PERF_LAB_SOCKET;
const url = process.env.PERF_LAB_DATABASE_URL;
if (
  !directory?.startsWith("/tmp/foremanhq-perf-pg.") ||
  !url ||
  !url.includes(encodeURIComponent(directory))
)
  throw new Error(
    "Disposable performance database required; no DATABASE_URL fallback",
  );
export default {
  schema: "./src/server/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    host: directory,
    port: 55463,
    database: "foremanhq_perf_lab",
    user: process.env.USER ?? "tim",
    ssl: false,
  },
  tablesFilter: ["kublai_*"],
  schemaFilter: ["public"],
} satisfies Config;

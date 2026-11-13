import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "~/env";
import { recordQuery } from "./query-stats";
import { timedPostgresClient } from "./timed-client";
import * as schema from "./schema";

/**
 * Cache the database connection in development. This avoids creating a new connection on every HMR
 * update.
 */
const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

const poolMax = Number(process.env.DATABASE_POOL_MAX ?? 10);
if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 20) {
  throw new Error("DATABASE_POOL_MAX must be an integer from 1 to 20");
}
const conn = globalForDb.conn ?? postgres(env.DATABASE_URL, { max: poolMax });
if (env.NODE_ENV !== "production") globalForDb.conn = conn;

export const db = drizzle(timedPostgresClient(conn), {
  schema,
  logger: { logQuery: recordQuery },
});

// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { timedPostgresClient } from "./timed-client";
import { recordQuery, withQueryStats } from "./query-stats";
const socket = process.env.QUERY_TIMING_TEST_SOCKET;
const allowed = socket?.startsWith("/tmp/foremanhq-query-timing.") === true;
const conn = allowed
  ? postgres({ host: socket, port: 55464, database: "timing_test", max: 3 })
  : null;
afterAll(async () => {
  await conn?.end();
});
describe.skipIf(!allowed)("postgres-js timing integration", () => {
  it("measures real drizzle queries including nested transactions and errors", async () => {
    const db = drizzle(timedPostgresClient(conn!), {
      logger: { logQuery: recordQuery },
    });
    const { result, stats } = await withQueryStats(async () => {
      await db.execute(sql`select pg_sleep(0.01)`);
      return db.transaction(async (tx) =>
        tx.transaction(async (nested) =>
          nested.execute(sql`select 42 as answer, pg_sleep(0.01)`),
        ),
      );
    });
    expect(result[0]?.answer).toBe(42);
    expect(stats.count).toBe(2);
    expect(stats.databaseMs).toBeGreaterThanOrEqual(18);
    const failed = await withQueryStats(async () => {
      await expect(db.execute(sql`select 1 / 0`)).rejects.toThrow();
    });
    expect(failed.stats.count).toBe(1);
    expect(failed.stats.databaseMs).toBeGreaterThan(0);
  });
  it("keeps overlapping request metrics separate", async () => {
    const db = drizzle(timedPostgresClient(conn!));
    const [busy, empty] = await Promise.all([
      withQueryStats(() => db.execute(sql`select pg_sleep(0.015)`)),
      withQueryStats(async () => Promise.resolve()),
    ]);
    expect(busy.stats.databaseMs).toBeGreaterThanOrEqual(13);
    expect(empty.stats.databaseMs).toBe(0);
  });
});

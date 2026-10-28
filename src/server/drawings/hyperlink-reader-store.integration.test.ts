// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import {
  reserveHyperlinkRun,
  type HyperlinkRunScope,
} from "./hyperlink-reader-store";
import { hyperlinkReaderRuns as runs } from "./hyperlink-reader-schema";
import type { DrawingContext } from "./service";
const socket = process.env.HYPERLINK_TEST_SOCKET;
describe.skipIf(!socket)(
  "AI reading reservations in isolated PostgreSQL",
  () => {
    if (!socket?.startsWith("/tmp/foremanhq-hyperlink-pg."))
      throw Error("Refusing non-isolated database");
    const sql = postgres({
      host: socket,
      port: 55462,
      database: "hyperlink_integration",
      max: 5,
    });
    const db = drizzle(sql) as unknown as DrawingContext["db"];
    const base: HyperlinkRunScope = {
      id: randomUUID(),
      organizationId: randomUUID(),
      jobId: randomUUID(),
      sourceSheetId: randomUUID(),
      userId: "test-user",
      reader: "terra",
      fingerprint: "source-page-vocabulary",
    };
    const result = {
      reader: "terra" as const,
      model: "test",
      tags: [],
      warnings: [],
    };
    beforeAll(async () => {
      await sql.unsafe(
        await readFile("drizzle/0099_hyperlink_readers.sql", "utf8"),
      );
    });
    beforeEach(async () => {
      await sql`truncate kublai_hyperlink_reader_run`;
      vi.stubEnv("HYPERLINK_AI_DAILY_CALLS", "40");
    });
    afterAll(async () => {
      vi.unstubAllEnvs();
      await sql.end();
    });
    it("reserves concurrent identical scans once and rejects cross-scope request reuse", async () => {
      const attempts = await Promise.allSettled([
        reserveHyperlinkRun(db, base, false),
        reserveHyperlinkRun(db, { ...base, id: randomUUID() }, false),
      ]);
      expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const [saved] = await db.select().from(runs);
      await expect(
        reserveHyperlinkRun(
          db,
          { ...base, id: saved!.id, sourceSheetId: randomUUID() },
          false,
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await db.select().from(runs)).toHaveLength(1);
    });
    it("caches completed readings per source, vocabulary and model; refresh is explicit", async () => {
      await reserveHyperlinkRun(db, base, false);
      await db
        .update(runs)
        .set({ status: "done", result })
        .where(eq(runs.id, base.id));
      expect(
        await reserveHyperlinkRun(db, { ...base, id: randomUUID() }, false),
      ).toEqual({ cached: result });
      expect(await db.select().from(runs)).toHaveLength(1);
      expect(
        await reserveHyperlinkRun(db, { ...base, id: randomUUID() }, true),
      ).toEqual({ cached: null });
      expect(
        await reserveHyperlinkRun(
          db,
          { ...base, id: randomUUID(), reader: "deepseek" },
          false,
        ),
      ).toEqual({ cached: null });
      expect(await db.select().from(runs)).toHaveLength(3);
    });
    it("counts failed attempts against the daily budget but permits cached reads", async () => {
      vi.stubEnv("HYPERLINK_AI_DAILY_CALLS", "1");
      await reserveHyperlinkRun(db, base, false);
      await db
        .update(runs)
        .set({ status: "failed" })
        .where(eq(runs.id, base.id));
      await expect(reserveHyperlinkRun(db, base, false)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      await expect(
        reserveHyperlinkRun(db, { ...base, id: randomUUID() }, true),
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
      await db
        .update(runs)
        .set({ status: "done", result })
        .where(eq(runs.id, base.id));
      expect(
        await reserveHyperlinkRun(db, { ...base, id: randomUUID() }, false),
      ).toEqual({ cached: result });
    });
    it("bounds simultaneous work by organization and expires abandoned reservations", async () => {
      await reserveHyperlinkRun(db, base, false);
      await reserveHyperlinkRun(
        db,
        { ...base, id: randomUUID(), sourceSheetId: randomUUID() },
        false,
      );
      await expect(
        reserveHyperlinkRun(
          db,
          { ...base, id: randomUUID(), fingerprint: "changed" },
          false,
        ),
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
      await db
        .update(runs)
        .set({ createdAt: new Date(Date.now() - 6 * 60_000) })
        .where(eq(runs.id, base.id));
      expect(
        await reserveHyperlinkRun(db, { ...base, id: randomUUID() }, false),
      ).toEqual({ cached: null });
      expect(
        await reserveHyperlinkRun(
          db,
          { ...base, id: randomUUID(), organizationId: randomUUID() },
          false,
        ),
      ).toEqual({ cached: null });
    });
  },
);

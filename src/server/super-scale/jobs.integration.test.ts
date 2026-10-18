// @vitest-environment node
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, getTableColumns, getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { db as appDb } from "~/server/db";
import * as schema from "~/server/db/schema";
const state = vi.hoisted(() => ({
  db: null as unknown as typeof appDb,
  manage: true,
  org: "00000000-0000-4000-8000-000000000001",
  read: vi.fn(),
  revision: 4,
}));
vi.mock("~/server/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("../drawings/service", () => ({
  accessSheet: async (_: unknown, userId: string, sheetId: string) => {
    if (userId !== "owner" || sheetId !== id(3)) throw Error("Forbidden");
    return {
      actor: { canManage: state.manage, organizationId: state.org },
      sheet: { jobId: id(2) },
    };
  },
  getDrawingWorkspace: async () => ({
    jobId: id(2),
    metadata: { ...metadata(id(3), true), revision: state.revision },
    jobSheets: [sheet(id(3)), sheet(id(4)), sheet(id(5))],
  }),
  listDrawingWorkspace: async () =>
    [3, 4, 5].map((n) => ({
      sheetId: id(n),
      metadata: metadata(id(n), n !== 4),
    })),
}));
vi.mock("./reader", () => ({
  createServerGridReader: () => ({
    read: state.read,
    close: async () => undefined,
  }),
}));
vi.mock("~/server/conversations/push", () => ({
  enqueueConversationPush: vi.fn(async () => undefined),
}));
import { superScaleJobs } from "~/server/db/super-scale-schema";
import {
  conversations,
  conversationMembers,
  conversationMessages,
} from "~/server/db/conversation-schema";
import { startSuperScale, superScaleLatest, cancelSuperScale } from "./service";
import { runNextSuperScale } from "./runner";
import { drawingMetadataSchema } from "~/lib/drawing-workspace";
import { identifyGrids } from "~/lib/super-scale";
const socket = process.env.PURCHASE_TEST_SOCKET;
const conn = postgres({
  host: socket ?? "/tmp/no-super-scale-db",
  port: 55461,
  database: "purchase_integration",
  max: 8,
});
const db = drizzle(conn, {schema});
state.db = db;
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sheet = (s: string) => ({
  id: s,
  name: s,
  setId: id(6),
  setName: "Test",
  imageUrl: s,
  width: 1000,
  height: 1000,
});
const metadata = (s: string, scale = false) => ({
  ...drawingMetadataSchema.parse({
    scale: scale ? { unit: "m", unitsPerSheetWidth: 30 } : null,
  }),
  revision: 4,
  currentSourceSheetId: s,
});
const grids = identifyGrids(
  [0.2, 0.4, 0.6].map((x) => ({ x1: x, x2: x, y1: 0.1, y2: 0.9 })),
  [0.2, 0.4, 0.6].map((x, i) => ({
    text: String.fromCharCode(65 + i),
    x,
    y: 0.09,
  })),
  1,
);
const ctx = { db, userId: "owner" };
const tables = [
  superScaleJobs,
  conversations,
  conversationMembers,
  conversationMessages,
] as unknown as PgTable[];
describe.skipIf(!socket)("server Super scale durable jobs", () => {
  beforeAll(async () => {
    if (!socket?.startsWith("/tmp/foremanhq-purchase-pg."))
      throw Error("Isolated DB required");
    for (const table of tables) {
      const columns = Object.values(getTableColumns(table)).map(
        (c) => `"${c.name}" ${c.getSQLType()}`,
      );
      const pk =
        table === conversationMembers
          ? 'PRIMARY KEY ("conversationId","userId")'
          : "PRIMARY KEY (id)";
      await conn.unsafe(
        `CREATE TABLE "${getTableName(table)}" (${columns.join(",")}, ${pk})`,
      );
    }
    await conn`create unique index on kublai_conversation("organizationId","directKey")`;
    await conn`alter table kublai_super_scale_job alter status set default 'queued', alter attempts set default 0, alter progress set default 'Queued', alter "createdAt" set default now()`;
    await conn`alter table kublai_conversation_member alter "lastReadSequence" set default 0`;
  });
  beforeEach(async () => {
    for (const t of tables) await conn.unsafe(`truncate "${getTableName(t)}"`);
    state.manage = true;
    state.org = id(1);
    state.revision = 4;
    state.read.mockReset().mockResolvedValue(grids);
  });
  afterAll(async () => {
    await conn.end();
  });
  const start = (n = 10) =>
    startSuperScale(ctx, {
      id: id(n),
      sheetId: id(3),
      first: "A",
      second: "B",
    });
  it("completes with preserved scales and a private unread message, once", async () => {
    await start();
    await runNextSuperScale();
    await runNextSuperScale();
    const result = await superScaleLatest(ctx, id(3));
    expect(result?.status).toBe("completed");
    expect(result?.output?.rows[0]?.scale).toBeTruthy();
    expect(result?.output?.rows[1]?.status).toContain("Already calibrated");
    expect(state.read).toHaveBeenCalledTimes(2);
    const msgs = await db.select().from(conversationMessages);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.authorId).toBeNull();
    expect(msgs[0]?.body).toContain("no scales have been changed");
    const members = await db.select().from(conversationMembers);
    expect(members.map((m) => m.userId)).toEqual(["owner"]);
    expect(members[0]?.lastReadSequence).toBe(0);
  });
  it("deduplicates retries and prevents conflicting active work", async () => {
    expect((await start()).id).toBe((await start()).id);
    expect((await start(11)).id).toBe(id(10));
    await expect(
      startSuperScale(ctx, {
        id: id(12),
        sheetId: id(3),
        first: "A",
        second: "C",
      }),
    ).rejects.toThrow("already running");
  });
  it("enforces ownership and manager permissions", async () => {
    await start();
    await expect(
      superScaleLatest({ ...ctx, userId: "other" }, id(3)),
    ).rejects.toThrow();
    state.manage = false;
    await expect(start()).rejects.toThrow("management permission");
  });
  it("does not run or notify cancelled jobs", async () => {
    await start();
    await cancelSuperScale(ctx, { sheetId: id(3), id: id(10) });
    await runNextSuperScale();
    expect(state.read).not.toHaveBeenCalled();
    expect(await db.select().from(conversationMessages)).toHaveLength(0);
  });
  it("recovers interrupted jobs and records only one completion", async () => {
    await start();
    await db
      .update(superScaleJobs)
      .set({ status: "running", attempts: 1 })
      .where(eq(superScaleJobs.id, id(10)));
    await runNextSuperScale();
    expect((await superScaleLatest(ctx, id(3)))?.status).toBe("completed");
    expect(await db.select().from(conversationMessages)).toHaveLength(1);
  });
  it("rejects reference changes during scan", async () => {
    await start();
    state.read.mockImplementation(async () => {
      state.revision = 5;
      return grids;
    });
    await runNextSuperScale();
    expect((await superScaleLatest(ctx, id(3)))?.status).toBe("failed");
    expect((await db.select().from(conversationMessages))[0]?.body).toContain(
      "changed",
    );
  });
  it("limits retries and notifies failure", async () => {
    await start();
    await db.update(superScaleJobs).set({ attempts: 3, status: "running" }).where(eq(superScaleJobs.id,id(10)));
    await runNextSuperScale();
    expect((await superScaleLatest(ctx, id(3)))?.status).toBe("failed");
    expect(state.read).not.toHaveBeenCalled();
  });
  it("does not expose completed output after access is revoked", async () => {
    await start();
    state.manage = false;
    await runNextSuperScale();
    expect(await db.select().from(conversationMessages)).toHaveLength(0);
    await expect(superScaleLatest(ctx, id(3))).rejects.toThrow();
  });
});

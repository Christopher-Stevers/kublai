// @vitest-environment node
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Sql } from "postgres";
import { readFile } from "node:fs/promises";
import { getTableColumns, getTableName, eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { users as typedUsers } from "./tables";
import * as schema from "~/server/db/schema";
import type { RequestUser } from "~/server/utils/get-request-identity";
vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: vi.fn(),
}));
vi.mock("~/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { default: postgres } = await import("postgres");
  const schema = await import("~/server/db/schema");
  const conn = postgres({
    host: process.env.TIMESHEETS_TEST_SOCKET ?? "/tmp/no-time-test-cluster",
    port: 55449,
    database: "timesheets_integration",
    max: 8,
  });
  return { db: drizzle(conn, { schema }), __testConnection: conn };
});
import { db } from "~/server/db";
import { timesheetsRouter } from "~/server/api/routers/timesheets";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  foreignOrg = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const job = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  foreignJob = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const worker = "worker",
  other = "coworker",
  manager = "manager",
  foreign = "foreign";
const base = {
  organizationId: org,
  organizationAccessStatus: "approved",
  role: "worker",
  permissionConfig: null,
  name: "Worker",
  email: "worker@example.invalid",
};
function caller(id = worker, extra = {}) {
  return timesheetsRouter.createCaller({
    db,
    headers: new Headers(),
    userId: id,
    user: {
      ...base,
      id,
      ...(id === manager ? { role: "admin" } : {}),
      ...(id === foreign ? { organizationId: foreignOrg } : {}),
      ...extra,
    } as RequestUser,
  });
}
function entry(date = "2026-10-08", minutes = 450) {
  return {
    id: crypto.randomUUID(),
    date,
    jobId: job,
    category: "work" as const,
    minutes,
    breakMinutes: 30,
    costCode: "rough-in",
    notes: "Synthetic test",
  };
}
async function saved(user = worker) {
  await caller(user).saveEntry({ entry: entry(), expectedRevision: 0 });
  const selected = await caller(user).period({ date: "2026-10-08" });
  return selected.sheet!;
}
const socket = process.env.TIMESHEETS_TEST_SOCKET;
describe.skipIf(!socket)("Timesheets actual API / isolated PostgreSQL", () => {
  beforeAll(async () => {
    if (!socket?.startsWith("/tmp/foremanhq-time-pg."))
      throw Error("Refusing non-isolated database");
    const connection = (await import("~/server/db")) as unknown as {
      __testConnection: Sql;
    };
    const conn = connection.__testConnection;
    for (const table of [schema.organizations, schema.users, schema.jobs]) {
      const defs = Object.values(getTableColumns(table as PgTable)).map(
        (column) => `"${column.name}" ${column.getSQLType()}`,
      );
      await conn.unsafe(
        `CREATE TABLE "${getTableName(table)}" (${defs.join(",")}, PRIMARY KEY (id))`,
      );
    }
    await conn.unsafe(
      await readFile(
        new URL("../../../drizzle/0051_timesheets.sql", import.meta.url),
        "utf8",
      ),
    );
  });
  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE kublai_organization, kublai_user, kublai_job CASCADE`,
    );
    await db.insert(schema.organizations).values([
      { id: org, name: "Synthetic" },
      { id: foreignOrg, name: "Foreign" },
    ]);
    await db.insert(schema.users).values(
      [worker, other, manager, foreign].map((id) => ({
        id,
        email: `${id}@example.invalid`,
        name: id,
        organizationId: id === foreign ? foreignOrg : org,
      })),
    );
    await db.insert(schema.jobs).values([
      {
        id: job,
        organizationId: org,
        name: "Synthetic job",
        createdByUserId: worker,
      },
      {
        id: foreignJob,
        organizationId: foreignOrg,
        name: "Foreign job",
        createdByUserId: foreign,
      },
    ]);
  });
  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    const connection = (await import("~/server/db")) as unknown as {
      __testConnection: Sql;
    };
    await connection.__testConnection.end();
  });
  it("records net minutes, job snapshots, audit contents and personal reports", async () => {
    const sheet = await saved();
    const selected = await caller().period({ date: "2026-10-08" });
    expect(selected.entries[0]).toMatchObject({
      minutes: 450,
      breakMinutes: 30,
      jobName: "Synthetic job",
      source: "manual",
    });
    expect(selected.events).toHaveLength(1);
    expect(selected.events[0]?.data).toBeTruthy();
    expect(sheet).toMatchObject({
      startDate: "2026-10-05",
      endDate: "2026-10-11",
      revision: 1,
    });
    expect(
      await caller().report({
        from: "2026-10-01",
        to: "2026-10-31",
        team: false,
        approvedOnly: false,
      }),
    ).toHaveLength(1);
    expect(
      await caller().report({
        from: "2026-10-01",
        to: "2026-10-31",
        team: false,
        approvedOnly: true,
      }),
    ).toHaveLength(0);
  });
  it("rejects another employee, organization, foreign job and denied page", async () => {
    const sheet = await saved();
    await expect(
      caller(other).period({ date: "2026-10-08", userId: worker }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller(foreign).deleteEntry({
        sheetId: sheet.id,
        expectedRevision: 1,
        entryId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller().saveEntry({
        entry: { ...entry(), jobId: foreignJob },
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller(worker, {
        permissionConfig: {
          version: 2,
          permissions: { "tab.timesheets": false },
        },
      }).context(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller().list({ from: "2026-10-01", to: "2026-10-31", team: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller().report({ from: "2026-10-01", to: "2026-10-31", team: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("serializes concurrent submissions and never loses an edit", async () => {
    const results = await Promise.allSettled([
      caller().saveEntry({ entry: entry(), expectedRevision: 0 }),
      caller().saveEntry({ entry: entry(), expectedRevision: 0 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (await caller().period({ date: "2026-10-08" })).entries,
    ).toHaveLength(1);
  });
  it("locks submitted/approved periods, requires a return reason and retains history", async () => {
    const sheet = await saved();
    await caller().submit({ sheetId: sheet.id, expectedRevision: 1 });
    await expect(
      caller().saveEntry({ entry: entry(), expectedRevision: 2 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      caller(other).review({
        sheetId: sheet.id,
        expectedRevision: 2,
        decision: "approve",
        note: "",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller(manager).review({
      sheetId: sheet.id,
      expectedRevision: 2,
      decision: "approve",
      note: "",
    });
    await expect(
      caller().withdraw({ sheetId: sheet.id, expectedRevision: 3 }),
    ).rejects.toThrow();
    await expect(
      caller(manager).review({
        sheetId: sheet.id,
        expectedRevision: 3,
        decision: "return",
        note: "",
      }),
    ).rejects.toThrow();
    await caller(manager).review({
      sheetId: sheet.id,
      expectedRevision: 3,
      decision: "return",
      note: "Correct allocation",
    });
    await caller().saveEntry({
      entry: entry("2026-10-09", 60),
      expectedRevision: 4,
    });
    const result = await caller().period({ date: "2026-10-08" });
    expect(result.sheet).toMatchObject({
      status: "returned",
      reviewNote: "Correct allocation",
      revision: 5,
    });
    expect(result.events).toHaveLength(5);
  });
  it("can withdraw a submitted sheet but does not submit an empty period", async () => {
    const sheet = await saved();
    await caller().submit({ sheetId: sheet.id, expectedRevision: 1 });
    await caller().withdraw({ sheetId: sheet.id, expectedRevision: 2 });
    const selected = await caller().period({ date: "2026-10-08" });
    await caller().deleteEntry({
      sheetId: sheet.id,
      expectedRevision: 3,
      entryId: selected.entries[0]!.id,
    });
    await expect(
      caller().submit({ sheetId: sheet.id, expectedRevision: 4 }),
    ).rejects.toThrow();
    expect(
      (await caller().period({ date: "2026-10-08" })).events.some(
        (e) => e.action === "Entry deleted",
      ),
    ).toBe(true);
  });
  it("prevents duplicate hours exceeding a day and rolls back the failed edit", async () => {
    await caller().saveEntry({
      entry: entry("2026-10-08", 1000),
      expectedRevision: 0,
    });
    await expect(
      caller().saveEntry({
        entry: entry("2026-10-08", 500),
        expectedRevision: 1,
      }),
    ).rejects.toThrow("24 hours");
    const selected = await caller().period({ date: "2026-10-08" });
    expect(selected.entries).toHaveLength(1);
    expect(selected.sheet?.revision).toBe(1);
  });
  it("company chooses daily or weekly without rewriting old periods", async () => {
    await saved();
    await expect(
      caller().settings({
        cadence: "daily",
        weekStartsOn: 0,
        timezone: "UTC",
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller(manager).settings({
      cadence: "daily",
      weekStartsOn: 0,
      timezone: "UTC",
      expectedRevision: 0,
    });
    await expect(
      caller(manager).settings({
        cadence: "weekly",
        weekStartsOn: 1,
        timezone: "UTC",
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await caller().period({ date: "2026-10-08" })).end).toBe(
      "2026-10-11",
    );
    await caller().saveEntry({
      entry: entry("2026-10-12"),
      expectedRevision: 0,
    });
    expect((await caller().period({ date: "2026-10-12" })).start).toBe(
      "2026-10-12",
    );
    expect((await caller().period({ date: "2026-10-12" })).end).toBe(
      "2026-10-12",
    );
    await caller(manager).settings({
      cadence: "weekly",
      weekStartsOn: 1,
      timezone: "UTC",
      expectedRevision: 1,
    });
    await caller().saveEntry({
      entry: entry("2026-10-13"),
      expectedRevision: 0,
    });
    expect((await caller().period({ date: "2026-10-13" })).end).toBe(
      "2026-10-13",
    );
  });
  it("historical sheets remain reviewable after an employee leaves without exposing their new company", async () => {
    const sheet = await saved(other);
    await caller(other).submit({ sheetId: sheet.id, expectedRevision: 1 });
    await db
      .update(schema.users)
      .set({ organizationId: foreignOrg })
      .where(eq(typedUsers.id, other));
    expect(
      (await caller(manager).period({ date: "2026-10-08", userId: other }))
        .sheet?.id,
    ).toBe(sheet.id);
    await caller(manager).review({
      sheetId: sheet.id,
      expectedRevision: 2,
      decision: "approve",
      note: "",
    });
    await expect(
      caller(manager).saveEntry({
        entry: entry("2026-10-15"),
        userId: other,
        expectedRevision: 0,
      }),
    ).rejects.toThrow("Former employees");
    await expect(
      caller(foreign).period({ date: "2026-10-08", userId: other }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("permits only one persistent clock and audits cancellation", async () => {
    const result = await Promise.allSettled([
      caller().clockStart({ jobId: job, notes: "" }),
      caller().clockStart({ jobId: job, notes: "" }),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const clock = (await caller().context()).clock!;
    await caller().clockAction({
      id: clock.id,
      expectedRevision: 0,
      action: "pause",
    });
    await expect(
      caller().clockAction({
        id: clock.id,
        expectedRevision: 0,
        action: "resume",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await caller().clockAction({
      id: clock.id,
      expectedRevision: 1,
      action: "resume",
    });
    await caller().clockAction({
      id: clock.id,
      expectedRevision: 2,
      action: "cancel",
    });
    expect((await caller().context()).clock).toBeNull();
    expect(
      await caller().report({
        from: "2026-01-01",
        to: "2026-12-31",
        team: false,
        approvedOnly: false,
      }),
    ).toHaveLength(0);
    expect(
      (await caller().activity({ team: false })).some((e) =>
        e.action.includes("cancel"),
      ),
    ).toBe(true);
  });
  it("rejects read-only time recording and another worker's timer commands", async () => {
    await expect(
      caller(worker, {
        permissionConfig: {
          version: 2,
          permissions: { "timesheets.edit": false },
        },
      }).saveEntry({ entry: entry(), expectedRevision: 0 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller().clockStart({ jobId: job, notes: "" });
    const clock = (await caller().context()).clock!;
    await expect(
      caller(other).clockAction({
        id: clock.id,
        expectedRevision: 0,
        action: "cancel",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(caller().activity({ team: true })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await caller(other).activity({ team: false })).toHaveLength(0);
  });
  it("rolls back every overnight entry if any day is already approved", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T16:00:00Z"));
    await caller(manager).settings({
      cadence: "daily",
      weekStartsOn: 1,
      timezone: "America/Toronto",
      expectedRevision: 0,
    });
    await caller().clockStart({ jobId: job, notes: "" });
    const clock = (await caller().context()).clock!;
    await caller().saveEntry({
      entry: entry("2026-10-10", 60),
      expectedRevision: 0,
    });
    const future = (await caller().period({ date: "2026-10-10" })).sheet!;
    await caller().submit({ sheetId: future.id, expectedRevision: 1 });
    await caller(manager).review({
      sheetId: future.id,
      expectedRevision: 2,
      decision: "approve",
      note: "",
    });
    vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
    await db
      .update(schema.timeClocks)
      .set({
        periods: [
          {
            start: "2026-10-10T03:00:00Z",
            end: "2026-10-10T05:00:00Z",
            kind: "work",
          },
          { start: "2026-10-10T05:00:00Z", end: null, kind: "break" },
        ],
      })
      .where(eq(schema.timeClocks.id, clock.id));
    await expect(
      caller().clockAction({
        id: clock.id,
        expectedRevision: 0,
        action: "stop",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await caller().context()).clock?.id).toBe(clock.id);
    expect((await caller().period({ date: "2026-10-09" })).sheet).toBeNull();
    expect(
      (await caller().period({ date: "2026-10-10" })).entries,
    ).toHaveLength(1);
  });
  it("clock-out splits overnight work and a failed stop preserves the active clock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
    await caller().clockStart({ jobId: job, notes: "Overnight" });
    const clock = (await caller().context()).clock!;
    // Yesterday's 23:00 to today's 01:00 in Toronto, ending in a break until now.
    const today = (await caller().context()).today;
    const midnight = new Date(`${today}T04:00:00Z`).getTime();
    await db
      .update(schema.timeClocks)
      .set({
        periods: [
          {
            start: new Date(midnight - 3600000).toISOString(),
            end: new Date(midnight + 3600000).toISOString(),
            kind: "work",
          },
          {
            start: new Date(midnight + 3600000).toISOString(),
            end: null,
            kind: "break",
          },
        ],
      })
      .where(eq(schema.timeClocks.id, clock.id));
    await caller().clockAction({
      id: clock.id,
      expectedRevision: 0,
      action: "stop",
    });
    const rows = await caller().report({
      from: "2026-01-01",
      to: "2026-12-31",
      team: false,
      approvedOnly: false,
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.minutes)).toEqual([60, 60]);
    expect((await caller().context()).clock).toBeNull();
    await caller().clockStart({ jobId: null, notes: "" });
    const second = (await caller().context()).clock!;
    await db
      .update(schema.timeClocks)
      .set({
        periods: [
          {
            start: new Date(Date.now() - 35 * 86400000).toISOString(),
            end: null,
            kind: "work",
          },
        ],
      })
      .where(eq(schema.timeClocks.id, second.id));
    await expect(
      caller().clockAction({
        id: second.id,
        expectedRevision: 0,
        action: "stop",
      }),
    ).rejects.toThrow("over a month");
    expect((await caller().context()).clock?.id).toBe(second.id);
  });
});

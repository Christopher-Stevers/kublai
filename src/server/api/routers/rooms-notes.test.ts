// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

vi.mock("~/server/api/trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return { createTRPCRouter: t.router, hasDashboardAccess: t.procedure };
});
vi.mock("~/server/auth/permissions", () => ({ userCan: vi.fn() }));
vi.mock("~/server/rooms/detect-job", () => ({
  beginDetectJob: vi.fn(),
  failDetectJob: vi.fn(),
  getDetectJob: vi.fn(),
  growRoomOnFloor: vi.fn(),
}));
vi.mock("~/server/rooms/detect-worker-process", () => ({
  startDetectWorker: vi.fn(),
}));
vi.mock("~/server/rooms/drawing-hash", () => ({ sourceDrawingHash: vi.fn() }));

import { roomsRouter } from "./rooms";
import { jobRooms } from "~/server/db/schema";
import { userCan } from "~/server/auth/permissions";

const roomId = "00000000-0000-4000-8000-000000000001";
const floorId = "00000000-0000-4000-8000-000000000002";
const jobId = "00000000-0000-4000-8000-000000000003";
const organizationId = "00000000-0000-4000-8000-000000000004";
const otherOrganizationId = "00000000-0000-4000-8000-000000000005";
const floor = { id: floorId, organizationId, status: "confirmed" };
const room = {
  id: roomId,
  floorId,
  jobId,
  organizationId,
  name: "Room 301",
  notes: "Existing room notes",
  notesRevision: 4,
  confirmed: true,
  reviewStatus: "approved",
  updatedAt: new Date(123_000),
  shape: { type: "bbox", x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
  detection: null,
};
type Row = Record<string, unknown>;

function setup(reads: Row[][] = [[{ floorId }], [floor], [room]]) {
  const queued = [...reads];
  const predicates: SQL[] = [];
  const locks: string[] = [];
  const writes: Array<{ table: unknown; data: Row }> = [];
  const select = vi.fn(() => {
    const rows = queued.shift();
    if (!rows) throw new Error("Unexpected database read");
    const query = Object.assign(Promise.resolve(rows), {
      from: (_table: unknown) => query,
      where: (predicate: SQL) => {
        predicates.push(predicate);
        return query;
      },
      for: (lock: string) => {
        locks.push(lock);
        return query;
      },
      limit: (_count: number) => query,
      orderBy: (..._order: unknown[]) => query,
    });
    return query;
  });
  const tx = {
    select,
    update: vi.fn((table: unknown) => ({
      set: (data: Row) => ({
        where: async (predicate: SQL) => {
          predicates.push(predicate);
          writes.push({ table, data });
        },
      }),
    })),
  };
  const db = {
    ...tx,
    transaction: vi.fn(async (fn: (transaction: typeof tx) => unknown) =>
      fn(tx),
    ),
  };
  return {
    caller: roomsRouter.createCaller({
      db,
      user: { id: "worker", organizationId },
    } as never),
    db,
    predicates,
    locks,
    writes,
  };
}

beforeEach(() => {
  // Field staff can edit jobs and lists without being room reviewers.
  vi.mocked(userCan)
    .mockReset()
    .mockImplementation(
      (_user, key) => key === "jobs.edit" || key === "lists.edit",
    );
});

const input = {
  roomId,
  notes: "Check ceiling clearance.\nBring two 45° elbows.",
  expectedNotesRevision: 4,
};

describe("shared room notes", () => {
  it("saves multiline notes without changing outlines, review status, or floor confirmation", async () => {
    const test = setup();
    await expect(test.caller.updateNotes(input)).resolves.toEqual({
      notes: input.notes,
      notesRevision: 5,
    });
    expect(test.writes).toEqual([
      {
        table: jobRooms,
        data: {
          notes: input.notes,
          notesRevision: 5,
          updatedAt: expect.any(Date) as unknown,
        },
      },
    ]);
    expect(test.locks).toEqual(["share", "update"]);
    const dialect = new PgDialect();
    for (const predicate of test.predicates) {
      const query = dialect.sqlToQuery(predicate);
      expect(query.sql).toContain('"organizationId"');
      expect(query.params).toContain(organizationId);
    }
  });

  it("allows clearing notes and preserves whitespace as entered", async () => {
    const test = setup();
    await expect(
      test.caller.updateNotes({ ...input, notes: "" }),
    ).resolves.toEqual({
      notes: "",
      notesRevision: 5,
    });
    expect(test.writes[0]?.data.notes).toBe("");
    const whitespace = setup();
    await whitespace.caller.updateNotes({
      ...input,
      notes: "  measured\n  5 ft  ",
    });
    expect(whitespace.writes[0]?.data.notes).toBe("  measured\n  5 ft  ");
  });

  it("does not create a new revision for unchanged notes", async () => {
    const test = setup();
    await expect(
      test.caller.updateNotes({ ...input, notes: room.notes }),
    ).resolves.toEqual({
      notes: room.notes,
      notesRevision: 4,
    });
    expect(test.writes).toEqual([]);
  });

  it("rejects a stale revision without overwriting a colleague's notes", async () => {
    const test = setup();
    await expect(
      test.caller.updateNotes({ ...input, expectedNotesRevision: 3 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(test.writes).toEqual([]);
  });

  it("requires jobs.edit before reading or writing notes", async () => {
    vi.mocked(userCan).mockReturnValue(false);
    const test = setup([]);
    await expect(test.caller.updateNotes(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(test.db.transaction).not.toHaveBeenCalled();
    expect(test.db.select).not.toHaveBeenCalled();
    expect(test.writes).toEqual([]);
  });

  it.each([
    [[]],
    [[{ floorId }], []],
    [[{ floorId }], [{ ...floor, organizationId: otherOrganizationId }]],
    [[{ floorId }], [floor], []],
    [
      [{ floorId }],
      [floor],
      [{ ...room, organizationId: otherOrganizationId }],
    ],
  ])(
    "does not reveal or write a missing or foreign-organization room (%#)",
    async (...reads) => {
      const test = setup(reads as Row[][]);
      await expect(test.caller.updateNotes(input)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(test.writes).toEqual([]);
    },
  );

  it.each([
    {
      floor: { ...floor, status: "detected" },
      room: { ...room, confirmed: false, reviewStatus: "pending" },
    },
    { floor, room: { ...room, confirmed: false } },
  ])(
    "allows field staff to write notes on active rooms without approval (%#)",
    async (rows) => {
      const test = setup([[{ floorId }], [rows.floor], [rows.room]]);
      await expect(test.caller.updateNotes(input)).resolves.toMatchObject({
        notesRevision: 5,
      });
    },
  );
  it("hides rejected rooms from field staff", async () => {
    const test = setup([
      [{ floorId }],
      [floor],
      [{ ...room, reviewStatus: "rejected" }],
    ]);
    await expect(test.caller.updateNotes(input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(test.writes).toEqual([]);
  });
  it("lets reviewers add notes to visible draft rooms", async () => {
    vi.mocked(userCan).mockReturnValue(true);
    const test = setup([
      [{ floorId }],
      [{ ...floor, status: "detected" }],
      [{ ...room, confirmed: false, reviewStatus: "pending" }],
    ]);
    await expect(test.caller.updateNotes(input)).resolves.toMatchObject({
      notesRevision: 5,
    });
  });

  it("keeps pending-review floors hidden even from reviewers", async () => {
    vi.mocked(userCan).mockReturnValue(true);
    const test = setup([
      [{ floorId }],
      [{ ...floor, status: "pending_review" }],
      [room],
    ]);
    await expect(test.caller.updateNotes(input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(test.writes).toEqual([]);
  });

  it("rejects notes on superseded room proposals", async () => {
    vi.mocked(userCan).mockReturnValue(true);
    const test = setup([
      [{ floorId }],
      [floor],
      [{ ...room, reviewStatus: "superseded" }],
    ]);
    await expect(test.caller.updateNotes(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(test.writes).toEqual([]);
  });

  it.each([
    { ...input, notes: "a".repeat(10_001) },
    { ...input, expectedNotesRevision: -1 },
  ])(
    "validates text length and revision before accessing the database (%#)",
    async (value) => {
      const test = setup([]);
      await expect(test.caller.updateNotes(value)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(test.db.transaction).not.toHaveBeenCalled();
    },
  );

  it("returns persisted notes and independent action permissions with job rooms", async () => {
    const test = setup([
      [{ id: jobId, organizationId }],
      [
        {
          id: "plan",
          status: "ready",
          originalFilename: "floor.pdf",
          pageCount: 1,
          error: null,
        },
      ],
      [floor],
      [room],
    ]);
    const result = await test.caller.getJobRooms({ jobId });
    expect(result).toMatchObject({
      canManage: false,
      canEditNotes: true,
      canRequestMaterial: true,
      floors: [
        { rooms: [{ id: roomId, notes: room.notes, notesRevision: 4 }] },
      ],
    });
  });
});

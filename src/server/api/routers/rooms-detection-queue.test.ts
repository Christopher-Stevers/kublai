// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

vi.mock("~/server/api/trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return { createTRPCRouter: t.router, hasDashboardAccess: t.procedure };
});
vi.mock("~/server/auth/permissions", () => ({ userCan: vi.fn(() => true) }));
vi.mock("~/server/rooms/detect-job", () => ({
  enqueueDetectJobs: vi.fn(async () => []),
  getDetectJob: vi.fn(),
  growRoomOnFloor: vi.fn(),
}));
vi.mock("~/server/rooms/detect-worker-process", () => ({ dispatchDetectQueue: vi.fn(async () => undefined) }));
vi.mock("~/server/rooms/drawing-hash", () => ({ sourceDrawingHash: vi.fn() }));

import { roomsRouter } from "./rooms";
import { enqueueDetectJobs } from "~/server/rooms/detect-job";
import { dispatchDetectQueue } from "~/server/rooms/detect-worker-process";
import { userCan } from "~/server/auth/permissions";
import { jobFloors } from "~/server/db/schema";

const organizationId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const floorId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const floor = (n: number) => ({
  id: floorId(n), organizationId, jobId, pageNumber: n,
  status: "pending_review", imageUrl: `/api/job-rooms/files/${jobId}/floor-${n}.webp`,
});
type Row = Record<string, unknown>;
function setup(reads: Row[][]) {
  const queued = [...reads];
  const writes: Array<{ table: unknown; set?: unknown; action: string }> = [];
  const select = vi.fn(() => {
    const rows = queued.shift();
    if (!rows) throw new Error("Unexpected database read");
    const query = Object.assign(Promise.resolve(rows), {
      from: () => query, where: () => query, orderBy: () => query,
      for: () => query, limit: () => query,
    });
    return query;
  });
  const tx = {
    execute: vi.fn(async (statement: SQL) => {
      if (new PgDialect().sqlToQuery(statement).sql.includes("select id from kublai_job")) return queued.shift() ?? [];
      return [];
    }), select,
    delete: vi.fn((table: unknown) => ({ where: async () => { writes.push({ table, action: "delete" }); } })),
    update: vi.fn((table: unknown) => ({ set: (set: unknown) => ({ where: async () => { writes.push({ table, set, action: "update" }); } }) })),
  };
  let committed = false;
  const db = { ...tx, transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => {
    const result = await fn(tx); committed = true; return result;
  }) };
  return {
    caller: roomsRouter.createCaller({ db, user: { id: "u", organizationId } } as never),
    tx, db, writes, committed: () => committed,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(userCan).mockReturnValue(true);
  vi.mocked(enqueueDetectJobs).mockResolvedValue([]);
  vi.mocked(dispatchDetectQueue).mockResolvedValue();
});

describe("durable drawing detection submission", () => {
  it("saves and queues a large set in one transaction before dispatch, without client fanout", async () => {
    const sheets = Array.from({ length: 60 }, (_, n) => floor(n + 100));
    const test = setup([[{ id: jobId, organizationId }], sheets]);
    vi.mocked(dispatchDetectQueue).mockImplementation(async () => { expect(test.committed()).toBe(true); });
    const kept = sheets.slice(0, 59).map((sheet) => sheet.id);
    await expect(test.caller.confirmDrawingUpload({ jobId, keepFloorIds: kept })).resolves.toEqual({ keptFloorIds: kept });
    expect(enqueueDetectJobs).toHaveBeenCalledExactlyOnceWith(kept, organizationId, test.tx);
    expect(test.writes.map(({ table, action }) => ({ table, action }))).toEqual([
      { table: jobFloors, action: "delete" },
      { table: jobFloors, action: "update" },
    ]);
    expect(test.writes[1]?.set).toMatchObject({ status: "detected" });
    expect(dispatchDetectQueue).toHaveBeenCalledTimes(1);
  });

  it("does not commit confirmed sheets or dispatch when queue persistence fails", async () => {
    const test = setup([[{ id: jobId, organizationId }], [floor(100)]]);
    vi.mocked(enqueueDetectJobs).mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(test.caller.confirmDrawingUpload({ jobId, keepFloorIds: [floorId(100)] })).rejects.toThrow("Database unavailable");
    expect(test.committed()).toBe(false);
    expect(dispatchDetectQueue).not.toHaveBeenCalled();
  });

  it("accepts a single sheet through the same queue while other sheets are busy", async () => {
    const test = setup([[{ ...floor(100), status: "detected" }]]);
    await expect(test.caller.detectRooms({ floorId: floorId(100) })).resolves.toEqual({ started: true });
    expect(enqueueDetectJobs).toHaveBeenCalledExactlyOnceWith([floorId(100)], organizationId, test.tx);
  });

  it("rejects pending or foreign sheets and callers without drawing permission", async () => {
    await expect(setup([[floor(100)]]).caller.detectRooms({ floorId: floorId(100) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(setup([[]]).caller.detectRooms({ floorId: floorId(100) })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setup([[]]).caller.confirmDrawingUpload({ jobId, keepFloorIds: [floorId(100)] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    vi.mocked(userCan).mockReturnValue(false);
    const test = setup([]);
    await expect(test.caller.detectRooms({ floorId: floorId(100) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(test.db.transaction).not.toHaveBeenCalled();
    expect(enqueueDetectJobs).not.toHaveBeenCalled();
  });

  it("protects a queued floor from copying, confirming, deleting, or clearing rooms", async () => {
    const active = [{ status: "queued" }];
    await expect(setup([active]).caller.copyFloor({ floorId: floorId(100) })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(setup([active]).caller.confirmFloor({ floorId: floorId(100), completenessChecked: true })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(setup([active]).caller.deleteFloor({ floorId: floorId(100) })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(setup([[floor(100)], active]).caller.deleteAllRooms({ floorId: floorId(100) })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

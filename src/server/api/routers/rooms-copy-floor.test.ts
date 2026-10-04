// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("~/server/rooms/detect-worker-process", () => ({ startDetectWorker: vi.fn() }));
vi.mock("~/server/rooms/drawing-hash", () => ({ sourceDrawingHash: vi.fn() }));

import { roomsRouter } from "./rooms";
import { jobFloors, jobRooms } from "~/server/db/schema";
import { userCan } from "~/server/auth/permissions";

const organizationId = "00000000-0000-4000-8000-000000000004";
const floorId = "00000000-0000-4000-8000-000000000002";
const copyId = "00000000-0000-4000-8000-000000000009";
const floor = {
  id: floorId,
  organizationId,
  jobId: "job-1",
  floorPlanId: "plan-1",
  pageNumber: 2,
  name: "Level 2",
  imageUrl: "/api/job-rooms/files/job-1/up/floor-2.webp",
  width: 4000,
  height: 3000,
  status: "confirmed",
  confirmedAt: new Date(1),
  completenessReviewedAt: new Date(2),
};
const room = (name: string) => ({
  id: `room-${name}`,
  organizationId,
  jobId: "job-1",
  floorId,
  name,
  notes: "Only true on level 2",
  notesRevision: 3,
  source: "auto",
  confirmed: true,
  reviewStatus: "approved",
  detection: { score: 1 },
  shape: { type: "bbox", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
  sortOrder: 4,
});
type Row = Record<string, unknown>;

function setup(reads: Row[][]) {
  const queued = [...reads];
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const select = vi.fn(() => {
    const rows = queued.shift();
    if (!rows) throw new Error("Unexpected database read");
    const query = Object.assign(Promise.resolve(rows), {
      from: () => query,
      where: () => query,
      for: () => query,
    });
    return query;
  });
  const tx = {
    select,
    execute: vi.fn(async () => undefined),
    insert: vi.fn((table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        return Object.assign(Promise.resolve(), {
          returning: async () => [{ id: copyId }],
        });
      },
    })),
  };
  const db = {
    transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return {
    caller: roomsRouter.createCaller({ db, user: { id: "u", organizationId } } as never),
    inserts,
  };
}

beforeEach(() => {
  vi.mocked(userCan).mockReset().mockReturnValue(true);
});

describe("copy floor", () => {
  it("copies the floor last in the set with its room outlines, but not the notes", async () => {
    const test = setup([[], [floor], [{ page: 5 }], [room("201"), room("202")]]);
    await expect(test.caller.copyFloor({ floorId })).resolves.toEqual({
      floorId: copyId,
      roomCount: 2,
    });
    const [floorInsert, roomInsert] = test.inserts;
    expect(floorInsert!.table).toBe(jobFloors);
    expect(floorInsert!.values).toMatchObject({
      floorPlanId: "plan-1",
      pageNumber: 6,
      name: "Level 2 (copy)",
      imageUrl: floor.imageUrl,
      status: "confirmed",
    });
    expect(roomInsert!.table).toBe(jobRooms);
    const rooms = roomInsert!.values as Row[];
    expect(rooms.map((r) => r.name)).toEqual(["201", "202"]);
    for (const copied of rooms) {
      expect(copied).toMatchObject({
        floorId: copyId,
        reviewStatus: "approved",
        shape: floor && room("x").shape,
      });
      expect(copied).not.toHaveProperty("id");
      expect(copied).not.toHaveProperty("notes");
      expect(copied).not.toHaveProperty("notesRevision");
    }
  });

  it("copies an empty floor without inserting rooms", async () => {
    const test = setup([[], [floor], [{ page: 2 }], []]);
    await expect(test.caller.copyFloor({ floorId })).resolves.toEqual({
      floorId: copyId,
      roomCount: 0,
    });
    expect(test.inserts).toHaveLength(1);
  });

  it("refuses while detection runs, for missing floors, and without permission", async () => {
    await expect(
      setup([[{ status: "running" }]]).caller.copyFloor({ floorId }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(setup([[], []]).caller.copyFloor({ floorId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    vi.mocked(userCan).mockReturnValue(false);
    await expect(setup([]).caller.copyFloor({ floorId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

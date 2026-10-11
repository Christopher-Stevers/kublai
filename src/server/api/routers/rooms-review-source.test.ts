// @vitest-environment node
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the real mutation bodies, schemas, and geometry validation. The
// caller is already authenticated; no test connects to the application DB.
vi.mock("~/server/api/trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return { createTRPCRouter: t.router, hasDashboardAccess: t.procedure };
});
vi.mock("~/server/auth/permissions", () => ({ userCan: vi.fn(() => true) }));
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

import { userCan } from "~/server/auth/permissions";
import { jobFloors, jobRooms, roomDetectionFeedback } from "~/server/db/schema";
import { growRoomOnFloor } from "~/server/rooms/detect-job";
import { sourceDrawingHash } from "~/server/rooms/drawing-hash";
import { roomsRouter } from "./rooms";

const roomId = "00000000-0000-4000-8000-000000000001";
const floorId = "00000000-0000-4000-8000-000000000002";
const jobId = "00000000-0000-4000-8000-000000000003";
const organizationId = "00000000-0000-4000-8000-000000000004";
const hash = "a".repeat(64);
const updatedAt = new Date(123_000);
const shape = {
  type: "polygon" as const,
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ],
  holes: [
    [
      { x: 0.4, y: 0.4 },
      { x: 0.4, y: 0.6 },
      { x: 0.6, y: 0.6 },
      { x: 0.6, y: 0.4 },
    ],
  ],
};
const floor = {
  id: floorId,
  jobId,
  organizationId,
  imageUrl: `/api/job-rooms/files/${jobId}/floor-18.webp`,
  // This is deliberately NOT the original PDF page.
  pageNumber: 19,
};
const proposal = {
  id: roomId,
  floorId,
  jobId,
  organizationId,
  updatedAt,
  shape,
  name: "Unlabeled hallway",
  source: "auto",
  reviewStatus: "pending",
  confirmed: false,
  detection: {
    drawingHash: hash,
    sourcePageNumber: 18,
    sourcePageIndex: 17,
    version: "physical-fixture",
    requiresReview: true,
  },
};
type Row = Record<string, unknown>;

function setup(reads: Row[][]) {
  const queued = [...reads];
  const predicates: SQL[] = [];
  const writes: Array<{
    kind: "insert" | "update";
    table: unknown;
    data: unknown;
  }> = [];
  const select = vi.fn(() => {
    const rows = queued.shift();
    if (!rows) throw new Error("Unexpected database read");
    const query = Object.assign(Promise.resolve(rows), {
      from: (_table: unknown) => query,
      where: (predicate: SQL) => {
        predicates.push(predicate);
        return query;
      },
      for: (_lock: string) => query,
      limit: (_count: number) => query,
    });
    return query;
  });
  const tx = {
    select,
    execute: vi.fn(async (_query: unknown) => undefined),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((data: unknown) => {
        writes.push({ kind: "insert", table, data });
        return Object.assign(Promise.resolve(undefined), {
          returning: async () => [{ ...(data as Row), id: roomId }],
        });
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((data: unknown) => ({
        where: vi.fn(async (_predicate: unknown) => {
          writes.push({ kind: "update", table, data });
        }),
      })),
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
      user: { id: "reviewer", organizationId },
    } as never),
    db,
    tx,
    writes,
    predicates,
    feedback: () =>
      writes.find((write) => write.table === roomDetectionFeedback)?.data,
    roomUpdate: () =>
      writes.find((write) => write.table === jobRooms)?.data as Row,
    floorUpdate: () =>
      writes.find((write) => write.table === jobFloors)?.data as Row,
  };
}
function expectNoWrites(test: ReturnType<typeof setup>) {
  expect(test.tx.insert).not.toHaveBeenCalled();
  expect(test.tx.update).not.toHaveBeenCalled();
  expect(test.writes).toEqual([]);
}

beforeEach(() => {
  vi.mocked(sourceDrawingHash).mockReset().mockResolvedValue(hash);
  vi.mocked(userCan).mockReset().mockReturnValue(true);
});

describe("source-bound room edit feedback", () => {
  it("only protects active manual or approved trace neighbors, excluding the edited room", async () => {
    const neighbor = { id: "00000000-0000-4000-8000-000000000005", shape };
    const approvedNeighbor = {
      id: "00000000-0000-4000-8000-000000000006",
      shape,
    };
    // The real query must discard rejected/superseded rooms and pending auto
    // proposals (which may cover an entire sheet); these are its returned rows.
    const test = setup([
      [floor],
      [{ ...proposal, source: "manual" }, neighbor, approvedNeighbor],
    ]);
    vi.mocked(growRoomOnFloor).mockResolvedValue({ shape } as never);
    await test.caller.growRoom({
      floorId,
      roomId,
      include: [{ x: 0.2, y: 0.2 }],
      exclude: [],
    });
    const query = new PgDialect().sqlToQuery(test.predicates[1]!);
    expect(query.sql).toMatch(/"reviewStatus" in/);
    expect(query.sql).toMatch(
      /and \("kublai_job_room"\."source" = \$5 or "kublai_job_room"\."reviewStatus" = \$6\)/,
    );
    expect(query.params).toEqual([
      floorId,
      organizationId,
      "pending",
      "approved",
      "manual",
      "approved",
    ]);
    expect(growRoomOnFloor).toHaveBeenCalledWith(
      expect.objectContaining({
        otherRooms: [neighbor, approvedNeighbor],
        source: expect.objectContaining({ floorId }) as unknown,
      }),
    );
    expectNoWrites(test);
  });
  it("binds new manual outlines to the original PDF page at creation", async () => {
    const test = setup([[floor], [], [floor]]);
    await test.caller.addRoom({ floorId, name: "Unlabeled hallway", shape });
    expect(
      test.writes.find((write) => write.table === jobRooms)?.data,
    ).toMatchObject({
      source: "manual",
      reviewStatus: "pending",
      confirmed: false,
      shape,
      detection: {
        basis: "human-added-space",
        requiresReview: false,
        drawingHash: hash,
        sourcePageNumber: 18,
        sourcePageIndex: 17,
      },
    });
  });

  it.each([
    { name: "Renamed hallway" },
    { shape: { type: "bbox" as const, x: 0.1, y: 0.1, w: 0.4, h: 0.4 } },
  ])("does not rebind old geometry while editing %j", async (input) => {
    const old = { ...proposal, detection: { drawingHash: "b".repeat(64) } };
    const test = setup([[old], [], [floor], [old]]);
    await expect(
      test.caller.updateRoom({ roomId, ...input }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expectNoWrites(test);
  });

  it("records a rename while preserving the original hole geometry", async () => {
    const test = setup([[proposal], [], [floor], [proposal]]);
    await test.caller.updateRoom({
      roomId,
      name: "Hallway",
      expectedUpdatedAt: updatedAt.getTime(),
    });
    expect(test.feedback()).toMatchObject({
      decision: "renamed",
      proposalShape: shape,
      correctedShape: null,
      detection: expect.objectContaining(proposal.detection) as unknown,
    });
    expect(test.roomUpdate()).toMatchObject({
      name: "Hallway",
      reviewStatus: "pending",
      confirmed: false,
      detection: expect.objectContaining(proposal.detection) as unknown,
    });
  });
});

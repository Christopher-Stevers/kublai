// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./detect-job", () => ({
  enqueueDetectJobs: vi.fn(async () => []),
}));

import { jobFloorPlans, jobFloors } from "~/server/db/schema";
import { enqueueDetectJobs } from "./detect-job";
import { addFloorsFromDrawings, roomSourceImage } from "./floors-from-drawings";

const organizationId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const uploadId = "00000000-0000-4000-8000-0000000000aa";
const image = (page: number, job = jobId) =>
  `/api/job-rooms/files/${job}/${uploadId}/floor-${page}.webp`;
const sheet = (id: string, page: number, url = image(page)) => ({
  id,
  name: `A-10${page}`,
  imageUrl: url,
  width: 3000,
  height: 2000,
  sourceFilename: "Architectural.pdf",
});

type Row = Record<string, unknown>;
function fakeDb(reads: Row[][], job: Row[] = [{ id: jobId }]) {
  const queued = [...reads];
  const writes: Array<{ table: unknown; action: string; values: unknown }> = [];
  const select = vi.fn(() => {
    const rows = queued.shift();
    if (!rows) throw new Error("Unexpected database read");
    const query = Object.assign(Promise.resolve(rows), {
      from: () => query,
      innerJoin: () => query,
      where: () => query,
      orderBy: () => query,
      limit: () => query,
    });
    return query;
  });
  const tx = {
    execute: vi.fn(async () => job),
    select,
    insert: vi.fn((table: unknown) => ({
      values: (values: unknown) => {
        writes.push({ table, action: "insert", values });
        const rows = (Array.isArray(values) ? values : [values]).map(
          (row: Row, index) => ({ ...row, id: `new-${index + 1}` }),
        );
        return { returning: async () => rows };
      },
    })),
    update: vi.fn((table: unknown) => ({
      set: (values: unknown) => ({
        where: async () => {
          writes.push({ table, action: "update", values });
        },
      }),
    })),
  };
  const db = {
    transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { db: db as never, writes, tx };
}

const input = (sheetIds: string[]) => ({
  jobId,
  organizationId,
  userId: "user-1",
  sheetIds,
});

beforeEach(() => vi.clearAllMocks());

describe("Rooms floors from Drawings", () => {
  it("only accepts stored pages of this job's uploads", () => {
    expect(roomSourceImage(image(3), jobId)).toEqual({
      pdfKey: `${jobId}/${uploadId}/plan.pdf`,
    });
    expect(roomSourceImage(image(3, organizationId), jobId)).toBeNull();
    expect(
      roomSourceImage(
        `/api/job-documents/pages/${uploadId}/1?jobId=${jobId}`,
        jobId,
      ),
    ).toBeNull();
  });

  it("shares each sheet's stored page, skips sheets already on Rooms and queues the rest in the same transaction", async () => {
    const { db, writes, tx } = fakeDb([
      [sheet("s1", 1), sheet("s2", 2), sheet("s3", 3)],
      [{ id: "floor-old", imageUrl: image(2) }],
      [],
      [],
    ]);
    const result = await addFloorsFromDrawings(
      db,
      input(["s3", "s1", "s2", "s1"]),
    );
    expect(result).toEqual({
      floorIds: ["new-1", "new-2"],
      existingFloorIds: ["floor-old"],
    });
    const plan = writes.find((write) => write.table === jobFloorPlans)!;
    expect(plan.values).toMatchObject({
      jobId,
      storageKey: `${jobId}/${uploadId}/plan.pdf`,
      originalFilename: "Architectural.pdf",
    });
    const floors = writes.find((write) => write.table === jobFloors)!
      .values as Row[];
    expect(floors).toEqual([
      expect.objectContaining({
        name: "A-103",
        imageUrl: image(3),
        width: 3000,
        height: 2000,
        pageNumber: 1,
        status: "detected",
      }),
      expect.objectContaining({ imageUrl: image(1), pageNumber: 2 }),
    ]);
    expect(enqueueDetectJobs).toHaveBeenCalledWith(
      ["new-1", "new-2"],
      organizationId,
      tx,
    );
  });

  it("adds after the job's existing floors without a second plan", async () => {
    const { db, writes } = fakeDb([
      [sheet("s1", 1)],
      [],
      [{ id: "plan-1", jobId }],
      [{ pageNumber: 7 }],
    ]);
    await addFloorsFromDrawings(db, input(["s1"]));
    expect(writes.filter((write) => write.action === "insert")).toEqual([
      expect.objectContaining({
        table: jobFloors,
        values: [
          expect.objectContaining({ floorPlanId: "plan-1", pageNumber: 8 }),
        ],
      }),
    ]);
    const update = writes.find(
      (write) => write.table === jobFloorPlans && write.action === "update",
    );
    expect(update?.values).toMatchObject({ pageCount: 8 });
  });

  it("writes nothing when a chosen drawing is missing, from another job or not a stored page", async () => {
    for (const [reads, code] of [
      [[[sheet("s1", 1)]], "NOT_FOUND"],
      [
        [[sheet("s1", 1), sheet("s2", 2, "/api/job-documents/pages/x/1")]],
        "BAD_REQUEST",
      ],
    ] as const) {
      const { db, writes } = fakeDb(reads.map((rows) => [...rows]));
      await expect(
        addFloorsFromDrawings(db, input(["s1", "s2"])),
      ).rejects.toMatchObject({ code });
      expect(writes).toEqual([]);
    }
    const { db, writes } = fakeDb([], []);
    await expect(
      addFloorsFromDrawings(db, input(["s1"])),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(writes).toEqual([]);
    expect(enqueueDetectJobs).not.toHaveBeenCalled();
  });
});

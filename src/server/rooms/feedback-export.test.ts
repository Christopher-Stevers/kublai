import { expect, it } from "vitest";
import {
  buildFeedbackExamples,
  buildFeedbackFloor,
  feedbackSplit,
  reviewSourceMatches,
  verifyFeedbackFloorSource,
  partitionVerifiedExamples,
  type FeedbackExportEvent,
} from "./feedback-export";

const shape = { type: "bbox", x: 0.2, y: 0.2, w: 0.2, h: 0.2 };
const drawingHash = "a".repeat(64);
const detection = { drawingHash };
const floor = {
  id: "floor",
  jobId: "job",
  imageUrl: "drawing-one",
  pageNumber: 1,
  status: "confirmed",
  confirmedAt: new Date("2026-09-30T12:01:00Z"),
  completenessReviewedAt: new Date("2026-09-30T12:01:00Z"),
};
const event: FeedbackExportEvent = {
  roomId: "room",
  floorId: "floor",
  jobId: "job",
  decision: "approved",
  drawingKey: "drawing-one:1",
  proposalShape: shape,
  correctedShape: null,
  detection,
  createdAt: new Date("2026-09-30T12:00:00Z"),
};

it("exports event-time geometry and never attaches reviews to a replacement drawing", () => {
  const rooms = [
    { id: event.roomId, floorId: floor.id, reviewStatus: "approved", shape },
  ];
  const exported = buildFeedbackExamples([event], [floor], rooms);
  expect(exported).toHaveLength(1);
  expect(exported[0]!.corrected).toEqual(exported[0]!.proposal);
  expect(
    buildFeedbackExamples(
      [event],
      [{ ...floor, imageUrl: "new-drawing" }],
      rooms,
    ),
  ).toEqual([]);
  expect(
    buildFeedbackExamples(
      [{ ...event, decision: "pending" }, event],
      [floor],
      rooms,
    ),
  ).toEqual([]);
});
it("deleted or replaced approvals cannot become current positive ground truth", () => {
  expect(buildFeedbackExamples([event], [floor], [])).toEqual([]);
  expect(
    buildFeedbackExamples(
      [event],
      [floor],
      [
        {
          id: event.roomId,
          floorId: floor.id,
          reviewStatus: "approved",
          shape: { ...shape, w: 0.3 },
        },
      ],
    ),
  ).toEqual([]);
  expect(
    buildFeedbackExamples([{ ...event, decision: "rejected" }], [floor], []),
  ).toHaveLength(1);
});
it("legacy confirmation and partial reviews cannot supply complete-room ground truth", () => {
  const rooms = [
    {
      id: "room",
      floorId: "floor",
      reviewStatus: "approved",
      shape,
      detection,
    },
  ];
  expect(
    buildFeedbackFloor({ ...floor, completenessReviewedAt: null }, rooms)
      .completenessReviewed,
  ).toBe(false);
  expect(buildFeedbackFloor(floor, rooms).completenessReviewed).toBe(true);
  expect(
    buildFeedbackFloor(floor, [
      ...rooms,
      { ...rooms[0]!, id: "unreviewed", reviewStatus: "pending" },
    ]).completenessReviewed,
  ).toBe(false);
  expect(
    buildFeedbackFloor({ ...floor, status: "detected" }, rooms)
      .completenessReviewed,
  ).toBe(false);
});
it("complete floors export every approved room, including rooms without events and holes", () => {
  const hole = [
    { x: 0.3, y: 0.3 },
    { x: 0.4, y: 0.3 },
    { x: 0.4, y: 0.4 },
  ];
  const ring = {
    type: "polygon",
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.5, y: 0.2 },
      { x: 0.5, y: 0.5 },
      { x: 0.2, y: 0.5 },
    ],
    holes: [hole],
  };
  const result = buildFeedbackFloor(floor, [
    {
      id: "room",
      floorId: "floor",
      reviewStatus: "approved",
      shape,
      detection,
    },
    {
      id: "manual",
      floorId: "floor",
      reviewStatus: "approved",
      shape: ring,
      detection,
    },
    { id: "rejected", floorId: "floor", reviewStatus: "rejected", shape },
    { id: "old", floorId: "floor", reviewStatus: "superseded", shape },
  ]);
  expect(result.approvedRooms.map((room) => room.id)).toEqual([
    "room",
    "manual",
  ]);
  expect(result.approvedRooms[1]!.shape.holes).toEqual([hole]);
  expect(feedbackSplit(floor.jobId)).toBe(feedbackSplit(floor.jobId));
});
it("unhashed and inconsistent approved outlines cannot become dense supervision", () => {
  const room = {
    id: "room",
    floorId: floor.id,
    reviewStatus: "approved",
    shape,
  };
  expect(buildFeedbackFloor(floor, [room]).completenessReviewed).toBe(false);
  expect(
    buildFeedbackFloor(floor, [{ ...room, detection }]).sourceReviewHash,
  ).toBe(drawingHash);
  expect(
    buildFeedbackFloor(floor, [
      { ...room, detection },
      { ...room, id: "other", detection: { drawingHash: "b".repeat(64) } },
    ]).completenessReviewed,
  ).toBe(false);
  expect(
    buildFeedbackFloor(floor, [
      { ...room, detection: { drawingHash: "not-a-sha256" } },
    ]).sourceReviewHash,
  ).toBeNull();
});
it("changed PDFs require fresh attestation but historical hashes do not poison rechecked floors", () => {
  const room = {
    id: "room",
    floorId: floor.id,
    reviewStatus: "approved",
    shape,
    detection,
  };
  const old = buildFeedbackFloor(floor, [room]);
  const changedHash = "b".repeat(64);
  expect(verifyFeedbackFloorSource(old, changedHash).completenessReviewed).toBe(
    false,
  );
  const rechecked = buildFeedbackFloor(floor, [
    { ...room, detection: { drawingHash: changedHash } },
  ]);
  expect(
    verifyFeedbackFloorSource(rechecked, changedHash).completenessReviewed,
  ).toBe(true);
  expect(reviewSourceMatches(undefined, changedHash)).toBe(false);
  expect(reviewSourceMatches(detection, changedHash)).toBe(false);
  expect(reviewSourceMatches({ drawingHash: changedHash }, changedHash)).toBe(
    true,
  );
});
it("quarantines missing or mismatched event hashes instead of training on them", () => {
  const snapshots = [
    { floorId: "floor", detection },
    { floorId: "floor", detection: null },
    { floorId: "floor", detection: { drawingHash: "b".repeat(64) } },
    { floorId: "missing", detection },
  ];
  const exported = partitionVerifiedExamples(
    snapshots,
    new Map([["floor", drawingHash]]),
  );
  expect(exported.examples).toHaveLength(1);
  expect(exported.examples[0]!.sourceVerified).toBe(true);
  expect(exported.unverifiedExamples).toHaveLength(3);
  expect(
    exported.unverifiedExamples.every(
      (example) => example.sourceVerified === false,
    ),
  ).toBe(true);
});

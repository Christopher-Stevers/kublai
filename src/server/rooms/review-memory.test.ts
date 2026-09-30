import { it, expect } from "vitest";
import {
  latestReviewDecisions,
  rejectedByReview,
  roomIoU,
  validReviewShape,
} from "./review-memory";
import { trainReviewRanker } from "./review-model";
import { toPolygon, pointInPolygon, movePolygonPoint } from "~/lib/room-shape";
const shape = toPolygon({ type: "bbox", x: 0.2, y: 0.2, w: 0.2, h: 0.2 });
it("a rejection suppresses the same outline but not its neighbour", () => {
  expect(
    rejectedByReview(shape, [{ decision: "rejected", proposalShape: shape }]),
  ).toBe(true);
  expect(
    rejectedByReview(
      toPolygon({ type: "bbox", x: 0.5, y: 0.2, w: 0.2, h: 0.2 }),
      [{ decision: "rejected", proposalShape: shape }],
    ),
  ).toBe(false);
});
it("undo and different drawings cannot inherit a prior rejection", () => {
  const events = [
    {
      roomId: "a",
      decision: "pending",
      drawingKey: "one",
      proposalShape: shape,
    },
    {
      roomId: "a",
      decision: "rejected",
      drawingKey: "one",
      proposalShape: shape,
    },
  ];
  expect(rejectedByReview(shape, latestReviewDecisions(events, "one"))).toBe(
    false,
  );
  expect(latestReviewDecisions(events, "two")).toHaveLength(0);
});
it("ring corridors preserve holes through picking, edits and overlap", () => {
  const hole = toPolygon({
    type: "bbox",
    x: 0.25,
    y: 0.25,
    w: 0.1,
    h: 0.1,
  }).points;
  const ring = { ...shape, holes: [hole] };
  expect(pointInPolygon({ x: 0.3, y: 0.3 }, ring)).toBe(false);
  expect(pointInPolygon({ x: 0.21, y: 0.21 }, ring)).toBe(true);
  expect(roomIoU(ring, ring)).toBeCloseTo(1);
  expect(movePolygonPoint(ring, 0, { x: 0.19, y: 0.2 }).holes).toEqual([hole]);
});
it("feedback ranker requires multiple floors and never turns reviews into automatic approval", () => {
  const events = Array.from({ length: 12 }, (_, i) => ({
    roomId: String(i),
    floorId: "one",
    decision: "rejected",
    proposalShape: shape,
    detection: null,
  }));
  expect(trainReviewRanker(events)(shape, null)).toBeNull();
  events.forEach((e, i) => (e.floorId = String(i % 3)));
  const rank = trainReviewRanker(events)(shape, null)!;
  expect(rank.examples).toBe(12);
  expect(rank.priority).toBeGreaterThan(0.5);
  expect(rank).not.toHaveProperty("approved");
});
it("malformed history cannot suppress rooms or make a review queue fail", () => {
  const broken = { type: "polygon", points: [null, null, null] };
  expect(validReviewShape(broken)).toBe(false);
  expect(
    rejectedByReview(shape, [{ decision: "rejected", proposalShape: null }]),
  ).toBe(false);
  expect(
    rejectedByReview(shape, [{ decision: "rejected", proposalShape: broken }]),
  ).toBe(false);
  expect(
    trainReviewRanker(
      Array.from({ length: 12 }, (_, i) => ({
        roomId: String(i),
        floorId: String(i % 3),
        decision: "approved",
        proposalShape: broken,
        detection: null,
      })),
    )(shape, null),
  ).toBeNull();
});
it("changed source bytes cannot inherit a rejection from the same URL", () => {
  const event = {
    decision: "rejected",
    proposalShape: shape,
    detection: { drawingHash: "original" },
  };
  expect(rejectedByReview(shape, [event], "original")).toBe(true);
  expect(rejectedByReview(shape, [event], "changed")).toBe(false);
  expect(
    rejectedByReview(
      shape,
      [{ decision: "rejected", proposalShape: shape }],
      "original",
    ),
  ).toBe(false);
});
it("boundary and unspecified rejections allow a materially repaired proposal", () => {
  const repaired = toPolygon({ type: "bbox", x: 0.2, y: 0.2, w: 0.24, h: 0.2 });
  const reject = (reviewReason: string) => ({
    decision: "rejected",
    proposalShape: shape,
    detection: { reviewReason },
  });
  expect(rejectedByReview(shape, [reject("boundary")])).toBe(true);
  expect(rejectedByReview(repaired, [reject("boundary")])).toBe(false);
  expect(rejectedByReview(repaired, [reject("unspecified")])).toBe(false);
  expect(rejectedByReview(repaired, [reject("merged")])).toBe(false);
  expect(rejectedByReview(repaired, [reject("not-space")])).toBe(true);
});
it("requires positive-area simple rings and valid interior holes", () => {
  const crossing = {
    type: "polygon",
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.4, y: 0.4 },
      { x: 0.2, y: 0.4 },
      { x: 0.4, y: 0.2 },
    ],
  };
  const flat = {
    type: "polygon",
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.3, y: 0.2 },
      { x: 0.4, y: 0.2 },
    ],
  };
  const hole = toPolygon({
    type: "bbox",
    x: 0.25,
    y: 0.25,
    w: 0.1,
    h: 0.1,
  }).points;
  expect(validReviewShape(crossing)).toBe(false);
  expect(validReviewShape(flat)).toBe(false);
  expect(validReviewShape({ ...shape, holes: [hole] })).toBe(true);
  expect(validReviewShape({ ...shape, holes: [crossing.points] })).toBe(false);
  expect(
    validReviewShape({
      ...shape,
      holes: [
        toPolygon({ type: "bbox", x: 0.5, y: 0.5, w: 0.1, h: 0.1 }).points,
      ],
    }),
  ).toBe(false);
  expect(validReviewShape({ ...shape, holes: [hole, hole] })).toBe(false);
  expect(
    validReviewShape({
      ...shape,
      holes: [
        hole,
        toPolygon({ type: "bbox", x: 0.27, y: 0.27, w: 0.02, h: 0.02 }).points,
      ],
    }),
  ).toBe(false);
  expect(validReviewShape({ type: "bbox", x: 1, y: 0.2, w: 0.1, h: 0.1 })).toBe(
    false,
  );
});
it("retains valid concave and reversed rooms and invalidates mutated cached shapes", () => {
  const concave = {
    type: "polygon",
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.1 },
      { x: 0.5, y: 0.2 },
      { x: 0.2, y: 0.2 },
      { x: 0.2, y: 0.5 },
      { x: 0.1, y: 0.5 },
    ],
  };
  expect(validReviewShape(concave)).toBe(true);
  expect(
    validReviewShape({ ...concave, points: [...concave.points].reverse() }),
  ).toBe(true);
  const mutable = {
    ...shape,
    points: shape.points.map((point) => ({ ...point })),
  };
  expect(validReviewShape(mutable)).toBe(true);
  [mutable.points[1], mutable.points[2]] = [
    mutable.points[2]!,
    mutable.points[1]!,
  ];
  expect(validReviewShape(mutable)).toBe(false);
});
it("prioritizes invalid boundaries independently of learned feedback counts", () => {
  const rank = trainReviewRanker([]);
  expect(rank(shape, { invalidGeometry: true })).toEqual({
    priority: 1,
    examples: 0,
    floors: 0,
    reason: "invalid-geometry",
  });
  const crossing = {
    type: "polygon" as const,
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.4, y: 0.4 },
      { x: 0.2, y: 0.4 },
      { x: 0.4, y: 0.2 },
    ],
  };
  expect(rank(crossing, null)?.priority).toBe(1);
  expect(rank(shape, { invalidGeometry: false })).toBeNull();
});

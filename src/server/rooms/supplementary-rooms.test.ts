import { describe, expect, it } from "vitest";
import { pointInPolygon, type RoomPolygonShape } from "~/lib/room-shape";
import fixture from "../../../tests/fixtures/room-detection-a501-core.json";
import {
  supplementaryWallSegments,
  type PdfLabel,
  type WallSegment,
} from "./pdf-walls";
import { sourceRoomInterior } from "./source-room-interior";
import {
  roomOverlap,
  supplementaryRoomSeeds,
  supportedRoomBoundary,
} from "./supplementary-rooms";
const label = (name: string, x: number, y: number): PdfLabel => ({
  name,
  x,
  y,
  angle: 0,
  anchors: [
    { x: x - 0.003, y },
    { x: x + 0.003, y },
  ],
});
const shape = {
  type: "polygon" as const,
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.12, y: 0.1 },
    { x: 0.12, y: 0.12 },
    { x: 0.1, y: 0.12 },
  ],
};
const strokes: WallSegment[] = shape.points.map((a, i) => {
  const b = shape.points[(i + 1) % 4]!;
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, strokeWidth: 5 };
});
describe("conservative supplementary rooms", () => {
  it("retains short thin/glazing strokes even when heavy strokes exceed the global budget", () => {
    const heavy = Array.from({ length: 8521 }, () => ({
      x1: 0.05,
      y1: 0.1,
      x2: 0.1,
      y2: 0.1,
      strokeWidth: 8,
    }));
    const thin = { x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.51, strokeWidth: 2 };
    const jamb = { x1: 0.5, y1: 0.51, x2: 0.502, y2: 0.51, strokeWidth: 2 };
    const dash = { ...thin, dashed: true };
    const arc = { ...thin, curve: true };
    const kept = supplementaryWallSegments([...heavy, thin, jamb, dash, arc]);
    expect(kept).toContain(thin);
    expect(kept).toContain(jamb);
    expect(kept).not.toContain(dash);
    expect(kept).not.toContain(arc);
    expect(heavy).toHaveLength(8521);
  });
  it("contains independent source interiors and excludes the adjoining corridor", () => {
    const candidates = fixture.candidates as Array<{
      name: string;
      shape: RoomPolygonShape;
    }>;
    expect(pointInPolygon({ x: 0.573, y: 0.249 }, candidates[0]!.shape)).toBe(
      true,
    );
    expect(pointInPolygon({ x: 0.573, y: 0.311 }, candidates[1]!.shape)).toBe(
      true,
    );
    for (const r of candidates)
      expect(pointInPolygon({ x: 0.592, y: 0.3 }, r.shape)).toBe(false);
  });
  it("does not move a wall to an unpaired thin annotation leader", () => {
    const baseline = JSON.stringify(shape);
    const annotation = {
      x1: 0.101,
      y1: 0.08,
      x2: 0.101,
      y2: 0.15,
      strokeWidth: 1,
    };
    expect(
      sourceRoomInterior(shape, [...strokes, annotation], { x: 0.11, y: 0.11 }),
    ).toEqual(shape);
    expect(JSON.stringify(shape)).toBe(baseline);
  });
  it("pairs repeated names with separate source tags and joins split names", () => {
    const seeds = supplementaryRoomSeeds([
      label("W/C", 0.2, 0.2),
      label("301", 0.2, 0.206),
      label("W/C", 0.2, 0.23),
      label("302", 0.2, 0.236),
      label("GROUP BRAINSTORMING", 0.4, 0.4),
      label("ROOM", 0.4, 0.404),
      label("303", 0.4, 0.411),
    ]);
    expect(seeds.map((s) => s.name)).toEqual([
      "W/C 301",
      "W/C 302",
      "GROUP BRAINSTORMING ROOM 303",
    ]);
  });
  it("uses the visible text baseline for rotated numeric tags", () => {
    const seed = label("FOCUS ROOM", 0.5, 0.5);
    seed.angle = Math.PI - 0.3;
    seed.anchors = [
      { x: 0.49, y: 0.496 },
      { x: 0.51, y: 0.504 },
    ];
    expect(
      supplementaryRoomSeeds([
        seed,
        { ...label("401", 0.498, 0.507), angle: seed.angle },
      ]).map((s) => s.name),
    ).toEqual(["FOCUS ROOM 401"]);
  });
  it("does not turn annotations, bare ROOM, untagged names or ambiguous tags into rooms", () => {
    expect(
      supplementaryRoomSeeds([
        label("ROOM", 0.2, 0.2),
        label("301", 0.2, 0.206),
        label("REFER TO MEETING ROOM", 0.3, 0.3),
        label("302", 0.3, 0.306),
        label("SERVICE", 0.4, 0.4),
      ]),
    ).toEqual([]);
    expect(
      supplementaryRoomSeeds([
        label("W/C", 0.2, 0.2),
        label("301", 0.2, 0.206),
        label("302", 0.2, 0.207),
      ]),
    ).toEqual([]);
  });
  it("rejects missing walls and unsupported corner returns without manufacturing a box", () => {
    expect(supportedRoomBoundary(shape, strokes, [])).toBe(true);
    expect(supportedRoomBoundary(shape, strokes.slice(0, 3), [])).toBe(false);
    expect(roomOverlap(shape, shape)).toBeCloseTo(0.0004, 9);
  });
});

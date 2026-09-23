import { describe, it, expect } from "vitest";
import fixture from "../../../tests/fixtures/room-detection-a501-core.json";
import { sourceRoomInterior } from "./source-room-interior";
import { pointInPolygon, type RoomPolygonShape } from "~/lib/room-shape";
import {
  supplementaryRoomSeeds,
  supportedRoomBoundary,
  roomOverlap,
  detectSupplementaryRooms,
} from "./supplementary-rooms";
import { planDetectedRoomReconciliation } from "./reconcile-detected-rooms";
import {
  supplementaryWallSegments,
  type PdfLabel,
  type WallSegment,
} from "./pdf-walls";
import type { FloorGraph } from "./floor-graph";
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
  it("freezes all 63 real saved shapes and idempotently appends the verified additions", () => {
    const baseline = fixture.baseline;
    const before = JSON.stringify(baseline);
    const candidates = fixture.candidates as Array<{
      name: string;
      shape: RoomPolygonShape;
    }>;
    const plan = planDetectedRoomReconciliation(baseline, candidates, {
      preserveExisting: true,
    });
    expect(baseline).toHaveLength(63);
    expect(plan.updates).toEqual([]);
    expect(plan.obsoleteAutoIds).toEqual([]);
    expect(plan.inserts.map((r) => r.name)).toEqual([
      "W/C 244",
      "UNIVERSAL W/C 242",
    ]);
    const repeated = planDetectedRoomReconciliation(
      [
        ...baseline,
        ...plan.inserts.map((r, i) => ({
          ...r,
          id: `added-${i}`,
          source: "auto",
        })),
      ],
      candidates,
      { preserveExisting: true },
    );
    expect(repeated.inserts).toEqual([]);
    expect(JSON.stringify(baseline)).toBe(before);
    for (const room of candidates)
      expect(
        baseline.every(
          (base) =>
            roomOverlap(room.shape, base.shape as RoomPolygonShape) <= 1e-10,
        ),
      ).toBe(true);
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
  it("keeps matched and absent automatic rooms byte-identical, protects manual geometry and reconciles additions repeatedly", () => {
    const shifted = {
      ...shape,
      points: shape.points.map((p) => ({ x: p.x + 0.1, y: p.y })),
    };
    const existing = [
      { id: "a", name: "Baseline", source: "auto", shape },
      { id: "m", name: "Manual", source: "manual", shape: shifted },
      { id: "s", name: "W/C 301", source: "auto", shape: shifted },
    ];
    const frozen = JSON.stringify(existing);
    const next = {
      ...shape,
      points: shape.points.map((p) => ({ x: p.x + 0.2, y: p.y })),
    };
    const detected = [
      { name: "Baseline", shape: next },
      { name: "Intrusion", shape: shifted },
      { name: "W/C 301", shape: next },
      { name: "W/C 302", shape: next },
    ];
    const plan = planDetectedRoomReconciliation(existing, detected, {
      preserveExisting: true,
    });
    expect(plan.updates).toEqual([]);
    expect(plan.obsoleteAutoIds).toEqual([]);
    expect(plan.inserts.map((r) => r.name)).toEqual(["W/C 302"]);
    const repeat = planDetectedRoomReconciliation(
      [
        ...existing,
        ...plan.inserts.map((r, i) => ({
          ...r,
          id: `new-${i}`,
          source: "auto",
        })),
      ],
      detected,
      { preserveExisting: true },
    );
    expect(repeat.inserts).toEqual([]);
    expect(JSON.stringify(existing)).toBe(frozen);
  });
  it("skips covered labels without touching the baseline or running a local graph", async () => {
    const frozen = JSON.stringify(shape);
    const result = await detectSupplementaryRooms(
      { segments: [], arcs: [], layers: [], source: "pdf-vector" },
      [label("W/C", 0.11, 0.11), label("301", 0.11, 0.116)],
      [{ name: "original", shape }],
      {} as FloorGraph,
    );
    expect(result.rooms).toEqual([]);
    expect(JSON.stringify(shape)).toBe(frozen);
  });
});

import { describe, expect, it } from "vitest";

import { inferPlanLayers, type StyledSegment } from "./infer-layers";

const WALL = { stroke: "#000000", width: 0.0014 };
const THIN = { stroke: "#000000", width: 0.0003 };
const R = 0.012;
const THICK = 0.003;
const line = (x1: number, y1: number, x2: number, y2: number, pen = WALL): StyledSegment =>
  ({ x1, y1, x2, y2, ...pen });

/** Hinge at (x, y), leaf straight up, quarter swing to the wall at x + R. */
function door(x: number, y: number) {
  const out = [line(x, y, x, y - R, THIN)];
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * (Math.PI / 2), a1 = ((i + 1) / 8) * (Math.PI / 2);
    out.push(line(x + R * Math.cos(a0), y - R * Math.sin(a0), x + R * Math.cos(a1), y - R * Math.sin(a1), THIN));
  }
  return out;
}

/** A two-faced wall at y from 0.05 to 0.95 with a door opening at each x. */
function wallRow(y: number, doors: number[]) {
  const out: StyledSegment[] = [];
  for (const face of [y, y + THICK]) {
    let from = 0.05;
    for (const x of doors) { out.push(line(from, face, x, face)); from = x + R; }
    out.push(line(from, face, 0.95, face));
  }
  return [...out, ...doors.flatMap((x) => door(x, y))];
}

/** Four corridor walls with six doors each, a dashed line and a grid line in the wall pen. */
function flattenedPlan() {
  const xs = [0.1, 0.22, 0.34, 0.6, 0.72, 0.84];
  const rows = [0.2, 0.4, 0.6, 0.8].flatMap((y) => wallRow(y, xs));
  const dashed: StyledSegment[] = [];
  for (let x = 0.05; x < 0.93; x += 0.03) dashed.push(line(x, 0.9, x + 0.02, 0.9));
  const grid = line(0.47, 0.1, 0.47, 0.85);
  // A tee: a partition whose faces stop inside the corridor wall.
  const tee = [line(0.28, 0.4 + THICK, 0.28, 0.55), line(0.28 + THICK, 0.4 + THICK, 0.28 + THICK, 0.55)];
  return { segments: [...rows, ...dashed, grid, ...tee], dashed, grid, tee };
}

describe("inferPlanLayers", () => {
  it("finds door swings and the wall pen on a flattened plan", () => {
    const plan = flattenedPlan();
    const inferred = inferPlanLayers(plan.segments, 1)!;
    expect(inferred).not.toBeNull();
    expect(inferred.doors).toHaveLength(24);
    expect(inferred.wallStyles).toEqual([`${WALL.stroke}|${WALL.width.toFixed(6)}`]);

    const layerOf = (s: StyledSegment) => inferred.segments[plan.segments.indexOf(s)]!.layer;
    // Leaves are doors, and each swing is redrawn as a door arc after them.
    const leaves = plan.segments.filter((s) => s.width === THIN.width && s.x1 === s.x2);
    expect(leaves.every((s) => layerOf(s) === "A-DOOR")).toBe(true);
    const added = inferred.segments.slice(plan.segments.length);
    expect(added).toHaveLength(24 * 8);
    expect(added.every((s) => s.layer === "A-DOOR")).toBe(true);
    // Corridor wall faces and the tee's faces are walls.
    expect(layerOf(plan.segments[0]!)).toBe("A-WALL");
    for (const s of plan.tee) expect(layerOf(s)).toBe("A-WALL");
    // A dashed line and a grid line through walls are drawn in the wall pen but are not walls.
    for (const s of plan.dashed) expect(layerOf(s)).toBeUndefined();
    expect(layerOf(plan.grid)).toBeUndefined();
  });

  it("leaves layered exports and sheets without door swings alone", () => {
    const plan = flattenedPlan();
    expect(inferPlanLayers(plan.segments.map((s) => ({ ...s, layer: "A-WALL" })), 1)).toBeNull();
    expect(inferPlanLayers(plan.segments.filter((s) => s.width !== THIN.width), 1)).toBeNull();
  });
});

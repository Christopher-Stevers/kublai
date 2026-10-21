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

  it("opens lines inside walls across openings and drops chorded curves", () => {
    const plan = flattenedPlan();
    // A centre line inside the y = 0.4 wall that runs on through a doorway.
    const core = line(0.3, 0.4 + THICK / 2, 0.5, 0.4 + THICK / 2);
    // A turning circle drawn as 24 chords.
    const circle: StyledSegment[] = [];
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * 2 * Math.PI, a1 = ((i + 1) / 24) * 2 * Math.PI;
      circle.push(line(0.5 + 0.01 * Math.cos(a0), 0.5 + 0.01 * Math.sin(a0), 0.5 + 0.01 * Math.cos(a1), 0.5 + 0.01 * Math.sin(a1)));
    }
    // A party wall: both faces crossed by the y = 0.6 corridor wall's faces.
    const party = [line(0.55, 0.45, 0.55, 0.75), line(0.55 + THICK, 0.45, 0.55 + THICK, 0.75)];
    const segments = [...plan.segments, core, ...circle, ...party];
    const inferred = inferPlanLayers(segments, 1)!;
    const layerOf = (s: StyledSegment) => inferred.segments[segments.indexOf(s)]!.layer;

    expect(layerOf(core)).toBeUndefined();
    // Only the stretches between the wall's faces are kept: none of it crosses the door at x 0.34–0.352.
    const kept = inferred.segments.filter((s) => s.layer === "A-WALL" && s.y1 === core.y1 && s.y2 === core.y2 && s !== core);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.some((s) => Math.min(s.x1, s.x2) < 0.34 + 1e-3 && Math.max(s.x1, s.x2) > 0.352 - 1e-3)).toBe(false);
    for (const s of circle) expect(layerOf(s)).not.toBe("A-WALL");
    for (const s of party) expect(layerOf(s)).toBe("A-WALL");
  });

  it("ignores a crosshatch drawn in the wall pen across a room", () => {
    const plan = flattenedPlan();
    // Two families of diagonals clipped to a box between the y = 0.2 and 0.4 walls.
    const [x0, x1, y0, y1] = [0.36, 0.46, 0.22, 0.38];
    const step = 0.004 * Math.SQRT2;
    const hatch: StyledSegment[] = [];
    for (const dir of [1, -1]) {
      // Lines y = dir * x + c, clipped to the box.
      const cs = dir === 1 ? [y0 - x1, y1 - x0] : [y0 + x0, y1 + x1];
      for (let c = cs[0]! + step; c < cs[1]!; c += step) {
        const pts: [number, number][] = [];
        for (const x of [x0, x1]) { const y = dir * x + c; if (y >= y0 && y <= y1) pts.push([x, y]); }
        for (const y of [y0, y1]) { const x = (y - c) * dir; if (x > x0 && x < x1) pts.push([x, y]); }
        if (pts.length >= 2) hatch.push(line(pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1]));
      }
    }
    expect(hatch.length).toBeGreaterThan(40);
    const segments = [...plan.segments, ...hatch];
    const inferred = inferPlanLayers(segments, 1)!;
    const layerOf = (s: StyledSegment) => inferred.segments[segments.indexOf(s)]!.layer;
    for (const s of hatch) expect(layerOf(s)).not.toBe("A-WALL");
    expect(layerOf(plan.segments[0]!)).toBe("A-WALL");
  });

  it("drops a turning circle on a sheet crowded with fixture arcs", () => {
    const plan = flattenedPlan();
    // Basins and toilet seats: small leafless arcs that outnumber the doors.
    const fixtures: StyledSegment[] = [];
    for (let k = 0; k < 40; k++) {
      const x = 0.06 + (k % 20) * 0.04, y = k < 20 ? 0.3 : 0.7, r = R * 0.55;
      for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * (Math.PI / 2), a1 = ((i + 1) / 8) * (Math.PI / 2);
        fixtures.push(line(x + r * Math.cos(a0), y - r * Math.sin(a0), x + r * Math.cos(a1), y - r * Math.sin(a1), THIN));
      }
    }
    // A 1.5 m turning circle in the wall pen, chorded more coarsely than a fixture.
    const circle: StyledSegment[] = [];
    for (let i = 0; i < 32; i++) {
      const a0 = (i / 32) * 2 * Math.PI, a1 = ((i + 1) / 32) * 2 * Math.PI;
      circle.push(line(0.65 + 0.015 * Math.cos(a0), 0.5 + 0.015 * Math.sin(a0), 0.65 + 0.015 * Math.cos(a1), 0.5 + 0.015 * Math.sin(a1)));
    }
    const segments = [...plan.segments, ...fixtures, ...circle];
    const inferred = inferPlanLayers(segments, 1)!;
    const layerOf = (s: StyledSegment) => inferred.segments[segments.indexOf(s)]!.layer;
    expect(inferred.doors).toHaveLength(24);
    for (const s of circle) expect(layerOf(s)).not.toBe("A-WALL");
    expect(layerOf(plan.segments[0]!)).toBe("A-WALL");
  });

  it("leaves layered exports and sheets without door swings alone", () => {
    const plan = flattenedPlan();
    expect(inferPlanLayers(plan.segments.map((s) => ({ ...s, layer: "A-WALL" })), 1)).toBeNull();
    expect(inferPlanLayers(plan.segments.filter((s) => s.width !== THIN.width), 1)).toBeNull();
  });
});

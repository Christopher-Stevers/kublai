import { describe, expect, it } from "vitest";

import type { PdfLabel } from "../pdf-walls";
import { fitCircle, planRole, swingSeals, type LayeredSegment } from "./door-graph";
import { classifyDoorSpaces, cleanRoomName, detectDoorRooms, unitTagSeeds } from "./door-rooms";

const SIZE = 1000;
const n = (v: number) => v / (SIZE - 1);
const wall = (x1: number, y1: number, x2: number, y2: number): LayeredSegment =>
  ({ x1: n(x1), y1: n(y1), x2: n(x2), y2: n(y2), layer: "A-WALL" });

/**
 * A door in a horizontal wall at `y`: opening from x to x+30, hinge at x,
 * leaf and a flattened quarter-circle swing on side `dir` (-1 up, 1 down).
 */
function door(x: number, y: number, dir: 1 | -1): LayeredSegment[] {
  const r = 30;
  const seg = (x1: number, y1: number, x2: number, y2: number): LayeredSegment =>
    ({ x1: n(x1), y1: n(y1), x2: n(x2), y2: n(y2), layer: "A-DOOR" });
  const out = [seg(x, y, x, y + dir * r)];
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * (Math.PI / 2), a1 = ((i + 1) / 8) * (Math.PI / 2);
    out.push(seg(x + r * Math.cos(a0), y + dir * r * Math.sin(a0), x + r * Math.cos(a1), y + dir * r * Math.sin(a1)));
  }
  return out;
}

/** A horizontal wall from x1 to x2 with door gaps [g, g+30]. */
function wallWithGaps(y: number, x1: number, x2: number, gaps: number[]) {
  const out: LayeredSegment[] = [];
  let from = x1;
  for (const g of [...gaps].sort((a, b) => a - b)) { out.push(wall(from, y, g, y)); from = g + 30; }
  out.push(wall(from, y, x2, y));
  return out;
}

/**
 * Double-loaded corridor (y 430–470) with four units and a stair above and
 * below it. Unit N101 (top left) has a bedroom behind an interior door.
 */
function corridorPlan() {
  const columns = [50, 250, 450, 650, 850];
  const gaps = columns.map((x) => x + 30);
  const segments: LayeredSegment[] = [
    wall(50, 200, 950, 200), wall(50, 700, 950, 700), wall(50, 200, 50, 700), wall(950, 200, 950, 700),
    ...wallWithGaps(430, 50, 950, gaps),
    ...wallWithGaps(470, 50, 950, gaps),
    ...[250, 450, 650, 850].flatMap((x) => [wall(x, 200, x, 430), wall(x, 470, x, 700)]),
    ...gaps.flatMap((g) => [...door(g, 430, -1), ...door(g, 470, 1)]),
    // N101's bedroom.
    ...wallWithGaps(300, 50, 250, [120]),
    ...door(120, 300, -1),
  ];
  const seeds = [
    { x: n(900), y: n(320), name: "STAIR A" },
    { x: n(900), y: n(580), name: "STAIR B" },
    { x: n(150), y: n(380), name: "N101" },
    { x: n(550), y: n(600), name: "DW-38" },
  ];
  return { segments, seeds };
}

describe("planRole", () => {
  it("reads walls and doors from AIA layer names, ignoring annotation", () => {
    expect(planRole("A-WALL")).toBe("wall");
    expect(planRole("xref-arch|A-WALL-FULL")).toBe("wall");
    expect(planRole("A-DOOR")).toBe("door");
    expect(planRole("A-DOOR-FRAM")).toBe("wall");
    expect(planRole("A-DOOR-IDEN")).toBeNull();
    expect(planRole("A-GLAZ-HDLN")).toBeNull();
    expect(planRole("M-PIPE")).toBeNull();
    expect(planRole(undefined)).toBeNull();
  });
});

describe("swingSeals", () => {
  it("finds the hinge of a flattened swing arc", () => {
    const strokes = door(100, 100, 1).map((s) => [
      { x: s.x1 * (SIZE - 1), y: s.y1 * (SIZE - 1) },
      { x: s.x2 * (SIZE - 1), y: s.y2 * (SIZE - 1) },
    ] as [{ x: number; y: number }, { x: number; y: number }]);
    const seals = swingSeals(strokes, 30);
    expect(seals).toHaveLength(1);
    expect(seals[0]!.hinge.x).toBeCloseTo(100, 0);
    expect(seals[0]!.hinge.y).toBeCloseTo(100, 0);
    expect(seals[0]!.r).toBeCloseTo(30, 0);
  });

  it("fits a circle through points on it", () => {
    const pts = [0, 0.5, 1, 1.5].map((a) => ({ x: 5 + 10 * Math.cos(a), y: -3 + 10 * Math.sin(a) }));
    const c = fitCircle(pts)!;
    expect(c.x).toBeCloseTo(5, 5);
    expect(c.y).toBeCloseTo(-3, 5);
    expect(c.r).toBeCloseTo(10, 5);
  });
});

describe("cleanRoomName", () => {
  it("drops trade codes and keeps room and suite names", () => {
    expect(cleanRoomName("DW-38")).toBeNull();
    expect(cleanRoomName("ELEC. CLOSET PD-47")).toBe("ELEC. CLOSET");
    expect(cleanRoomName("CBV LOBBY")).toBe("LOBBY");
    expect(cleanRoomName("N224 4 BD (BF)")).toBe("N224 4 BD (BF)");
    expect(cleanRoomName("N101")).toBe("N101");
  });
});

describe("unitTagSeeds", () => {
  const label = (name: string, x: number, y: number): PdfLabel => ({ name, x, y });
  it("pairs a suite number with the unit type printed under it", () => {
    const seeds = unitTagSeeds([
      label("N119", 0.3, 0.3), label("NANO", 0.3, 0.306),
      label("S101", 0.6, 0.6), label("STUDIO", 0.7, 0.6),
    ], 1.4);
    expect(seeds).toEqual([{ x: 0.3, y: 0.303, name: "N119 NANO" }]);
  });
});

describe("classifyDoorSpaces", () => {
  it("keeps a many-door corridor and groups a unit's own rooms", () => {
    // 1 corridor; 2–5 unit entries; 6 a bedroom behind 2; 7, 8 stairs.
    const doors = [[1, 2], [1, 3], [1, 4], [1, 5], [2, 6], [1, 7], [1, 8], [7, 0], [8, 0]];
    const { common, units } = classifyDoorSpaces({
      spaces: [1, 2, 3, 4, 5, 6, 7, 8],
      area: () => 100,
      doorSize: 1,
      doors,
      names: new Map([[7, ["STAIR A"]], [8, ["STAIR B"]]]),
    });
    expect(common.sort()).toEqual([1, 7, 8]);
    expect(units.map((u) => u.sort()).sort()).toEqual([[2, 6], [3], [4], [5]]);
  });

  it("does not make a unit's hallway common however many doors it has", () => {
    // 1 corridor (ten doors); 2 a unit hallway with bedrooms, bath and closets (3–8).
    const doors = [[1, 2], [1, 9], [1, 10], [1, 11], [1, 12], [1, 13], [1, 14], [1, 15], [1, 0], [1, 0], ...[3, 4, 5, 6, 7, 8].map((s) => [2, s])];
    const { common, units } = classifyDoorSpaces({
      spaces: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      area: (id) => (id >= 6 && id <= 8 ? 1 : 30),
      doorSize: 1,
      doors,
      names: new Map(),
    });
    expect(common).toEqual([1]);
    expect(units.find((u) => u.includes(2))!.sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("detectDoorRooms", () => {
  it("reads a double-loaded corridor as common space with one room per unit", () => {
    const { segments, seeds } = corridorPlan();
    const result = detectDoorRooms(segments, { width: SIZE, height: SIZE, seeds });
    const common = result.rooms.filter((r) => r.kind === "common");
    const units = result.rooms.filter((r) => r.kind === "unit");
    expect(common.map((r) => r.name ?? "").sort()).toEqual(["", "STAIR A", "STAIR B"]);
    expect(units).toHaveLength(8);
    const n101 = units.find((u) => u.name === "N101");
    expect(n101?.spaces).toHaveLength(2);
    // Trade codes never name a room.
    expect(result.rooms.some((r) => r.name === "DW-38")).toBe(false);
  });
});

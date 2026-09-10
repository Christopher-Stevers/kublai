import { describe, expect, it } from "vitest";

import { pointInPolygon, type RoomPolygonShape } from "~/lib/room-shape";
import {
  extractPdfRoomSeeds,
  type PdfLabel,
  type WallSegment,
} from "~/server/rooms/pdf-walls";
import {
  polygonizeWalls,
  subtractRoomShapes,
  unionRoomFaces,
} from "~/server/rooms/polygonize-walls";

function wall(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  strokeWidth = 2,
  dashed = false,
): WallSegment {
  return { x1, y1, x2, y2, strokeWidth, dashed };
}

function repeatWalls(walls: WallSegment[], count = 4) {
  return Array.from({ length: count }, () => walls).flat();
}

describe("polygonizeWalls", () => {
  it("nodes linework and deliberately bridges a doorway-sized gap", () => {
    const walls: WallSegment[] = [
      wall(0.1, 0.1, 0.4, 0.1),
      wall(0.4, 0.1, 0.4, 0.4),
      wall(0.4, 0.4, 0.1, 0.4),
      wall(0.1, 0.4, 0.1, 0.26),
      wall(0.1, 0.24, 0.1, 0.1),
      // Duplicate/reversed CAD strokes and an intersecting dimension line.
      wall(0.4, 0.1, 0.1, 0.1),
      wall(0.25, 0.08, 0.25, 0.42, 1),
      ...Array.from({ length: 10 }, (_, index) =>
        wall(0.5 + index * 0.01, 0.5, 0.505 + index * 0.01, 0.5),
      ),
    ];

    const faces = polygonizeWalls(walls);
    expect(faces.some((face) => pointInPolygon({ x: 0.2, y: 0.2 }, face))).toBe(
      true,
    );
  });

  it("closes wall-width gaps when selected room faces are merged", () => {
    const left: RoomPolygonShape = {
      type: "polygon",
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.1 },
        { x: 0.2, y: 0.3 },
        { x: 0.1, y: 0.3 },
      ],
    };
    const right: RoomPolygonShape = {
      type: "polygon",
      points: [
        { x: 0.203, y: 0.1 },
        { x: 0.3, y: 0.1 },
        { x: 0.3, y: 0.3 },
        { x: 0.203, y: 0.3 },
      ],
    };

    const merged = unionRoomFaces([left, right], { x: 0.15, y: 0.2 }, 0.0025);
    expect(merged).not.toBeNull();
    expect(pointInPolygon({ x: 0.25, y: 0.2 }, merged!)).toBe(true);
  });

  it("ignores dashed grid lines that cross an otherwise enclosed room", () => {
    const outline = repeatWalls([
      wall(0.1, 0.1, 0.4, 0.1),
      wall(0.4, 0.1, 0.4, 0.4),
      wall(0.4, 0.4, 0.1, 0.4),
      wall(0.1, 0.4, 0.1, 0.1),
    ]);
    const faces = polygonizeWalls([
      ...outline,
      wall(0.25, 0.08, 0.25, 0.42, 1, true),
    ]);

    expect(faces).toHaveLength(1);
    expect(pointInPolygon({ x: 0.35, y: 0.2 }, faces[0]!)).toBe(true);
  });

  it("ignores grid dashes exported as separate heavy solid strokes", () => {
    const outline = repeatWalls([
      wall(0.1, 0.1, 0.4, 0.1),
      wall(0.4, 0.1, 0.4, 0.4),
      wall(0.4, 0.4, 0.1, 0.4),
      wall(0.1, 0.4, 0.1, 0.1),
    ]);
    const grid = Array.from({ length: 17 }, (_, index) => {
      const y = 0.04 + index * 0.024;
      return [
        wall(0.25, y, 0.25, y + 0.012, 8),
        // Intersections are common where a column grid crosses dimensions,
        // leaders, or actual walls. They must not rescue pieces of the grid.
        wall(0.245, y - 0.001, 0.255, y - 0.001),
        wall(0.245, y + 0.013, 0.255, y + 0.013),
      ];
    }).flat();

    const faces = polygonizeWalls([...outline, ...grid]);

    expect(faces).toHaveLength(1);
    expect(pointInPolygon({ x: 0.35, y: 0.2 }, faces[0]!)).toBe(true);
  });

  it("polygonizes a rotated room and bridges its doorway gap", () => {
    const angle = Math.PI / 7;
    const rotate = (x: number, y: number) => ({
      x: 0.5 + x * Math.cos(angle) - y * Math.sin(angle),
      y: 0.5 + x * Math.sin(angle) + y * Math.cos(angle),
    });
    const a = rotate(-0.16, -0.1);
    const b = rotate(0.16, -0.1);
    const c = rotate(0.16, 0.1);
    const d = rotate(-0.16, 0.1);
    const gapA = rotate(-0.02, 0.1);
    const gapB = rotate(0.002, 0.1);
    const outline = repeatWalls([
      wall(a.x, a.y, b.x, b.y),
      wall(b.x, b.y, c.x, c.y),
      wall(c.x, c.y, gapB.x, gapB.y),
      wall(gapA.x, gapA.y, d.x, d.y),
      wall(d.x, d.y, a.x, a.y),
    ]);

    const faces = polygonizeWalls(outline);
    expect(faces.some((face) => pointInPolygon({ x: 0.5, y: 0.5 }, face))).toBe(
      true,
    );
  });

  it("subtracts an earlier wall cell as a complementary side notch", () => {
    const candidate: RoomPolygonShape = {
      type: "polygon",
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.5, y: 0.1 },
        { x: 0.5, y: 0.5 },
        { x: 0.1, y: 0.5 },
      ],
    };
    const protrudingNeighbor: RoomPolygonShape = {
      type: "polygon",
      points: [
        { x: 0.05, y: 0.2 },
        { x: 0.2, y: 0.2 },
        { x: 0.2, y: 0.4 },
        { x: 0.05, y: 0.4 },
      ],
    };

    const result = subtractRoomShapes(candidate, [protrudingNeighbor], {
      x: 0.4,
      y: 0.3,
    });

    expect(result?.points).toHaveLength(8);
    expect(pointInPolygon({ x: 0.4, y: 0.3 }, result!)).toBe(true);
    expect(pointInPolygon({ x: 0.15, y: 0.3 }, result!)).toBe(false);
  });
});

describe("extractPdfRoomSeeds", () => {
  it("keeps semantic room labels and unit codes with nearby area context", () => {
    const labels: PdfLabel[] = [
      { name: "N901", x: 0.4, y: 0.3 },
      { name: "347 SF", x: 0.401, y: 0.31 },
      { name: "CORRIDOR", x: 0.5, y: 0.4 },
      { name: "MECH PH", x: 0.3, y: 0.7 },
      { name: "A405", x: 0.6, y: 0.5 },
      { name: "KITCHEN CABINETS - COORDINATE WITH ID", x: 0.95, y: 0.5 },
    ];

    expect(extractPdfRoomSeeds(labels)).toEqual([
      expect.objectContaining({ name: "N901", kind: "unit", areaSqFt: 347 }),
      expect.objectContaining({ name: "CORRIDOR", kind: "room" }),
      expect.objectContaining({ name: "MECH PH", kind: "room" }),
    ]);
  });

  it("does not truncate valid labels based on PDF text-stream order", () => {
    const labels: PdfLabel[] = Array.from({ length: 60 }, (_, index) => [
      {
        name: `N${String(index + 100).padStart(3, "0")}`,
        x: 0.1 + (index % 10) * 0.06,
        y: 0.1 + Math.floor(index / 10) * 0.08,
      },
      {
        name: "350 SF",
        x: 0.101 + (index % 10) * 0.06,
        y: 0.11 + Math.floor(index / 10) * 0.08,
      },
    ]).flat();

    expect(extractPdfRoomSeeds(labels)).toHaveLength(60);
  });
});

import { describe, expect, it } from "vitest";

import { pointInPolygon, type RoomPolygonShape } from "~/lib/room-shape";
import {
  extractPdfRoomSeeds,
  type PdfLabel,
  type WallSegment,
} from "~/server/rooms/pdf-walls";
import {
  polygonizeWalls,
  unionRoomFaces,
} from "~/server/rooms/polygonize-walls";

function wall(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  strokeWidth = 2,
): WallSegment {
  return { x1, y1, x2, y2, strokeWidth };
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

    const merged = unionRoomFaces([left, right], { x: 0.15, y: 0.2 });
    expect(merged).not.toBeNull();
    expect(pointInPolygon({ x: 0.25, y: 0.2 }, merged!)).toBe(true);
  });
});

describe("extractPdfRoomSeeds", () => {
  it("keeps semantic room labels and unit codes with nearby area context", () => {
    const labels: PdfLabel[] = [
      { name: "N901", x: 0.4, y: 0.3 },
      { name: "347 SF", x: 0.401, y: 0.31 },
      { name: "CORRIDOR", x: 0.5, y: 0.4 },
      { name: "A405", x: 0.6, y: 0.5 },
      { name: "KITCHEN CABINETS - COORDINATE WITH ID", x: 0.95, y: 0.5 },
    ];

    expect(extractPdfRoomSeeds(labels)).toEqual([
      expect.objectContaining({ name: "N901", kind: "unit", areaSqFt: 347 }),
      expect.objectContaining({ name: "CORRIDOR", kind: "room" }),
    ]);
  });
});

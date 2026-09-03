import { describe, expect, it } from "vitest";

import { pointInPolygon } from "~/lib/room-shape";
import { removeHatchSegments } from "~/server/rooms/hatch-filter";
import type { WallSegment } from "~/server/rooms/pdf-walls";
import { polygonizeWalls } from "~/server/rooms/polygonize-walls";

function wall(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  strokeWidth = 1,
): WallSegment {
  return { x1, y1, x2, y2, strokeWidth, dashed: false };
}

/** Diagonal cross-hatch clipped to a rectangle, the way CAD exports it. */
function crossHatch(
  x: number,
  y: number,
  w: number,
  h: number,
  pitch: number,
): WallSegment[] {
  const out: WallSegment[] = [];
  for (let c = x - h; c < x + w; c += pitch) {
    // Rising diagonal X = c + (Y - y), clipped to the rectangle.
    const risingStart = Math.max(y, y + (x - c));
    const risingEnd = Math.min(y + h, y + (x + w - c));
    if (risingEnd - risingStart > pitch / 2) {
      out.push(
        wall(
          c + (risingStart - y),
          risingStart,
          c + (risingEnd - y),
          risingEnd,
        ),
      );
    }
    // Falling diagonal X = c + (y + h - Y), clipped to the rectangle.
    const fallingStart = Math.max(y, y + h - (x + w - c));
    const fallingEnd = Math.min(y + h, y + h - (x - c));
    if (fallingEnd - fallingStart > pitch / 2) {
      out.push(
        wall(
          c + (y + h - fallingStart),
          fallingStart,
          c + (y + h - fallingEnd),
          fallingEnd,
        ),
      );
    }
  }
  return out;
}

const ROOM: WallSegment[] = [
  wall(0.1, 0.1, 0.4, 0.1, 2),
  wall(0.4, 0.1, 0.4, 0.4, 2),
  wall(0.4, 0.4, 0.1, 0.4, 2),
  wall(0.1, 0.4, 0.1, 0.1, 2),
];

describe("removeHatchSegments", () => {
  it("drops evenly pitched parallel families but keeps walls", () => {
    const hatch = crossHatch(0.1, 0.1, 0.3, 0.3, 0.0055);
    const kept = removeHatchSegments([...ROOM, ...hatch]);
    expect(kept).toHaveLength(ROOM.length);
    expect(kept).toEqual(ROOM);
  });

  it("does not treat repeated unit partitions as hatch", () => {
    // Eight identical suites side by side: regular, but far wider than a hatch pitch.
    const partitions = Array.from({ length: 9 }, (_, index) =>
      wall(0.1 + index * 0.06, 0.1, 0.1 + index * 0.06, 0.3, 2),
    );
    expect(removeHatchSegments(partitions)).toHaveLength(partitions.length);
  });

  it("leaves wall-thickness line pairs alone", () => {
    const doubleLines = [
      wall(0.1, 0.1, 0.5, 0.1),
      wall(0.1, 0.104, 0.5, 0.104),
      wall(0.1, 0.3, 0.5, 0.3),
      wall(0.1, 0.304, 0.5, 0.304),
      wall(0.1, 0.5, 0.5, 0.5),
      wall(0.1, 0.504, 0.5, 0.504),
      wall(0.1, 0.7, 0.5, 0.7),
      wall(0.1, 0.704, 0.5, 0.704),
    ];
    expect(removeHatchSegments(doubleLines)).toHaveLength(doubleLines.length);
  });

  it("keeps the room face square once the hatch is gone", () => {
    const hatch = crossHatch(0.1, 0.1, 0.3, 0.3, 0.0055);
    const faces = polygonizeWalls(
      removeHatchSegments([...ROOM, ...ROOM, ...ROOM, ...ROOM, ...hatch]),
    );
    const face = faces.find((candidate) =>
      pointInPolygon({ x: 0.25, y: 0.25 }, candidate),
    );
    expect(face).toBeDefined();
    expect(face!.points).toHaveLength(4);
  });
});

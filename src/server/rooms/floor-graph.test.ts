import { describe, expect, it } from "vitest";

import { pointInPolygon } from "~/lib/room-shape";
import {
  assignRooms,
  buildFloorGraph,
  growRoom,
} from "~/server/rooms/floor-graph";
import type { WallSegment } from "~/server/rooms/pdf-walls";

function wall(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  strokeWidth = 2,
): WallSegment {
  return { x1, y1, x2, y2, strokeWidth };
}

function gridThroughRoom() {
  const outline = Array.from({ length: 4 }, () => [
    wall(0.1, 0.1, 0.4, 0.1),
    wall(0.4, 0.1, 0.4, 0.4),
    wall(0.4, 0.4, 0.1, 0.4),
    wall(0.1, 0.4, 0.1, 0.1),
  ]).flat();
  const grid = Array.from({ length: 17 }, (_, index) => {
    const y = 0.04 + index * 0.024;
    return [
      wall(0.25, y, 0.25, y + 0.012, 8),
      wall(0.245, y - 0.001, 0.255, y - 0.001),
      wall(0.245, y + 0.013, 0.255, y + 0.013),
    ];
  }).flat();
  return [...outline, ...grid];
}

describe("floor graph room growth", () => {
  it("assigns the full room across an intersected column grid", () => {
    const graph = buildFloorGraph(gridThroughRoom());
    const [room] = assignRooms(graph, [
      { name: "UNIT A", kind: "unit", x: 0.18, y: 0.2 },
    ]);

    expect(room).toBeDefined();
    expect(pointInPolygon({ x: 0.34, y: 0.2 }, room!.shape)).toBe(true);
  });

  it("click-to-grow previews the same full wall-bounded room", () => {
    const graph = buildFloorGraph(gridThroughRoom());
    const result = growRoom(graph, {
      include: [{ x: 0.18, y: 0.2 }],
      exclude: [],
    });

    expect(result).not.toBeNull();
    expect(pointInPolygon({ x: 0.34, y: 0.2 }, result!.shape)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { pointInPolygon } from "~/lib/room-shape";
import {
  assignRooms,
  buildFloorGraph,
  growRoom,
  type FloorGraph,
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

function rotatedMultiSpaceSuite(angle = Math.PI / 7) {
  const rotate = (x: number, y: number) => ({
    x: 0.5 + x * Math.cos(angle) - y * Math.sin(angle),
    y: 0.5 + x * Math.sin(angle) + y * Math.cos(angle),
  });
  const segment = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options: Pick<WallSegment, "filled" | "layer"> = {},
  ) => {
    const a = rotate(x1, y1);
    const b = rotate(x2, y2);
    return { ...wall(a.x, a.y, b.x, b.y), ...options };
  };
  const wallLayer = { layer: "A-WALL" };
  const linework = [
    // A representative double-line wall establishes real wall thickness so
    // the much wider tag box is not mistaken for a wall band.
    segment(-0.12, -0.03, 0.12, -0.03, wallLayer),
    segment(-0.12, -0.029, 0.12, -0.029, wallLayer),
    segment(-0.12, -0.02, 0.12, -0.02, wallLayer),
    segment(0.12, -0.02, 0.12, 0.02, wallLayer),
    segment(0.12, 0.02, -0.12, 0.02, wallLayer),
    segment(-0.12, 0.02, -0.12, -0.02, wallLayer),
    segment(0, -0.02, 0, -0.009, wallLayer),
    segment(0, 0.009, 0, 0.02, wallLayer),
    // Rotated PDF imports often encode the unit-tag box as a small filled
    // outline. It is annotation inside the suite, not structural walls.
    segment(-0.0775, -0.005, -0.0525, -0.005, { filled: true }),
    segment(-0.0525, -0.005, -0.0525, 0.005, { filled: true }),
    segment(-0.0525, 0.005, -0.0775, 0.005, { filled: true }),
    segment(-0.0775, 0.005, -0.0775, -0.005, { filled: true }),
  ];
  return {
    linework,
    closedPartition: segment(0, -0.02, 0, 0.02, wallLayer),
    angle,
    label: rotate(-0.065, 0),
    oppositeRoom: rotate(0.06, 0),
  };
}

function shapeArea(points: Array<{ x: number; y: number }>) {
  return Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length]!;
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  );
}

function pointToSegmentDistance(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const along =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - start.x) * dx + (point.y - start.y) * dy) /
              lengthSquared,
          ),
        );
  return Math.hypot(
    point.x - (start.x + along * dx),
    point.y - (start.y + along * dy),
  );
}

function directedBoundaryDistance(
  points: Array<{ x: number; y: number }>,
  boundary: Array<{ x: number; y: number }>,
) {
  return Math.max(
    ...points.map((point) =>
      Math.min(
        ...boundary.map((start, index) =>
          pointToSegmentDistance(
            point,
            start,
            boundary[(index + 1) % boundary.length]!,
          ),
        ),
      ),
    ),
  );
}

function boundedRoomGraph(): FloorGraph {
  const points = [
    { x: 0.1, y: 0.1 },
    { x: 0.4, y: 0.1 },
    { x: 0.4, y: 0.4 },
    { x: 0.1, y: 0.4 },
  ];
  return {
    faces: [
      {
        id: 0,
        shape: { type: "polygon", points, holes: [] },
        area: 0.09,
        centroid: { x: 0.25, y: 0.25 },
        bbox: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
        perimeter: 1.2,
        corridorLike: false,
        outside: false,
        voidLength: 0,
        voidSpans: [],
        neighbors: [],
        space: 0,
      },
    ],
    spaces: [
      {
        id: 0,
        faceIds: [0],
        area: 0.09,
        blocked: false,
        doors: new Map(),
      },
    ],
    wallThickness: 0.001,
    mode: "graded",
    stats: {} as FloorGraph["stats"],
  };
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

  it("grows a rotated multi-space suite past a filled unit-tag outline", () => {
    const fixture = rotatedMultiSpaceSuite();
    const graph = buildFloorGraph(fixture.linework);
    const [room] = assignRooms(graph, [
      { name: "UNIT A", kind: "unit", ...fixture.label },
    ]);

    expect(room).toBeDefined();
    expect(pointInPolygon(fixture.oppositeRoom, room!.shape)).toBe(true);
  });

  it("escapes a compact strong unit-label enclosure before suite growth", () => {
    const fixture = rotatedMultiSpaceSuite();
    const graph = buildFloorGraph(
      fixture.linework.map((segment, index) =>
        index >= fixture.linework.length - 4
          ? { ...segment, filled: false, strokeWidth: 20 }
          : segment,
      ),
    );
    const [room] = assignRooms(graph, [
      { name: "UNIT A", kind: "unit", ...fixture.label },
    ]);

    expect(room).toBeDefined();
    expect(pointInPolygon(fixture.oppositeRoom, room!.shape)).toBe(true);
  });

  it("recovers a rotated suite room when a flattened partition hides its doorway", () => {
    const fixture = rotatedMultiSpaceSuite();
    const withoutDoorway = fixture.linework
      .filter((_, index) => index !== 6 && index !== 7)
      .map((segment, index, filtered) =>
        index >= filtered.length - 4
          ? { ...segment, filled: false, strokeWidth: 20 }
          : segment,
      );
    const graph = buildFloorGraph([...withoutDoorway, fixture.closedPartition]);
    const [room] = assignRooms(graph, [
      {
        name: "UNIT A",
        kind: "unit",
        ...fixture.label,
        angle: fixture.angle,
      },
    ]);

    expect(room).toBeDefined();
    expect(pointInPolygon(fixture.oppositeRoom, room!.shape)).toBe(true);
  });

  it("assigns the same geometry before and after rotation", () => {
    const assign = (angle: number) => {
      const fixture = rotatedMultiSpaceSuite(angle);
      const graph = buildFloorGraph(fixture.linework);
      const [room] = assignRooms(graph, [
        { name: "UNIT A", kind: "unit", ...fixture.label, angle },
      ]);
      expect(room).toBeDefined();
      expect(pointInPolygon(fixture.oppositeRoom, room!.shape)).toBe(true);
      return room!;
    };

    const axisAligned = assign(0);
    const angle = Math.PI / 7;
    const rotated = assign(angle);
    const unrotatedPoints = rotated.shape.points.map((point) => {
      const x = point.x - 0.5;
      const y = point.y - 0.5;
      return {
        x: 0.5 + x * Math.cos(angle) + y * Math.sin(angle),
        y: 0.5 - x * Math.sin(angle) + y * Math.cos(angle),
      };
    });
    expect(shapeArea(rotated.shape.points)).toBeCloseTo(
      shapeArea(axisAligned.shape.points),
      4,
    );
    expect(
      directedBoundaryDistance(unrotatedPoints, axisAligned.shape.points),
    ).toBeLessThan(0.0015);
    expect(
      directedBoundaryDistance(axisAligned.shape.points, unrotatedPoints),
    ).toBeLessThan(0.0015);
  });

  it("recovers a PDF label that lands just outside a wall boundary", () => {
    const graph = boundedRoomGraph();
    const [room] = assignRooms(graph, [
      { name: "UNIT A", kind: "unit", x: 0.0999, y: 0.2 },
    ]);

    expect(room).toBeDefined();
    expect(pointInPolygon({ x: 0.2, y: 0.2 }, room!.shape)).toBe(true);
  });

  it("does not guess a room for a label beyond wall-sized tolerance", () => {
    const graph = boundedRoomGraph();
    const rooms = assignRooms(graph, [
      { name: "UNIT A", kind: "unit", x: 0.09, y: 0.2 },
    ]);

    expect(rooms).toHaveLength(0);
  });
});

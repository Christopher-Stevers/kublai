import { describe, expect, it } from "vitest";

import {
  findRoomAtPoint,
  pointInPolygon,
  roomLabelPoint,
  toPolygon,
  type RoomPolygonShape,
} from "~/lib/room-shape";

const box = (x: number, y: number, w: number, h: number) => ({
  type: "bbox" as const,
  x,
  y,
  w,
  h,
});

describe("interior room seed", () => {
  it("stays inside an L-shaped hallway whose bounding-box center is outside", () => {
    const room: RoomPolygonShape = {
      type: "polygon",
      points: [
        [0.1, 0.1],
        [0.3, 0.1],
        [0.3, 0.7],
        [0.9, 0.7],
        [0.9, 0.9],
        [0.1, 0.9],
      ].map(([x, y]) => ({ x: x!, y: y! })),
    };
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, room)).toBe(false);
    expect(pointInPolygon(roomLabelPoint(room), room)).toBe(true);
  });
  it("avoids a courtyard even when a narrow surrounding hall misses the search grid", () => {
    const room: RoomPolygonShape = {
      type: "polygon",
      points: [
        [0.1, 0.1],
        [0.9, 0.1],
        [0.9, 0.9],
        [0.1, 0.9],
      ].map(([x, y]) => ({ x: x!, y: y! })),
      holes: [
        [
          [0.101, 0.101],
          [0.899, 0.101],
          [0.899, 0.899],
          [0.101, 0.899],
        ].map(([x, y]) => ({ x: x!, y: y! })),
      ],
    };
    const point = roomLabelPoint(room);
    expect(pointInPolygon(point, room)).toBe(true);
    expect(room.points).not.toContainEqual(point);
  });
});

describe("room overlay hit testing", () => {
  it("finds a room from plan coordinates without SVG target metadata", () => {
    const rooms = [{ id: "room-a", shape: box(0.1, 0.2, 0.3, 0.25) }];

    expect(findRoomAtPoint(rooms, { x: 0.2, y: 0.3 })?.id).toBe("room-a");
    expect(findRoomAtPoint(rooms, { x: 0.8, y: 0.8 })).toBeNull();
  });

  it("selects the tightest polygon when room overlays overlap", () => {
    const rooms = [
      { id: "suite", shape: box(0.05, 0.05, 0.9, 0.9) },
      { id: "bath", shape: box(0.2, 0.2, 0.15, 0.15) },
    ];

    expect(findRoomAtPoint(rooms, { x: 0.25, y: 0.25 })?.id).toBe("bath");
    expect(
      pointInPolygon(
        { x: 0.25, y: 0.25 },
        toPolygon(box(0.2, 0.2, 0.15, 0.15)),
      ),
    ).toBe(true);
  });
});

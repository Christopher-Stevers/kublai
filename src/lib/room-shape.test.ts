import { describe, expect, it } from "vitest";

import { findRoomAtPoint, pointInPolygon, toPolygon } from "~/lib/room-shape";

const box = (x: number, y: number, w: number, h: number) => ({
  type: "bbox" as const,
  x,
  y,
  w,
  h,
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

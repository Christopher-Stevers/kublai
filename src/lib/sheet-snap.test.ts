import { describe, expect, it } from "vitest";
import {
  buildSnapIndex,
  mergeCollinear,
  snapToLine,
  type SnapSegment,
} from "./sheet-snap";

const dashes: SnapSegment[] = [
  { x1: 0.1, y1: 0.5, x2: 0.12, y2: 0.5 },
  { x1: 0.2, y1: 0.5, x2: 0.22, y2: 0.5 },
  { x1: 0.8, y1: 0.5, x2: 0.82, y2: 0.5 },
];

describe("snap to a line", () => {
  it("joins the dashes of one grid and snaps into the gap", () => {
    const merged = mergeCollinear(dashes, 0.5);
    expect(merged).toHaveLength(1);
    const line = merged[0]!;
    expect(line.x1).toBeCloseTo(0.1);
    expect(line.x2).toBeCloseTo(0.82);
    expect(line.y1).toBeCloseTo(0.5);
    expect(line.y2).toBeCloseTo(0.5);

    const index = buildSnapIndex(merged, 0.5);
    const hit = snapToLine({ x: 0.5, y: 0.52 }, index, 0.04);
    expect(hit?.point.x).toBeCloseTo(0.5);
    expect(hit?.point.y).toBeCloseTo(0.5);
  });

  it("leaves the point alone when no line is within reach", () => {
    const index = buildSnapIndex(mergeCollinear(dashes, 0.5), 0.5);
    expect(snapToLine({ x: 0.5, y: 0.9 }, index, 0.04)).toBeNull();
  });

  it("does not snap past the end of a line", () => {
    const index = buildSnapIndex([{ x1: 0.5, y1: 0.2, x2: 0.5, y2: 0.8 }], 0.5);
    // 0.1 in sheet height is 0.05 sheet-widths, past the 0.04 reach.
    expect(snapToLine({ x: 0.5, y: 0.9 }, index, 0.04)).toBeNull();
    const hit = snapToLine({ x: 0.52, y: 0.5 }, index, 0.04);
    expect(hit?.point.x).toBeCloseTo(0.5);
    expect(hit?.point.y).toBeCloseTo(0.5);
  });

  it("keeps parallel walls apart and prefers the line already chosen", () => {
    const walls: SnapSegment[] = [
      { x1: 0, y1: 0.5, x2: 1, y2: 0.5 },
      { x1: 0, y1: 0.53, x2: 1, y2: 0.53 },
    ];
    const index = buildSnapIndex(mergeCollinear(walls, 1), 1);
    expect(index.segments).toHaveLength(2);
    const nearer = snapToLine({ x: 0.4, y: 0.522 }, index, 0.05);
    expect(nearer?.point.y).toBeCloseTo(0.53);
    const stayed = snapToLine({ x: 0.4, y: 0.522 }, index, 0.05, walls[0]);
    expect(stayed?.point.y).toBeCloseTo(0.5);
    const left = snapToLine({ x: 0.4, y: 0.7 }, index, 0.05, walls[0]);
    expect(left).toBeNull();
  });

  it("drops a letter stroke and keeps a line across the sheet", () => {
    const merged = mergeCollinear(
      [
        { x1: 0.1, y1: 0.1, x2: 0.103, y2: 0.1 },
        { x1: 0, y1: 0.2, x2: 1, y2: 0.2 },
      ],
      1,
    );
    expect(merged).toEqual([{ x1: 0, y1: 0.2, x2: 1, y2: 0.2 }]);
  });
});

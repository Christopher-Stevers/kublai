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
  it("keeps close parallel lines and slightly tilted strokes on their exact source geometry", () => {
    const lines = [
      { x1: 0, y1: 0.5, x2: 1, y2: 0.5 },
      { x1: 0, y1: 0.5001, x2: 1, y2: 0.5001 },
      { x1: 0, y1: 0.5, x2: 1, y2: 0.5004 },
    ];
    const merged = mergeCollinear(lines, 1);
    expect(merged).toHaveLength(3);
    for (const line of lines) expect(merged).toContainEqual(line);
  });

  it("joins rotated grid dashes without rounding their angle or averaging their position", () => {
    const theta = Math.PI / 8;
    const point = (t: number) => ({ x: 0.1 + t * Math.cos(theta), y: 0.2 + t * Math.sin(theta) });
    const segment = (a: number, b: number) => ({ x1: point(a).x, y1: point(a).y, x2: point(b).x, y2: point(b).y });
    const merged = mergeCollinear([segment(0, 0.02), segment(0.4, 0.42), segment(0.8, 0.82)], 1);
    expect(merged).toHaveLength(1);
    const hit = snapToLine(point(0.3), buildSnapIndex(merged, 1), 0.001);
    expect(hit?.distance).toBeLessThan(1e-12);
  });

  it("puts the M-102 grid 1.07 guide on its PDF dashes rather than the adjacent wall", () => {
    // Actual source strokes from the user's drawing, page 5. The old 0.0015
    // bucket merged these separate lines and put the guide between them.
    const gridX = 0.26496527777777784;
    const raw = [
      { x1: gridX, y1: 0.06671296296296299, x2: gridX, y2: 0.07365740740740744 },
      { x1: gridX, y1: 0.07504629629629629, x2: gridX, y2: 0.0763888888888889 },
      { x1: gridX, y1: 0.07777777777777774, x2: gridX, y2: 0.08597222222222228 },
      { x1: 0.2660069444444445, y1: 0.22185185185185183, x2: 0.2660069444444445, y2: 0.13092592592592597 },
      { x1: 0.2660069444444445, y1: 0.24115740740740746, x2: 0.2660069444444445, y2: 0.3305092592592593 },
    ];
    const merged = mergeCollinear(raw, 0.75);
    expect(merged).toHaveLength(2);
    const hit = snapToLine({ x: gridX, y: 0.078 }, buildSnapIndex(merged, 0.75), 18 / 10000);
    expect(hit?.point.x).toBe(gridX);
    expect(hit?.distance).toBeLessThan(1e-12);
  });

  it("allows precise placement on a nearer parallel line instead of sticking to the anchor's line", () => {
    const lines = [
      { x1: 0, y1: 0.5, x2: 1, y2: 0.5 },
      { x1: 0, y1: 0.53, x2: 1, y2: 0.53 },
    ];
    const index = buildSnapIndex(lines, 1);
    const hit = snapToLine({ x: 0.4, y: 0.529 }, index, 0.05, lines[0], 0.004);
    expect(hit?.segment).toBe(lines[1]);
  });

});

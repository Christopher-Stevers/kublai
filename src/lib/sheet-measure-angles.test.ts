import { describe, expect, it } from "vitest";
import { measurementAngleArc, measurementAngleReference } from "./sheet-measure-angles";

describe("measurement angle references", () => {
  const firstLine = { x1: 0, y1: 0, x2: 1, y2: 0.7 };
  const otherLine = { x1: 0, y1: 0.3, x2: 1, y2: 0.3 };
  const nodes = [
    { point: { x: 0.2, y: 0.14 }, line: firstLine },
    { point: { x: 0.4, y: 0.3 }, line: otherLine },
    { point: { x: 0.6, y: 0.4 }, line: null },
  ];
  it("uses the first attached line, then the actual preceding segment for additions and drags", () => {
    expect(measurementAngleReference(nodes, 1)?.reference).toBe(firstLine);
    expect(measurementAngleReference(nodes, 2)?.reference).toEqual({ x1: 0.2, y1: 0.14, x2: 0.4, y2: 0.3 });
    expect(measurementAngleReference(nodes, 3)?.reference).toEqual({ x1: 0.4, y1: 0.3, x2: 0.6, y2: 0.4 });
    expect(measurementAngleReference(nodes, 0)?.reference).toEqual({ x1: 0.6, y1: 0.4, x2: 0.4, y2: 0.3 });
    expect(measurementAngleReference([], 0)).toBeNull();
  });
});

describe("drafting angle arcs", () => {
  const horizontal = { x1: 0, y1: 0.5, x2: 1, y2: 0.5 };
  const vertex = { x: 0.5, y: 0.5 };
  it("uses real sheet proportions and chooses the same first angle when a drawing line is reversed", () => {
    const end = { x: 0.7, y: 0.1 };
    const arc = measurementAngleArc(vertex, end, horizontal, 800, 400, 1)!;
    const reversed = measurementAngleArc(vertex, end, { x1: 1, y1: 0.5, x2: 0, y2: 0.5 }, 800, 400, 1)!;
    expect(arc.text).toBe("45°");
    expect(reversed.degrees).toBeCloseTo(arc.degrees);
    expect(arc.vertex).toEqual({ x: 400, y: 200 });
    expect(arc.start).toEqual({ x: 426, y: 200 });
    expect(arc.finish.x - 400).toBeCloseTo(200 - arc.finish.y);
    expect(arc.label.x - 400).toBeGreaterThan(arc.start.x - 400);
  });
  it("shows the true inside angle, with an arc between the incoming and outgoing segments", () => {
    const arc = measurementAngleArc(vertex, { x: 0.7, y: 0.1 }, horizontal, 800, 400, 1, { x: 0.1, y: 0.5 })!;
    expect(arc.text).toBe("135°");
    expect(arc.start.x).toBeCloseTo(374);
    expect(arc.start.y).toBeCloseTo(200);
    expect(arc.path).toContain(" A 26 26 0 0 1 ");
    expect(arc.referenceEnd).toBeNull();
  });
  it("keeps the arc a constant size on screen at different zooms and avoids zero-length/straight corners", () => {
    const end = { x: 0.5, y: 0.1 };
    const a = measurementAngleArc(vertex, end, horizontal, 800, 400, 1)!;
    const b = measurementAngleArc(vertex, end, horizontal, 800, 400, 3)!;
    expect(b.radius * 3).toBeCloseTo(a.radius);
    expect(measurementAngleArc(vertex, vertex, horizontal, 800, 400, 1)).toBeNull();
    expect(measurementAngleArc(vertex, { x: 0.8, y: 0.5 }, horizontal, 800, 400, 1, { x: 0.2, y: 0.5 })).toBeNull();
  });
});

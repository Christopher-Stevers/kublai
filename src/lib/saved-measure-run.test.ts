import { describe, expect, it } from "vitest";
import { drawingMarkupSchema, type DrawingMarkup } from "./drawing-workspace";
import {
  savedMeasureAngleArcs,
  savedMeasureNodes,
  savedMeasureReferences,
} from "./saved-measure-run";

const sourceSheetId = "0391aed4-7773-47ec-9141-09df373ec008";
const markup = (
  points: DrawingMarkup["points"],
  parents: DrawingMarkup["parents"],
): DrawingMarkup => ({
  sourceSheetId,
  type: "dimension",
  points,
  parents,
  stroke: "#00ffff",
  width: 2,
});

describe("saved measurement angles", () => {
  it("keeps corner and branch angles from existing graph data without new stored references", () => {
    const corner = markup(
      [
        { x: 0.1, y: 0.5 },
        { x: 0.3, y: 0.5 },
        { x: 0.3, y: 0.8 },
        { x: 0.45, y: 0.95 },
      ],
      [null, 0, 1, 2],
    );
    expect(savedMeasureAngleArcs(corner, 1).map((arc) => arc.text)).toEqual([
      "90°",
      "135°",
    ]);
    const branch = markup(
      [
        { x: 0.1, y: 0.5 },
        { x: 0.9, y: 0.5 },
        { x: 0.4, y: 0.5 },
        { x: 0.4, y: 0.1 },
      ],
      [null, 2, 0, 2],
    );
    expect(savedMeasureAngleArcs(branch, 0.5).map((arc) => arc.text)).toEqual([
      "90°",
    ]);
  });
  it("preserves a non-horizontal first reference through schema parsing and re-entering Measure", () => {
    const data = markup(
      [
        { x: 0.3, y: 0.3 },
        { x: 0.5, y: 0.3 },
      ],
      [null, 0],
    );
    data.angleReferences = savedMeasureReferences([
      {
        point: data.points[0]!,
        parent: null,
        line: { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.5 },
      },
      { point: data.points[1]!, parent: 0, line: null },
    ]);
    const parsed = drawingMarkupSchema.parse(JSON.parse(JSON.stringify(data)));
    const arcs = savedMeasureAngleArcs(parsed, 0.5);
    expect(arcs.map((arc) => arc.text)).toEqual(["45°"]);
    expect(arcs[0]!.referenceEnd).not.toBeNull();
    const restored = savedMeasureReferences(savedMeasureNodes(parsed));
    expect(restored[0]!.x).toBeCloseTo(data.angleReferences[0]!.x, 12);
    expect(restored[0]!.y).toBeCloseTo(data.angleReferences[0]!.y, 12);
    expect(restored[1]).toBeNull();
    expect(
      savedMeasureAngleArcs({ ...parsed, angleReferences: undefined }, 0.5),
    ).toEqual([]);
  });
  it("uses sheet aspect and keeps arc radius and label offsets at the same screen size while zooming", () => {
    const data = markup(
      [
        { x: 0.2, y: 0.2 },
        { x: 0.4, y: 0.4 },
      ],
      [null, 0],
    );
    expect(savedMeasureAngleArcs(data, 1)[0]!.text).toBe("45°");
    expect(savedMeasureAngleArcs(data, 0.5)).toEqual([]);
    const a = savedMeasureAngleArcs(data, 1, 1)[0]!,
      b = savedMeasureAngleArcs(data, 1, 0.5)[0]!;
    expect(a.radius).toBeCloseTo(b.radius * 2);
    expect(
      Math.hypot(a.label.x - a.vertex.x, a.label.y - a.vertex.y),
    ).toBeCloseTo(
      Math.hypot(b.label.x - b.vertex.x, b.label.y - b.vertex.y) * 2,
    );
  });
  it("rejects mismatched, zero and unbounded directions and unrelated markup types", () => {
    const data = markup(
      [
        { x: 0.1, y: 0.2 },
        { x: 0.5, y: 0.2 },
      ],
      [null, 0],
    );
    for (const angleReferences of [
      [null],
      [{ x: 0, y: 0 }, null],
      [{ x: Infinity, y: 0 }, null],
      [{ x: 2, y: 0 }, null],
    ]) {
      expect(
        drawingMarkupSchema.safeParse({ ...data, angleReferences }).success,
      ).toBe(false);
    }
    expect(
      drawingMarkupSchema.safeParse({
        ...data,
        type: "line",
        parents: undefined,
        angleReferences: [null, null],
      }).success,
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { drawingAngle, drawingArea, drawingCloudPath, drawingMeasurement, simplifyDrawingStroke, translateDrawingPoints } from "./drawing-annotation-geometry";
import type { DrawingMarkup } from "./drawing-workspace";

describe("drawing annotation geometry", () => {
  it("measures area and angles in physical sheet coordinates, including non-square pages", () => {
    const triangle = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
    expect(drawingArea(triangle, 0.5, 100)).toBe(2500);
    expect(drawingAngle([{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }], 0.5)).toBeCloseTo(26.565, 3);
    expect(drawingAngle([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }], 0.5)).toBeNull();
  });
  it("uses a saved measurement scale or shared calibration, never a guessed length", () => {
    const data: DrawingMarkup = { sourceSheetId: "sheet", type: "dimension", points: [{ x: 0, y: 0 }, { x: 0, y: 1 }], stroke: "#ff0000", width: 2 };
    expect(drawingMeasurement(data, 0.5)).toBe("Set scale");
    expect(drawingMeasurement(data, 0.5, { unit: "ft", unitsPerSheetWidth: 100 })).toBe("50'-0\"");
    expect(drawingMeasurement({ ...data, scale: 20, unit: "m" }, 0.5, { unit: "ft", unitsPerSheetWidth: 100 })).toBe("10 m");
  });
  it("moves a whole shape without deforming it or crossing the page edge", () => {
    expect(translateDrawingPoints([{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.6 }], { x: 0.5, y: -0.5 }))
      .toEqual([{ x: 0.39999999999999997, y: 0 }, { x: 1, y: 0.3 }]);
  });
  it("simplifies redundant pen samples but keeps corners and renders actual cloud polygons", () => {
    const points = [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.2, y: 0 }, { x: 0.2, y: 0.2 }];
    expect(simplifyDrawingStroke(points, 0.001, 0.5)).toEqual([points[0], points[2], points[3]]);
    const cloud = drawingCloudPath([{ x: 0, y: 0 }, { x: 0.2, y: 0 }, { x: 0.1, y: 0.2 }], 0.5);
    expect(cloud).toMatch(/^M 0 0 Q /);
    expect(cloud).toContain("100 100");
    expect(cloud).toMatch(/ Z$/);
  });
});

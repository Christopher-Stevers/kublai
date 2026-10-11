import { describe, expect, it } from "vitest";
import {
  drawingPdfOperationsFilter,
  isFullDrawingPatch,
  type PdfOperationBounds,
} from "./drawing-pdf-operations";
import type { DrawingPatch } from "./drawing-viewport";
const crop: DrawingPatch = {
  left: 0.25,
  top: 0.25,
  width: 0.5,
  height: 0.5,
  pixelWidth: 100,
  pixelHeight: 100,
  fullWidth: 200,
  fullHeight: 200,
};
const boxes = [
  [0, 0, 0.1, 0.1],
  [0.3, 0.4, 0.6, 0.5],
  [0.75, 0.25, 0.9, 0.4],
  [0.2, 0.75, 0.4, 0.9],
  [0.8, 0.8, 1, 1],
  [0, 0, 1, 1],
];
const bounds: PdfOperationBounds = {
  isEmpty: (i) => i === 5,
  minX: (i) => boxes[i]![0]!,
  minY: (i) => boxes[i]![1]!,
  maxX: (i) => boxes[i]![2]!,
  maxY: (i) => boxes[i]![3]!,
};
describe("PDF detail operation selection", () => {
  it("keeps touching edges and all intersecting dependencies, while skipping empty and distant operations", () => {
    const filter = drawingPdfOperationsFilter(bounds, crop)!;
    expect(boxes.map((_, i) => filter(i))).toEqual([
      false,
      true,
      true,
      true,
      false,
      false,
    ]);
  });
  it("retains the full rendering path before a complete page has been recorded", () => {
    expect(drawingPdfOperationsFilter(undefined, crop)).toBeUndefined();
    expect(drawingPdfOperationsFilter(null, crop)).toBeUndefined();
    const full = { ...crop, left: 0, top: 0, width: 1, height: 1 };
    expect(isFullDrawingPatch(full)).toBe(true);
    expect(drawingPdfOperationsFilter(bounds, full)).toBeUndefined();
    expect(isFullDrawingPatch({ ...full, width: 0.999 })).toBe(false);
  });
});

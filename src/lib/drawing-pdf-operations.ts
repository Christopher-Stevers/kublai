import type { DrawingPatch } from "./drawing-viewport";

/** PDF.js records conservative page-space bounds, including state dependencies. */
export type PdfOperationBounds = {
  isEmpty: (index: number) => boolean;
  minX: (index: number) => number;
  maxX: (index: number) => number;
  minY: (index: number) => number;
  maxY: (index: number) => number;
};

export function isFullDrawingPatch(patch: DrawingPatch) {
  return (
    patch.left === 0 &&
    patch.top === 0 &&
    patch.width === 1 &&
    patch.height === 1
  );
}

/** Same conservative intersection used by PDF.js's own partial page viewer.
 * A full-page recording is required: bounds from a clipped render would omit
 * objects outside that crop. Without one, render the complete operator list.
 */
export function drawingPdfOperationsFilter(
  bounds: PdfOperationBounds | null | undefined,
  patch: DrawingPatch,
) {
  if (!bounds || isFullDrawingPatch(patch)) return undefined;
  const right = patch.left + patch.width,
    bottom = patch.top + patch.height;
  return (index: number) =>
    !bounds.isEmpty(index) &&
    bounds.minX(index) <= right &&
    bounds.maxX(index) >= patch.left &&
    bounds.minY(index) <= bottom &&
    bounds.maxY(index) >= patch.top;
}

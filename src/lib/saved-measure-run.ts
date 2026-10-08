import type { DrawingMarkup } from "./drawing-workspace";
import type { SheetScale } from "./sheet-measure";
import type { MeasureRunNode } from "./sheet-measure-run";

export function savedMeasureNodes(data: DrawingMarkup): MeasureRunNode[] {
  return data.points.map((point, index) => ({
    point: { ...point },
    parent: data.parents?.[index] ?? null,
    line: null,
  }));
}

/** Saved scales are in the displayed unit; the measuring tool uses meters or feet. */
export function savedMeasureScale(
  data: DrawingMarkup,
  sharedScale: SheetScale | null | undefined,
): SheetScale | null {
  if (!data.scale || !data.unit) return sharedScale ?? null;
  return {
    unit: data.unit === "ft" || data.unit === "in" ? "ft" : "m",
    unitsPerSheetWidth:
      data.scale /
      (data.unit === "mm"
        ? 1000
        : data.unit === "cm"
          ? 100
          : data.unit === "in"
            ? 12
            : 1),
  };
}

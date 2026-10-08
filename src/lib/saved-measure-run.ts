import type { DrawingMarkup } from "./drawing-workspace";
import type { SheetScale } from "./sheet-measure";
import { runAngleReference, type MeasureRunNode } from "./sheet-measure-run";
import { measurementAngleArc } from "./sheet-measure-angles";

export function savedMeasureNodes(data: DrawingMarkup): MeasureRunNode[] {
  return data.points.map((point, index) => {
    const reference = data.angleReferences?.[index];
    return {
      point: { ...point },
      parent: data.parents?.[index] ?? null,
      referenceOnly: Boolean(reference),
      line: reference
        ? {
            x1: point.x,
            y1: point.y,
            x2: point.x + reference.x,
            y2: point.y + reference.y,
          }
        : null,
    };
  });
}

export function savedMeasureReferences(nodes: readonly MeasureRunNode[]) {
  return nodes.map(({ line }) => {
    if (!line) return null;
    const x = line.x2 - line.x1,
      y = line.y2 - line.y1,
      length = Math.hypot(x, y);
    return length > 1e-9 ? { x: x / length, y: y / length } : null;
  });
}

/** Same graph reference and drafting arc geometry as the active Measure tool. */
export function savedMeasureAngleArcs(
  data: DrawingMarkup,
  aspect: number,
  screenPixelSize = 1,
) {
  if (!data.parents || !(aspect > 0 && screenPixelSize > 0)) return [];
  const nodes = savedMeasureNodes(data);
  return nodes.flatMap((node, index) => {
    if (node.parent === null) return [];
    const reference = runAngleReference(nodes, index, null);
    if (!reference) return [];
    const arc = measurementAngleArc(
      reference.anchor,
      node.point,
      reference.reference,
      1000,
      1000 * aspect,
      1 / screenPixelSize,
      reference.previous,
    );
    if (
      !arc ||
      (!reference.previous &&
        !reference.reference &&
        Math.min(Math.abs(arc.degrees - 45), Math.abs(arc.degrees - 90)) > 1e-6)
    )
      return [];
    return [{ ...arc, index }];
  });
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

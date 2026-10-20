import type { PipeSegment, PipeSystemSelection } from "./pipe-system";
import type { SheetPoint } from "./sheet-measure";

/** Even-odd test, so a loop drawn over itself still behaves predictably. */
export function insideLasso(point: SheetPoint, polygon: SheetPoint[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

function crossing(
  p: SheetPoint,
  q: SheetPoint,
  a: SheetPoint,
  b: SheetPoint,
): number | null {
  const rx = q.x - p.x;
  const ry = q.y - p.y;
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const denominator = rx * sy - ry * sx;
  if (denominator === 0) return null;
  const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / denominator;
  const u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / denominator;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : null;
}

type Bounds = { left: number; top: number; right: number; bottom: number };
function bounds(polygon: SheetPoint[]): Bounds {
  return polygon.reduce(
    (box, point) => ({
      left: Math.min(box.left, point.x),
      top: Math.min(box.top, point.y),
      right: Math.max(box.right, point.x),
      bottom: Math.max(box.bottom, point.y),
    }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
  );
}

/** The parts of one segment inside the loop, as [start, end] fractions. */
export function lassoIntervals(
  segment: Pick<PipeSegment, "x1" | "y1" | "x2" | "y2">,
  polygon: SheetPoint[],
  box: Bounds = bounds(polygon),
): [number, number][] {
  if (polygon.length < 3) return [];
  if (
    Math.max(segment.x1, segment.x2) < box.left ||
    Math.min(segment.x1, segment.x2) > box.right ||
    Math.max(segment.y1, segment.y2) < box.top ||
    Math.min(segment.y1, segment.y2) > box.bottom
  )
    return [];
  const p = { x: segment.x1, y: segment.y1 };
  const q = { x: segment.x2, y: segment.y2 };
  const cuts = [0, 1];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const t = crossing(p, q, polygon[j]!, polygon[i]!);
    if (t !== null) cuts.push(t);
  }
  cuts.sort((a, b) => a - b);
  const kept: [number, number][] = [];
  for (let i = 1; i < cuts.length; i++) {
    const start = cuts[i - 1]!;
    const end = cuts[i]!;
    if (end - start < 1e-9) continue;
    const middle = (start + end) / 2;
    if (!insideLasso({ x: p.x + (q.x - p.x) * middle, y: p.y + (q.y - p.y) * middle }, polygon))
      continue;
    const last = kept[kept.length - 1];
    if (last && start - last[1] < 1e-9) last[1] = end;
    else kept.push([start, end]);
  }
  return kept;
}

/**
 * Keep only the highlighted pipe inside a hand-drawn loop. Segments crossing
 * the loop are cut at its edge so the distance counts just the enclosed part.
 */
export function clipPipeSelection(
  selection: PipeSystemSelection,
  polygon: SheetPoint[],
  aspect: number,
): PipeSystemSelection {
  const box = bounds(polygon);
  const segments: PipeSegment[] = [];
  let length = 0;
  for (const segment of selection.segments) {
    const parts = lassoIntervals(segment, polygon, box);
    parts.forEach(([start, end], index) => {
      const dx = segment.x2 - segment.x1;
      const dy = segment.y2 - segment.y1;
      const whole = parts.length === 1 && start === 0 && end === 1;
      const piece = whole
        ? segment
        : {
            ...segment,
            id: parts.length === 1 ? segment.id : `${segment.id}~${index}`,
            x1: segment.x1 + dx * start,
            y1: segment.y1 + dy * start,
            x2: segment.x1 + dx * end,
            y2: segment.y1 + dy * end,
          };
      segments.push(piece);
      length += Math.hypot(piece.x2 - piece.x1, (piece.y2 - piece.y1) * aspect);
    });
  }
  return { ...selection, segments, lengthInSheetWidths: length };
}

/** Drop near-duplicate points from a freehand stroke (sheet-width units). */
export function simplifyLasso(points: SheetPoint[], spacing: number, aspect: number) {
  const kept: SheetPoint[] = [];
  for (const point of points) {
    const last = kept[kept.length - 1];
    if (!last || Math.hypot(point.x - last.x, (point.y - last.y) * aspect) >= spacing)
      kept.push(point);
  }
  return kept;
}

/** SVG path in the viewer's 1000-wide sheet units. */
export function lassoPathData(points: SheetPoint[], aspect: number, closed: boolean) {
  return (
    points
      .map((point, index) => `${index ? "L" : "M"}${point.x * 1000},${point.y * aspect * 1000}`)
      .join("") + (closed && points.length > 2 ? "Z" : "")
  );
}

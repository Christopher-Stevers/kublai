import type { PipeLinework, PipeSegment } from "./pipe-system";
import type { PipeSymbolPath } from "./pipe-components-types";
import type { SheetPoint } from "./sheet-measure";

/** Recover compact symbol strokes omitted by the symbol-only budget. The bounded
 * measurement cache already retains these paths; no new PDF download is needed. */
export function recoverPipeSymbols(
  linework: PipeLinework,
  near: (
    point: SheetPoint,
    reach: number,
  ) => { segment: PipeSegment; distance: number }[],
  limited: () => void,
): PipeSymbolPath[] {
  if (!linework.componentDataPartial) return linework.symbols ?? [];
  const paths = new Map<string, PipeSymbolPath>();
  const broken = new Set<string>();
  if (linework.segments.length > 200000) limited();
  for (const segment of linework.segments.slice(0, 200000)) {
    let path = paths.get(segment.pathId);
    if (!path) {
      path = {
        id: segment.pathId,
        points: [{ x: segment.x1, y: segment.y1 }],
        closed: !!segment.closed,
        layer: segment.layer,
      };
      paths.set(segment.pathId, path);
    }
    const last = path.points.at(-1)!;
    if (Math.hypot(last.x - segment.x1, last.y - segment.y1) > 1e-8)
      broken.add(segment.pathId);
    if (path.points.length <= 512)
      path.points.push({ x: segment.x2, y: segment.y2 });
  }
  const recovered: PipeSymbolPath[] = [];
  for (const path of paths.values()) {
    if (
      broken.has(path.id) ||
      path.points.length < 3 ||
      path.points.length > 512
    )
      continue;
    const first = path.points[0]!,
      last = path.points.at(-1)!;
    if (path.closed && Math.hypot(first.x - last.x, first.y - last.y) > 1e-8)
      continue;
    const xs = path.points.map((p) => p.x),
      ys = path.points.map((p) => p.y);
    const left = Math.min(...xs),
      right = Math.max(...xs),
      top = Math.min(...ys),
      bottom = Math.max(...ys);
    const size = Math.max(right - left, (bottom - top) * linework.aspect);
    if (
      size < 0.0002 ||
      size > 0.06 ||
      Math.min(right - left, (bottom - top) * linework.aspect) < 0.0001
    )
      continue;
    if (
      !near(
        { x: (left + right) / 2, y: (top + bottom) / 2 },
        Math.min(0.02, size / 2 + 0.003),
      ).length
    )
      continue;
    recovered.push(path);
  }
  const seen = new Set<string>(),
    result: PipeSymbolPath[] = [];
  let points = 0;
  for (const path of [...recovered, ...(linework.symbols ?? [])]) {
    if (seen.has(path.id)) continue;
    if (result.length >= 15000 || points + path.points.length > 200000) {
      limited();
      continue;
    }
    result.push(path);
    points += path.points.length;
    seen.add(path.id);
  }
  return result;
}

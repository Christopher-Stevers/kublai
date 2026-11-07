import type { PipeComponentBox, PipeSymbolPath } from "./pipe-components-types";
import type { PipeSegment } from "./pipe-system";
import type { SheetPoint } from "./sheet-measure";
export type FittingGroup = {
  id: string;
  paths: PipeSymbolPath[];
  box: PipeComponentBox;
  point: SheetPoint;
  layer?: string;
  fittingOnly?: boolean;
};
function boxOf(paths: PipeSymbolPath[]) {
  const points = paths.flatMap((p) => p.points);
  return {
    left: Math.min(...points.map((p) => p.x)),
    right: Math.max(...points.map((p) => p.x)),
    top: Math.min(...points.map((p) => p.y)),
    bottom: Math.max(...points.map((p) => p.y)),
  };
}
/** Separate the glyph from its arbitrary-length pipe stem. */
export function fittingCore(
  paths: PipeSymbolPath[],
  aspect: number,
): PipeSymbolPath[] {
  return paths.filter((p) => {
    if (
      p.points.length < 3 ||
      p.points.length > 512 ||
      !p.points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))
    )
      return false;
    const a = p.points[0]!;
    const far = p.points.reduce(
      (b, q) =>
        Math.hypot(q.x - a.x, (q.y - a.y) * aspect) >
        Math.hypot(b.x - a.x, (b.y - a.y) * aspect)
          ? q
          : b,
      a,
    );
    const dx = far.x - a.x,
      dy = (far.y - a.y) * aspect,
      length = Math.hypot(dx, dy);
    return (
      length > 0 &&
      p.points.some(
        (q) =>
          Math.abs((q.x - a.x) * dy - (q.y - a.y) * aspect * dx) >
          length * length * 0.015,
      )
    );
  });
}
export function coreGroup(
  g: FittingGroup,
  aspect: number,
): FittingGroup | null {
  const paths = fittingCore(g.paths, aspect);
  if (!paths.length) return null;
  const box = boxOf(paths);
  return {
    ...g,
    paths,
    box,
    point: { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 },
  };
}
/** Preserve open/closed topology even when a PDF splits a loop into two arcs. */
export function closedFittingOutline(
  paths: PipeSymbolPath[],
  aspect: number,
): boolean {
  const b = boxOf(paths),
    epsilon = Math.max(b.right - b.left, (b.bottom - b.top) * aspect) * 0.025;
  const close = (a: SheetPoint, b: SheetPoint) =>
    Math.hypot(a.x - b.x, (a.y - b.y) * aspect) <= epsilon;
  if (paths.some((p) => p.closed || close(p.points[0]!, p.points.at(-1)!)))
    return true;
  return paths.some((a, i) =>
    paths
      .slice(i + 1)
      .some(
        (b) =>
          (close(a.points[0]!, b.points[0]!) &&
            close(a.points.at(-1)!, b.points.at(-1)!)) ||
          (close(a.points[0]!, b.points.at(-1)!) &&
            close(a.points.at(-1)!, b.points[0]!)),
      ),
  );
}
export function fittingGroups(
  paths: PipeSymbolPath[],
  aspect: number,
  near: (
    p: SheetPoint,
    reach: number,
  ) => { segment: PipeSegment; distance: number }[],
  limited: () => void,
): FittingGroup[] {
  const groups: FittingGroup[] = [];
  const pairs: FittingGroup[] = [];
  const cells = new Map<string, FittingGroup[]>();
  let work = 0;
  for (const p of fittingCore(paths, aspect)) {
    const b = boxOf([p]),
      span = Math.max(b.right - b.left, (b.bottom - b.top) * aspect);
    if (span < 0.0002 || span > 0.02) continue;
    const point = { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
    if (!near(point, span / 2 + 0.0003).length) continue;
    const own: FittingGroup = {
      id: `core:${p.id}`,
      paths: [p],
      box: b,
      point,
      layer: p.layer,
      fittingOnly: true,
    };
    if (groups.length >= 3000) {
      limited();
      break;
    }
    groups.push(own);
    const cx = Math.floor(point.x / 0.02),
      cy = Math.floor((point.y * aspect) / 0.02);
    for (let x = cx - 1; x <= cx + 1; x++)
      for (let y = cy - 1; y <= cy + 1; y++)
        for (const other of cells.get(`${x},${y}`) ?? []) {
          if (++work > 100000 || pairs.length >= 1500) {
            limited();
            break;
          }
          if (p.layer !== other.layer) continue;
          const ob = other.box,
            os = Math.max(ob.right - ob.left, (ob.bottom - ob.top) * aspect);
          if (
            Math.hypot(
              point.x - other.point.x,
              (point.y - other.point.y) * aspect,
            ) >
            Math.max(span, os) *
              (p.closed || other.paths[0]?.closed ? 0.4 : 1.4)
          )
            continue;
          const joined = [...other.paths, p],
            box = boxOf(joined);
          // Separate close symbols stay separate candidates; combinations are
          // accepted later only if the complete reviewed glyph matches.
          pairs.push({
            id: `${other.id}|${p.id}`,
            paths: joined,
            box,
            point: {
              x: (box.left + box.right) / 2,
              y: (box.top + box.bottom) / 2,
            },
            layer: p.layer,
            fittingOnly: true,
          });
        }
    const key = `${cx},${cy}`,
      list = cells.get(key) ?? [];
    if (list.length < 128) list.push(own);
    else limited();
    cells.set(key, list);
  }
  return [...groups, ...pairs];
}
export function fittingConnection(
  g: FittingGroup,
  segments: PipeSegment[],
  aspect: number,
): "end" | "through" | "unknown" {
  const radius =
    Math.max(g.box.right - g.box.left, (g.box.bottom - g.box.top) * aspect) / 2;
  const rays: { x: number; y: number }[] = [],
    own = new Set(g.paths.map((p) => p.id));
  for (const s of segments) {
    if (own.has(s.pathId) || s.id.startsWith("pipe-bridge:") || s.closed)
      continue;
    const dx = s.x2 - s.x1,
      dy = (s.y2 - s.y1) * aspect,
      length = Math.hypot(dx, dy);
    if (length < radius * 0.5) continue;
    const ux = dx / length,
      uy = dy / length;
    const ax = s.x1 - g.point.x,
      ay = (s.y1 - g.point.y) * aspect;
    if (Math.abs(ax * uy - ay * ux) > Math.max(0.00003, radius * 0.3)) continue;
    for (const q of [
      { x: s.x1, y: s.y1 },
      { x: s.x2, y: s.y2 },
    ]) {
      const projection =
        (q.x - g.point.x) * ux + (q.y - g.point.y) * aspect * uy;
      if (Math.abs(projection) < radius * 1.1) continue;
      const sign = Math.sign(projection),
        ray = { x: ux * sign, y: uy * sign };
      if (!rays.some((r) => r.x * ray.x + r.y * ray.y > 0.98)) rays.push(ray);
    }
  }
  if (rays.length === 1) return "end";
  if (
    rays.length === 2 &&
    rays[0]!.x * rays[1]!.x + rays[0]!.y * rays[1]!.y < -0.98
  )
    return "through";
  return "unknown";
}

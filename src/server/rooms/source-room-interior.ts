import type { RoomPoint, RoomPolygonShape } from "~/lib/room-shape";
import { pointInPolygon } from "~/lib/room-shape";
import type { WallSegment } from "./pdf-walls";

/** Move a graph centreline inward only where a continuous parallel source
 * wall face exists. Preserve edge directions/topology; never extend an enclosure.
 * Ambiguous corners or crossings leave the original candidate for rejection. */
export function sourceRoomInterior(
  shape: RoomPolygonShape,
  source: WallSegment[],
  seed: RoomPoint,
  arcs: WallSegment[] = [],
): RoomPolygonShape {
  source = source.filter((s) => !s.dashed && !s.curve);
  arcs = arcs.filter((s) => !s.dashed);
  const weighted = source
    .filter((s) => !s.filled)
    .map((s) => ({
      width: s.strokeWidth,
      length: Math.hypot(s.x2 - s.x1, s.y2 - s.y1),
    }))
    .sort((a, b) => a.width - b.width);
  const total = weighted.reduce((sum, s) => sum + s.length, 0);
  let accumulated = 0,
    reference = 0;
  for (const row of weighted) {
    accumulated += row.length;
    if (accumulated >= total / 2) {
      reference = row.width;
      break;
    }
  }
  // Poché or paired source runs with matching width, extent and endpoints.
  // Mere proximity to a parallel leader/door leaf cannot shrink the room.
  const structural = source.filter((s) => {
    if (s.filled || (reference > 0 && s.strokeWidth >= reference * 2.5))
      return true;
    const dx = s.x2 - s.x1,
      dy = s.y2 - s.y1,
      length = Math.hypot(dx, dy);
    if (length < 0.003) return false;
    return source.some((other) => {
      if (other === s || other.strokeWidth !== s.strokeWidth) return false;
      const ox = other.x2 - other.x1,
        oy = other.y2 - other.y1,
        ol = Math.hypot(ox, oy);
      if (
        Math.abs(length - ol) > length * 0.2 ||
        Math.abs(dx * oy - dy * ox) > length * ol * 0.01
      )
        return false;
      const distance =
        Math.abs(dx * (other.y1 - s.y1) - dy * (other.x1 - s.x1)) / length;
      if (distance < 0.00015 || distance > 0.0015) return false;
      const a = ((other.x1 - s.x1) * dx + (other.y1 - s.y1) * dy) / length,
        b = ((other.x2 - s.x1) * dx + (other.y2 - s.y1) * dy) / length;
      return (
        Math.abs(Math.min(a, b)) < 0.0015 &&
        Math.abs(Math.max(a, b) - length) < 0.0015
      );
    });
  });
  const points = shape.points;
  let signed = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    signed += a.x * b.y - b.x * a.y;
  }
  const sign = signed >= 0 ? 1 : -1;
  const lines = points.map((a, i) => {
    const b = points[(i + 1) % points.length]!,
      dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy);
    const ux = dx / length,
      uy = dy / length,
      nx = -uy * sign,
      ny = ux * sign;
    const parallel = structural.flatMap((s) => {
      const sx = s.x2 - s.x1,
        sy = s.y2 - s.y1,
        sl = Math.hypot(sx, sy);
      if (sl < 0.001 || Math.abs(ux * sy - uy * sx) > sl * 0.015) return [];
      const offset = (s.x1 - a.x) * nx + (s.y1 - a.y) * ny;
      const start = (s.x1 - a.x) * ux + (s.y1 - a.y) * uy,
        end = (s.x2 - a.x) * ux + (s.y2 - a.y) * uy;
      if (
        offset < 0 ||
        offset > 0.002 ||
        Math.max(start, end) < 0 ||
        Math.min(start, end) > length
      )
        return [];
      return [
        {
          offset,
          start: Math.max(0, Math.min(start, end)),
          end: Math.min(length, Math.max(start, end)),
        },
      ];
    });
    let offset = 0;
    for (const candidate of parallel) {
      const intervals = parallel
        .filter((s) => Math.abs(s.offset - candidate.offset) < 0.00015)
        .sort((a, b) => a.start - b.start);
      let coverage = 0,
        end = 0;
      for (const row of intervals) {
        coverage += Math.max(0, row.end - Math.max(end, row.start));
        end = Math.max(end, row.end);
      }
      const swing = arcs.some((arc) => {
        const mx = (arc.x1 + arc.x2) / 2,
          my = (arc.y1 + arc.y2) / 2;
        const along = (mx - a.x) * ux + (my - a.y) * uy;
        return (
          along >= 0 &&
          along <= length &&
          Math.abs((mx - a.x) * nx + (my - a.y) * ny - candidate.offset) < 0.009
        );
      });
      if (coverage >= length * 0.65 || (coverage >= length * 0.35 && swing))
        offset = Math.max(offset, candidate.offset);
    }
    return {
      a: { x: a.x + nx * offset, y: a.y + ny * offset },
      ux,
      uy,
      length,
    };
  });
  const adjusted: RoomPoint[] = [];
  for (let i = 0; i < lines.length; i++) {
    const previous = lines[(i + lines.length - 1) % lines.length]!,
      next = lines[i]!;
    const cross = previous.ux * next.uy - previous.uy * next.ux;
    if (Math.abs(cross) < 0.01) return shape;
    const dx = next.a.x - previous.a.x,
      dy = next.a.y - previous.a.y;
    const t = (dx * next.uy - dy * next.ux) / cross;
    const p = {
      x: previous.a.x + t * previous.ux,
      y: previous.a.y + t * previous.uy,
    };
    if (Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y) > 0.003)
      return shape;
    // Boundary-inclusive numerical check: adjusted corners cannot grow the room.
    const onBoundary = points.some((a, j) => {
      const b = points[(j + 1) % points.length]!,
        dx = b.x - a.x,
        dy = b.y - a.y;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
        ),
      );
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) < 1e-8;
    });
    if (!pointInPolygon(p, shape) && !onBoundary) return shape;
    if (!adjusted.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 0.00001))
      adjusted.push(p);
  }
  if (adjusted.length < 3) return shape;
  const result = { type: "polygon" as const, points: adjusted };
  return pointInPolygon(seed, result) ? result : shape;
}

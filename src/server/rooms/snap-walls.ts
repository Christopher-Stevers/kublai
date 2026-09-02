import type { RoomPoint, RoomPolygonShape } from "~/lib/room-shape";
import type { WallSegment } from "./pdf-walls";

const SNAP_DIST = 0.03;
const PARALLEL = 0.94;
const MIN_SNAPPED_RATIO = 0.5;

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function polygonArea(points: RoomPoint[]) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

function unit(dx: number, dy: number) {
  const len = Math.hypot(dx, dy) || Number.EPSILON;
  return { x: dx / len, y: dy / len };
}

function distPointLine(
  p: RoomPoint,
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || Number.EPSILON;
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

function intersectLines(
  a1: RoomPoint,
  a2: RoomPoint,
  b1: RoomPoint,
  b2: RoomPoint,
): RoomPoint | null {
  const den =
    (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
  if (Math.abs(den) < 1e-9) return null;
  const t =
    ((a1.x - b1.x) * (b1.y - b2.y) - (a1.y - b1.y) * (b1.x - b2.x)) / den;
  return {
    x: a1.x + t * (a2.x - a1.x),
    y: a1.y + t * (a2.y - a1.y),
  };
}

function projectPointToLine(p: RoomPoint, a: RoomPoint, b: RoomPoint): RoomPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || Number.EPSILON;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  return { x: a.x + dx * t, y: a.y + dy * t };
}

function findWallForEdge(a: RoomPoint, b: RoomPoint, walls: WallSegment[]) {
  const dir = unit(b.x - a.x, b.y - a.y);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let best: WallSegment | null = null;
  let bestDist = SNAP_DIST;
  for (const wall of walls) {
    const wallDir = unit(wall.x2 - wall.x1, wall.y2 - wall.y1);
    const parallel = Math.abs(dir.x * wallDir.x + dir.y * wallDir.y);
    if (parallel < PARALLEL) continue;
    const dist = distPointLine(mid, { x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 });
    if (dist < bestDist) {
      bestDist = dist;
      best = wall;
    }
  }
  return best;
}

function mergeCollinear(points: RoomPoint[]) {
  if (points.length < 4) return points;
  const out: RoomPoint[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[(i + points.length - 1) % points.length]!;
    const cur = points[i]!;
    const next = points[(i + 1) % points.length]!;
    const a = unit(cur.x - prev.x, cur.y - prev.y);
    const b = unit(next.x - cur.x, next.y - cur.y);
    if (Math.abs(a.x * b.x + a.y * b.y) > 0.995) continue;
    out.push(cur);
  }
  return out.length >= 3 ? out : points;
}

export function snapPolygonToWalls(
  points: RoomPoint[],
  walls: WallSegment[],
): RoomPolygonShape | null {
  if (points.length < 3 || walls.length < 12) return null;

  const edges = points.map((point, index) => {
    const next = points[(index + 1) % points.length]!;
    return { a: point, b: next, wall: findWallForEdge(point, next, walls) };
  });
  const snappedCount = edges.filter((edge) => edge.wall).length;
  if (snappedCount / edges.length < MIN_SNAPPED_RATIO) return null;

  const lines = edges.map((edge) => {
    if (!edge.wall) return { a: edge.a, b: edge.b };
    const wallA = { x: edge.wall.x1, y: edge.wall.y1 };
    const wallB = { x: edge.wall.x2, y: edge.wall.y2 };
    return {
      a: projectPointToLine(edge.a, wallA, wallB),
      b: projectPointToLine(edge.b, wallA, wallB),
    };
  });

  const snapped: RoomPoint[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const prev = lines[(i + lines.length - 1) % lines.length]!;
    const cur = lines[i]!;
    const hit = intersectLines(prev.a, prev.b, cur.a, cur.b);
    if (hit && hit.x >= -0.05 && hit.x <= 1.05 && hit.y >= -0.05 && hit.y <= 1.05) {
      snapped.push({ x: clamp01(hit.x), y: clamp01(hit.y) });
      continue;
    }
    snapped.push({
      x: clamp01(cur.a.x),
      y: clamp01(cur.a.y),
    });
  }

  const unique = snapped.filter((point, index) => {
    const prev = snapped[(index + snapped.length - 1) % snapped.length]!;
    return Math.hypot(point.x - prev.x, point.y - prev.y) > 0.002;
  });
  const merged = mergeCollinear(unique);
  if (merged.length < 3) return null;

  const originalArea = polygonArea(points);
  const snappedArea = polygonArea(merged);
  if (snappedArea < 0.00005 || snappedArea > 0.45) return null;
  if (originalArea > 0 && (snappedArea < originalArea * 0.4 || snappedArea > originalArea * 2.2)) {
    return null;
  }

  return { type: "polygon", points: merged.slice(0, 40) };
}

export type RoomPoint = { x: number; y: number };

export type RoomBBoxShape = {
  type: "bbox";
  x: number;
  y: number;
  w: number;
  h: number;
};

export type RoomPolygonShape = {
  type: "polygon";
  points: RoomPoint[];
};

export type RoomShape = RoomBBoxShape | RoomPolygonShape;

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function toPolygon(
  shape: RoomShape | null | undefined,
): RoomPolygonShape {
  if (
    shape &&
    shape.type === "polygon" &&
    Array.isArray(shape.points) &&
    shape.points.length >= 3
  ) {
    return {
      type: "polygon",
      points: shape.points.map((point) => ({
        x: clamp01(point.x),
        y: clamp01(point.y),
      })),
    };
  }

  if (shape && shape.type === "bbox") {
    const x = clamp01(shape.x);
    const y = clamp01(shape.y);
    const w = Math.max(0.005, shape.w);
    const h = Math.max(0.005, shape.h);
    return {
      type: "polygon",
      points: [
        { x, y },
        { x: clamp01(x + w), y },
        { x: clamp01(x + w), y: clamp01(y + h) },
        { x, y: clamp01(y + h) },
      ],
    };
  }

  return {
    type: "polygon",
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.4, y: 0.2 },
      { x: 0.4, y: 0.4 },
      { x: 0.2, y: 0.4 },
    ],
  };
}

export function polygonPointsAttr(shape: RoomPolygonShape) {
  return shape.points.map((point) => `${point.x},${point.y}`).join(" ");
}

export function pointInPolygon(point: RoomPoint, polygon: RoomPolygonShape) {
  let inside = false;
  const pts = polygon.points;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const a = pts[i]!;
    const b = pts[j]!;
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x <
        ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y + Number.EPSILON) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonArea(shape: RoomPolygonShape) {
  let area = 0;
  for (let index = 0; index < shape.points.length; index += 1) {
    const current = shape.points[index]!;
    const next = shape.points[(index + 1) % shape.points.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area) / 2;
}

/**
 * Resolve overlay hits from normalized plan coordinates instead of relying on
 * browser SVG hit-testing. When traces overlap, the tightest containing room
 * wins, which keeps a large suite polygon from swallowing its smaller rooms.
 */
export function findRoomAtPoint<T extends { shape: RoomShape }>(
  rooms: T[],
  point: RoomPoint,
): T | null {
  return (
    rooms
      .flatMap((room) => {
        const polygon = toPolygon(room.shape);
        return pointInPolygon(point, polygon)
          ? [{ room, area: polygonArea(polygon) }]
          : [];
      })
      .sort((left, right) => left.area - right.area)[0]?.room ?? null
  );
}

export function insertPointOnNearestEdge(
  polygon: RoomPolygonShape,
  point: RoomPoint,
  threshold = 0.04,
): RoomPolygonShape {
  let bestIndex = -1;
  let bestDist = threshold;
  let bestPoint = point;

  for (let i = 0; i < polygon.points.length; i += 1) {
    const a = polygon.points[i]!;
    const b = polygon.points[(i + 1) % polygon.points.length]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const length2 = abx * abx + aby * aby || Number.EPSILON;
    const t = Math.min(
      1,
      Math.max(0, ((point.x - a.x) * abx + (point.y - a.y) * aby) / length2),
    );
    const proj = { x: a.x + abx * t, y: a.y + aby * t };
    const dist = Math.hypot(point.x - proj.x, point.y - proj.y);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i + 1;
      bestPoint = proj;
    }
  }

  if (bestIndex < 0) return polygon;
  const points = [...polygon.points];
  points.splice(bestIndex, 0, {
    x: clamp01(bestPoint.x),
    y: clamp01(bestPoint.y),
  });
  return { type: "polygon", points };
}

export function insertPointAtClick(
  polygon: RoomPolygonShape,
  point: RoomPoint,
): RoomPolygonShape {
  let bestIndex = 0;
  let bestDist = Number.POSITIVE_INFINITY;

  for (let i = 0; i < polygon.points.length; i += 1) {
    const a = polygon.points[i]!;
    const b = polygon.points[(i + 1) % polygon.points.length]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const length2 = abx * abx + aby * aby || Number.EPSILON;
    const t = Math.min(
      1,
      Math.max(0, ((point.x - a.x) * abx + (point.y - a.y) * aby) / length2),
    );
    const proj = { x: a.x + abx * t, y: a.y + aby * t };
    const dist = Math.hypot(point.x - proj.x, point.y - proj.y);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i + 1;
    }
  }

  const points = [...polygon.points];
  points.splice(bestIndex, 0, {
    x: clamp01(point.x),
    y: clamp01(point.y),
  });
  return { type: "polygon", points };
}

export function removePolygonPoint(
  polygon: RoomPolygonShape,
  index: number,
): RoomPolygonShape {
  if (polygon.points.length <= 3) return polygon;
  return {
    type: "polygon",
    points: polygon.points.filter((_, i) => i !== index),
  };
}

export function movePolygonPoint(
  polygon: RoomPolygonShape,
  index: number,
  point: RoomPoint,
): RoomPolygonShape {
  return {
    type: "polygon",
    points: polygon.points.map((existing, i) =>
      i === index ? { x: clamp01(point.x), y: clamp01(point.y) } : existing,
    ),
  };
}

export function bboxToPolygonShape(
  x: number,
  y: number,
  w: number,
  h: number,
): RoomPolygonShape {
  return toPolygon({ type: "bbox", x, y, w, h });
}

export function shapeBBox(shape: RoomShape | null | undefined): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const polygon = toPolygon(shape);
  const xs = polygon.points.map((point) => point.x);
  const ys = polygon.points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    w: Math.max(0.01, Math.max(...xs) - x),
    h: Math.max(0.01, Math.max(...ys) - y),
  };
}

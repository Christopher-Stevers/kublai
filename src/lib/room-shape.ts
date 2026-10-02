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
  holes?: RoomPoint[][];
};

export type RoomShape = RoomBBoxShape | RoomPolygonShape;

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function toPolygon(
  shape: RoomShape | null | undefined,
): RoomPolygonShape {
  if (
    shape?.type === "polygon" &&
    Array.isArray(shape.points) &&
    shape.points.length >= 3
  ) {
    return {
      type: "polygon",
      points: shape.points.map((point) => ({
        x: clamp01(point.x),
        y: clamp01(point.y),
      })),
      ...(shape.holes?.length
        ? {
            holes: shape.holes.map((ring) =>
              ring.map((point) => ({
                x: clamp01(point.x),
                y: clamp01(point.y),
              })),
            ),
          }
        : {}),
    };
  }

  if (shape?.type === "bbox") {
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

function pointInRing(point: RoomPoint, pts: RoomPoint[]) {
  let inside = false;
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

export function pointInPolygon(point: RoomPoint, polygon: RoomPolygonShape) {
  return (
    pointInRing(point, polygon.points) &&
    !(polygon.holes ?? []).some((ring) => pointInRing(point, ring))
  );
}

export function polygonPathAttr(shape: RoomPolygonShape) {
  return [shape.points, ...(shape.holes ?? [])]
    .map((ring) => `M${ring.map((p) => `${p.x},${p.y}`).join("L")}Z`)
    .join(" ");
}

function polygonArea(shape: RoomPolygonShape) {
  const ringArea = (points: RoomPoint[]) => {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!,
        b = points[(i + 1) % points.length]!;
      area += a.x * b.y - b.x * a.y;
    }
    return Math.abs(area) / 2;
  };
  return Math.max(
    0,
    ringArea(shape.points) -
      (shape.holes ?? []).reduce((area, hole) => area + ringArea(hole), 0),
  );
}

/** Keep room labels inside usable space, including concave halls with holes. */
export function roomLabelPoint(shape: RoomPolygonShape): RoomPoint {
  const box = shapeBBox(shape),
    center = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  if (pointInPolygon(center, shape)) return center;
  // Only the fallback searches; regular rooms use their center directly.
  let best: RoomPoint | undefined,
    bestDistance = Infinity;
  for (let y = 1; y < 20; y++)
    for (let x = 1; x < 20; x++) {
      const p = { x: box.x + (box.w * x) / 20, y: box.y + (box.h * y) / 20 };
      if (!pointInPolygon(p, shape)) continue;
      const distance = (p.x - center.x) ** 2 + (p.y - center.y) ** 2;
      if (distance < bestDistance) {
        best = p;
        bestDistance = distance;
      }
    }
  if (best) return best;
  // Very narrow concave halls can fall between every grid sample. A scanline
  // between vertex heights gives interior intervals without returning a wall
  // vertex (which is an invalid starting point for room tracing).
  const rings = [shape.points, ...(shape.holes ?? [])];
  const heights = [
    ...new Set(rings.flatMap((ring) => ring.map((p) => p.y))),
  ].sort((a, b) => a - b);
  const level = heights.findIndex((y) => y >= center.y);
  const low = heights[Math.max(0, level - 1)];
  const high = heights[Math.max(1, level)];
  if (low !== undefined && high !== undefined && high > low) {
    const y = (low + high) / 2;
    const crossings: number[] = [];
    for (const ring of rings)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!,
          b = ring[(i + 1) % ring.length]!;
        if (a.y > y !== b.y > y)
          crossings.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    crossings.sort((a, b) => a - b);
    let widest = 0;
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const left = crossings[i]!,
        right = crossings[i + 1]!;
      const point = { x: (left + right) / 2, y };
      if (right - left > widest && pointInPolygon(point, shape)) {
        widest = right - left;
        best = point;
      }
    }
  }
  return best ?? shape.points[0] ?? center;
}

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
  return { ...polygon, type: "polygon", points };
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
  return { ...polygon, type: "polygon", points };
}

export function removePolygonPoint(
  polygon: RoomPolygonShape,
  index: number,
): RoomPolygonShape {
  if (polygon.points.length <= 3) return polygon;
  return {
    ...polygon,
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
    ...polygon,
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

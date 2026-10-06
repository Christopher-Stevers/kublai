import type { SheetPoint } from "./sheet-measure";

/** A straight line on the sheet. x is a fraction of the width, y of the height. */
export type SnapSegment = { x1: number; y1: number; x2: number; y2: number };

export type SnapHit = {
  point: SheetPoint;
  segment: SnapSegment;
  /** Distance in sheet-widths, with height scaled by the sheet's aspect. */
  distance: number;
};

export type SnapIndex = {
  segments: SnapSegment[];
  aspect: number;
  buckets: Map<string, number[]>;
};

/** Lines closer than this, in sheet-widths, are the same line (the dashes of one grid). */
const OFFSET_STEP = 0.0015;
/** Leftover scraps shorter than this are letter strokes, not something to snap to. */
const MIN_LENGTH = 0.008;
const MAX_LINES = 4000;
const CELL = 0.025;

function usable(segment: SnapSegment) {
  const values = [segment.x1, segment.y1, segment.x2, segment.y2];
  if (!values.every(Number.isFinite)) return false;
  if (
    Math.max(
      Math.abs(segment.x2 - segment.x1),
      Math.abs(segment.y2 - segment.y1),
    ) > 2
  )
    return false;
  return (
    Math.max(segment.x1, segment.x2) >= -0.05 &&
    Math.min(segment.x1, segment.x2) <= 1.05 &&
    Math.max(segment.y1, segment.y2) >= -0.05 &&
    Math.min(segment.y1, segment.y2) <= 1.05
  );
}

function isoLength(segment: SnapSegment, aspect: number) {
  return Math.hypot(
    segment.x2 - segment.x1,
    (segment.y2 - segment.y1) * aspect,
  );
}

/** Undirected orientation, in degrees, wrapped so 0° and 180° are the same line. */
function orientationBucket(dx: number, dy: number) {
  let angle = Math.atan2(dy, dx);
  if (angle < 0) angle += Math.PI;
  if (angle >= Math.PI) angle -= Math.PI;
  let bucket = Math.round((angle * 180) / Math.PI);
  if (bucket >= 180 || bucket < 0) bucket = 0;
  return bucket;
}

function groupKey(segment: SnapSegment, aspect: number) {
  const dx = segment.x2 - segment.x1;
  const dy = (segment.y2 - segment.y1) * aspect;
  const bucket = orientationBucket(dx, dy);
  const theta = (bucket * Math.PI) / 180;
  const mx = (segment.x1 + segment.x2) / 2;
  const my = ((segment.y1 + segment.y2) / 2) * aspect;
  const offset = mx * -Math.sin(theta) + my * Math.cos(theta);
  return `${bucket}:${Math.round(offset / OFFSET_STEP)}`;
}

function mergeGroup(parts: SnapSegment[], aspect: number): SnapSegment | null {
  const only = parts[0];
  if (!only) return null;
  if (parts.length === 1)
    return isoLength(only, aspect) >= MIN_LENGTH ? only : null;

  let sx = 0;
  let sy = 0;
  for (const segment of parts) {
    let dx = segment.x2 - segment.x1;
    let dy = (segment.y2 - segment.y1) * aspect;
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) continue;
    dx /= len;
    dy /= len;
    if ((sx !== 0 || sy !== 0) && dx * sx + dy * sy < 0) {
      dx = -dx;
      dy = -dy;
    }
    sx += dx;
    sy += dy;
  }
  const len = Math.hypot(sx, sy);
  if (!(len > 0)) return null;
  const ux = sx / len;
  const uy = sy / len;
  const nx = -uy;
  const ny = ux;
  let offsetSum = 0;
  let count = 0;
  let minT = Infinity;
  let maxT = -Infinity;
  for (const segment of parts) {
    for (const [x, yRaw] of [
      [segment.x1, segment.y1],
      [segment.x2, segment.y2],
    ] as const) {
      const y = yRaw * aspect;
      const t = x * ux + y * uy;
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
      offsetSum += x * nx + y * ny;
      count += 1;
    }
  }
  if (!(count > 0) || maxT - minT < MIN_LENGTH) return null;
  const offset = offsetSum / count;
  return {
    x1: nx * offset + ux * minT,
    y1: (ny * offset + uy * minT) / aspect,
    x2: nx * offset + ux * maxT,
    y2: (ny * offset + uy * maxT) / aspect,
  };
}

/**
 * Joins the dashes of one grid into a single line, so a snap lands in the gap
 * as well as on a dash. A line that is already continuous is left as it was drawn.
 */
export function mergeCollinear(
  segments: SnapSegment[],
  aspect: number,
): SnapSegment[] {
  if (!(aspect > 0)) return [];
  const groups = new Map<string, SnapSegment[]>();
  for (const segment of segments) {
    if (!usable(segment) || !(isoLength(segment, aspect) > 0)) continue;
    const key = groupKey(segment, aspect);
    const group = groups.get(key);
    if (group) group.push(segment);
    else groups.set(key, [segment]);
  }
  const merged: SnapSegment[] = [];
  for (const parts of groups.values()) {
    const line = mergeGroup(parts, aspect);
    if (line) merged.push(line);
  }
  merged.sort((a, b) => isoLength(b, aspect) - isoLength(a, aspect));
  if (merged.length > MAX_LINES) merged.length = MAX_LINES;
  return merged;
}

function forEachCell(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit: (ix: number, iy: number) => void,
) {
  const scale = 1 / CELL;
  let ix = Math.floor(x0 * scale);
  let iy = Math.floor(y0 * scale);
  const ixEnd = Math.floor(x1 * scale);
  const iyEnd = Math.floor(y1 * scale);
  visit(ix, iy);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  if (sx === 0 && sy === 0) return;
  const tDeltaX = sx === 0 ? Infinity : Math.abs(CELL / dx);
  const tDeltaY = sy === 0 ? Infinity : Math.abs(CELL / dy);
  const nextX = sx > 0 ? (ix + 1) * CELL : ix * CELL;
  const nextY = sy > 0 ? (iy + 1) * CELL : iy * CELL;
  let tMaxX = sx === 0 ? Infinity : Math.abs((nextX - x0) / dx);
  let tMaxY = sy === 0 ? Infinity : Math.abs((nextY - y0) / dy);
  const maxSteps = Math.abs(ixEnd - ix) + Math.abs(iyEnd - iy) + 2;
  for (let n = 0; n < maxSteps && (ix !== ixEnd || iy !== iyEnd); n += 1) {
    if (tMaxX < tMaxY) {
      ix += sx;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxX) {
      iy += sy;
      tMaxY += tDeltaY;
    } else {
      ix += sx;
      iy += sy;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    }
    visit(ix, iy);
  }
}

export function buildSnapIndex(
  segments: SnapSegment[],
  aspect: number,
): SnapIndex {
  const buckets = new Map<string, number[]>();
  const kept = segments.filter(usable);
  if (aspect > 0) {
    for (let i = 0; i < kept.length; i += 1) {
      const segment = kept[i]!;
      forEachCell(
        segment.x1,
        segment.y1 * aspect,
        segment.x2,
        segment.y2 * aspect,
        (ix, iy) => {
          const key = `${ix},${iy}`;
          const list = buckets.get(key);
          if (list) list.push(i);
          else buckets.set(key, [i]);
        },
      );
    }
  }
  return { segments: kept, aspect, buckets };
}

function project(point: SheetPoint, segment: SnapSegment, aspect: number) {
  const px = point.x;
  const py = point.y * aspect;
  const ax = segment.x1;
  const ay = segment.y1 * aspect;
  const dx = segment.x2 - ax;
  const dy = segment.y2 * aspect - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const x = ax + t * dx;
  const y = ay + t * dy;
  return {
    point: { x, y: aspect > 0 ? y / aspect : point.y },
    distance: Math.hypot(px - x, py - y),
  };
}

/**
 * Nearest point on a line, within `maxDistance` sheet-widths.
 * `maxDistance` is `snapPixels / shownSheetWidth`, the same scale as `sheetWidths`.
 * When `prefer` is still within reach, the point stays on that line.
 */
export function snapToLine(
  point: SheetPoint,
  index: SnapIndex,
  maxDistance: number,
  prefer?: SnapSegment | null,
): SnapHit | null {
  if (!(maxDistance > 0) || !(index.aspect > 0)) return null;
  if (prefer) {
    const hit = project(point, prefer, index.aspect);
    if (hit.distance <= maxDistance) return { ...hit, segment: prefer };
  }
  const scale = 1 / CELL;
  const ix = Math.floor(point.x * scale);
  const iy = Math.floor(point.y * index.aspect * scale);
  const reach = Math.max(1, Math.ceil(maxDistance * scale));
  let best: SnapHit | null = null;
  let bestLength = -1;
  const seen = new Set<number>();
  for (let dx = -reach; dx <= reach; dx += 1) {
    for (let dy = -reach; dy <= reach; dy += 1) {
      const list = index.buckets.get(`${ix + dx},${iy + dy}`);
      if (!list) continue;
      for (const id of list) {
        if (seen.has(id)) continue;
        seen.add(id);
        const segment = index.segments[id];
        if (!segment) continue;
        const hit = project(point, segment, index.aspect);
        if (hit.distance > maxDistance) continue;
        const length = isoLength(segment, index.aspect);
        const closer = best === null || hit.distance < best.distance - 1e-9;
        const tie =
          best !== null &&
          Math.abs(hit.distance - best.distance) <= 1e-9 &&
          length > bestLength;
        if (closer || tie) {
          best = { ...hit, segment };
          bestLength = length;
        }
      }
    }
  }
  return best;
}

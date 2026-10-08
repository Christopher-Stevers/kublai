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

/** Coarse lookup buckets only; never use these to decide two lines coincide. */
const OFFSET_STEP = 0.0015;
/** Only allow coordinate roundoff within one millionth of the sheet width. */
const COLLINEAR_TOLERANCE = 1e-6;
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
  let theta = Math.atan2(dy, dx);
  if (theta < 0) theta += Math.PI;
  if (theta >= Math.PI) theta -= Math.PI;
  const mx = (segment.x1 + segment.x2) / 2;
  const my = ((segment.y1 + segment.y2) / 2) * aspect;
  const offset = mx * -Math.sin(theta) + my * Math.cos(theta);
  return { angle: bucket, offset: Math.round(Math.abs(offset) / OFFSET_STEP) };
}

function collinear(a: SnapSegment, b: SnapSegment, aspect: number) {
  const dx = a.x2 - a.x1, dy = (a.y2 - a.y1) * aspect;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return false;
  const distance = (x: number, y: number) =>
    Math.abs((x - a.x1) * dy - (y - a.y1) * aspect * dx) / length;
  return distance(b.x1, b.y1) <= COLLINEAR_TOLERANCE &&
    distance(b.x2, b.y2) <= COLLINEAR_TOLERANCE;
}

function mergeGroup(parts: SnapSegment[], aspect: number): SnapSegment | null {
  // The longest source segment is the exact supporting line. Averaging nearby
  // walls or grid dashes creates a guide that is not present in the drawing.
  const source = parts[0];
  if (!source) return null;
  const length = isoLength(source, aspect);
  const ux = (source.x2 - source.x1) / length;
  const uy = (source.y2 - source.y1) * aspect / length;
  let minT = 0, maxT = length;
  for (const part of parts) {
    for (const [x, y] of [[part.x1, part.y1], [part.x2, part.y2]]) {
      const t = (x! - source.x1) * ux + (y! - source.y1) * aspect * uy;
      minT = Math.min(minT, t);
      maxT = Math.max(maxT, t);
    }
  }
  if (maxT - minT < MIN_LENGTH) return null;
  if (minT === 0 && maxT === length) return source;
  return {
    x1: source.x1 + ux * minT,
    y1: source.y1 + uy * minT / aspect,
    x2: source.x1 + ux * maxT,
    y2: source.y1 + uy * maxT / aspect,
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
  const groups = new Map<string, SnapSegment[][]>();
  const usableLines = segments.filter((segment) => usable(segment) && isoLength(segment, aspect) > 0);
  usableLines.sort((a, b) => isoLength(b, aspect) - isoLength(a, aspect));
  for (const segment of usableLines) {
    const cell = groupKey(segment, aspect);
    const key = `${cell.angle}:${cell.offset}`;
    const candidates = groups.get(key);
    let group = candidates?.find((parts) => collinear(parts[0]!, segment, aspect));
    // Rounding can put identical rotated dashes on either side of a bucket
    // boundary. Lookup neighbors, but still require exact collinearity.
    if (!group) {
      for (let angle = -1; angle <= 1 && !group; angle++) {
        for (let offset = -1; offset <= 1 && !group; offset++) {
          if (angle === 0 && offset === 0) continue;
          const nearby = groups.get(`${(cell.angle + angle + 180) % 180}:${cell.offset + offset}`);
          group = nearby?.find((parts) => collinear(parts[0]!, segment, aspect));
        }
      }
    }
    if (group) group.push(segment);
    else if (candidates) candidates.push([segment]);
    else groups.set(key, [[segment]]);
  }
  const merged: SnapSegment[] = [];
  for (const candidates of groups.values()) {
    for (const parts of candidates) {
      const line = mergeGroup(parts, aspect);
      if (line) merged.push(line);
    }
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
 * A preferred line stays selected only if it is within `preferSlack` of the
 * nearest target; it must not pull a precise placement onto a neighboring wall.
 */
export function snapToLine(
  point: SheetPoint,
  index: SnapIndex,
  maxDistance: number,
  prefer?: SnapSegment | null,
  preferSlack = maxDistance,
): SnapHit | null {
  if (!(maxDistance > 0) || !(index.aspect > 0)) return null;
  const preferred = prefer ? { ...project(point, prefer, index.aspect), segment: prefer } : null;
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
  if (preferred && preferred.distance <= maxDistance &&
      (best === null || preferred.distance <= best.distance + preferSlack)) return preferred;
  return best;
}

import type { WallSegment } from "./pdf-walls";

/**
 * Turns raw drawing strokes into graded wall linework. Every stage works in
 * normalized page coordinates (0–1) so PDF vectors, DXF entities and raster
 * runs all flow through the same code.
 *
 * 1. group: quantize each stroke into an angle bucket + perpendicular offset,
 *    merge overlapping intervals on the same line
 * 2. grade: a line is a *strong* wall when the drawing says so in any of the
 *    ways drawings do — it sits on a wall layer, it is drawn heavier than the
 *    sheet's typical stroke, or it has a parallel partner a plausible wall
 *    thickness away (pairs collapse to their centerline). Everything else is
 *    kept as a *weak* line: fixtures, counters, tile, symbols. Weak lines
 *    still split faces, but rooms may grow across them.
 * 3. bridge: close doorway-sized gaps in a line and remember the bridges so
 *    faces on either side can later be joined through them
 */

export const GRID = 0.0005;
export const ANGLE_STEP = Math.PI / 1800;
export const MAX_DOOR_GAP = 0.024;
/** Widest wall gap bridged when a door swing is drawn across it (double doors). */
export const MAX_SWING_GAP = 0.04;
/** Widest bridged gap in a strong wall that still reads as a doorway. */
export const MAX_DOOR_WIDTH = 0.016;
export const CORNER_EXTENSION = 0.001;

/** Longest gap between two parallel lines still considered one wall. */
const MAX_PAIR_GAP = 0.02;
/** Interior walls pair up to this multiple of the estimated thickness; anything
 * wider (counters, tubs, exterior wall bands) is not a partition. */
const MAX_THICKNESS_MULTIPLE = 3.5;
const MIN_MAX_PAIR_GAP = 0.003;
/** Two parallel lines must run side by side at least this far to pair. */
const MIN_PAIR_OVERLAP = 0.006;
const THICKNESS_BUCKET = 0.00025;
/** A stroke this many times heavier than the sheet's typical stroke is a wall. */
const HEAVY_STROKE_RATIO = 2.5;
/** Grid lines: runs of short dashes spanning a large part of the sheet. */
const GRID_LINE_EXTENT = 0.25;
const GRID_DASH_MAX = 0.03;
const GRID_DASH_COUNT = 5;
const GRID_DASH_SHARE = 0.7;
const GRID_MAX_COVERAGE = 0.65;
const GRID_PITCH_TOLERANCE = 0.25;
const WALL_LAYER = /wall|partition|w-?wall|a-?wall/i;

export type Interval = { start: number; end: number };
export type DirectionalLine = {
  angleIndex: number;
  ux: number;
  uy: number;
  nx: number;
  ny: number;
  offset: number;
  intervals: Interval[];
  /** Stretches drawn with a heavy stroke or on a wall layer. */
  wallIntervals: Interval[];
  /** Perpendicular distance between the two faces this line was paired from. */
  thickness?: number;
  strong: boolean;
};
export type LineSegment = [[number, number], [number, number]];
export type Bridge = {
  segment: LineSegment;
  length: number;
  /** Bridged gap in a strong wall (a doorway when short enough). */
  strong: boolean;
};
export type WallLinework = {
  /** Every segment fed to the polygonizer, bridges included. */
  lines: LineSegment[];
  /** Segments rooms must not grow across: strong walls and wide openings. */
  strong: LineSegment[];
  /** Door-sized bridged gaps in strong walls. */
  doors: LineSegment[];
  bridges: Bridge[];
  wallThickness: number;
  referenceStroke: number;
  mode: "graded" | "all";
  stats: {
    grouped: number;
    /** Double-line walls collapsed to centerlines. */
    paired: number;
    /** Lines kept strong from stroke weight or layer name. */
    strong: number;
    weak: number;
    gridLines: number;
    /** Weak stretches dropped for running straight through a strong wall. */
    annotations: number;
    /** Total drawn length with heavy stroke / wall-layer evidence. */
    heavyLength: number;
    layerLength: number;
  };
};

export function quantize(value: number) {
  return Math.round(value / GRID) * GRID;
}

export function toDirectionalWall(wall: WallSegment) {
  if (wall.dashed || wall.curve) return null;
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  if (Math.hypot(dx, dy) < GRID * 2) return null;
  let angle = Math.atan2(dy, dx);
  while (angle < 0) angle += Math.PI;
  while (angle >= Math.PI) angle -= Math.PI;
  const bucketCount = Math.round(Math.PI / ANGLE_STEP);
  const angleIndex = Math.round(angle / ANGLE_STEP) % bucketCount;
  const bucketAngle = angleIndex * ANGLE_STEP;
  const ux = Math.cos(bucketAngle);
  const uy = Math.sin(bucketAngle);
  const nx = -uy;
  const ny = ux;
  const project = (x: number, y: number) => x * ux + y * uy;
  const offset = quantize(
    ((wall.x1 + wall.x2) / 2) * nx + ((wall.y1 + wall.y2) / 2) * ny,
  );
  const start = quantize(
    Math.min(project(wall.x1, wall.y1), project(wall.x2, wall.y2)),
  );
  const end = quantize(
    Math.max(project(wall.x1, wall.y1), project(wall.x2, wall.y2)),
  );
  if (end - start < GRID * 2) return null;
  return { angleIndex, ux, uy, nx, ny, offset, start, end };
}

/**
 * Pieces of one wall face often land one grid step apart after quantization
 * (CAD double-line walls are rarely a clean multiple of GRID). Fold adjacent
 * offsets together so doorway bridging sees them as the same line.
 */
export function mergeAdjacentOffsets(groups: Map<string, DirectionalLine>) {
  const byAngle = new Map<number, DirectionalLine[]>();
  for (const group of groups.values()) {
    const list = byAngle.get(group.angleIndex) ?? [];
    list.push(group);
    byAngle.set(group.angleIndex, list);
  }
  const merged: DirectionalLine[] = [];
  for (const list of byAngle.values()) {
    list.sort((left, right) => left.offset - right.offset);
    let current = list[0]!;
    let clusterStart = current.offset;
    for (let i = 1; i < list.length; i += 1) {
      const next = list[i]!;
      const adjacent =
        next.offset - current.offset <= GRID * 1.5 &&
        next.offset - clusterStart <= GRID * 2.5;
      if (adjacent) {
        current.intervals.push(...next.intervals);
        current.wallIntervals.push(...next.wallIntervals);
      } else {
        merged.push(current);
        current = next;
        clusterStart = next.offset;
      }
    }
    merged.push(current);
  }
  return merged;
}

function mergeIntervals(intervals: Interval[], maxGap: number) {
  const sorted = [...intervals].sort((left, right) => left.start - right.start);
  const out: Interval[] = [];
  let current = { ...sorted[0]! };
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i]!;
    if (next.start <= current.end + maxGap) {
      current.end = Math.max(current.end, next.end);
    } else {
      out.push(current);
      current = { ...next };
    }
  }
  out.push(current);
  return out;
}

/** Length-weighted median stroke width: the sheet's "ordinary" line. */
export function referenceStrokeWidth(walls: WallSegment[]) {
  const rows = walls
    .map((wall) => ({
      width: wall.strokeWidth,
      length: Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1),
    }))
    .sort((left, right) => left.width - right.width);
  const total = rows.reduce((sum, row) => sum + row.length, 0);
  let acc = 0;
  for (const row of rows) {
    acc += row.length;
    if (acc >= total / 2) return row.width;
  }
  return rows[rows.length - 1]?.width ?? 0;
}

function lineLength(line: DirectionalLine) {
  return line.intervals.reduce((sum, item) => sum + (item.end - item.start), 0);
}

function lineExtent(line: DirectionalLine) {
  return (
    Math.max(...line.intervals.map((item) => item.end)) -
    Math.min(...line.intervals.map((item) => item.start))
  );
}

/**
 * Some PDF generators flatten a dashed grid into separate solid strokes. A
 * dash that happens to cross a wall/dimension is still part of the grid, so
 * classifying pieces independently lets those intersections survive and the
 * gap bridge later sews them back into a fake wall. Recognize the repeated
 * cadence of the whole sparse through-line instead.
 */
function hasGridCadence(line: DirectionalLine) {
  const intervals = [...line.intervals].sort(
    (left, right) => left.start - right.start,
  );
  const extent = lineExtent(line);
  if (extent < GRID_LINE_EXTENT || intervals.length < GRID_DASH_COUNT) {
    return false;
  }
  const short = intervals.filter(
    (item) => item.end - item.start <= GRID_DASH_MAX,
  );
  if (short.length / intervals.length < GRID_DASH_SHARE) return false;
  const covered = intervals.reduce(
    (sum, item) => sum + (item.end - item.start),
    0,
  );
  if (covered / extent > GRID_MAX_COVERAGE) return false;

  const centers = short.map((item) => (item.start + item.end) / 2);
  const pitches = centers
    .slice(1)
    .map((center, index) => center - centers[index]!)
    .filter((pitch) => pitch >= GRID * 2)
    .sort((left, right) => left - right);
  if (pitches.length < GRID_DASH_COUNT - 2) return false;
  const pitch = pitches[Math.floor(pitches.length / 2)]!;
  const tolerance = Math.max(GRID * 2, pitch * GRID_PITCH_TOLERANCE);
  const regular = pitches.filter((candidate) => {
    // A wall crossing may swallow one or two dashes, leaving a 2x/3x pitch.
    const multiple = Math.max(1, Math.round(candidate / pitch));
    return multiple <= 3 && Math.abs(candidate - pitch * multiple) <= tolerance;
  }).length;
  return regular >= Math.max(3, Math.ceil(pitches.length * 0.6));
}

/** Stage 1: quantized, merged lines with heavy-stroke and layer evidence. */
export function groupLines(walls: WallSegment[]) {
  const reference = referenceStrokeWidth(walls);
  const heavyWidth = reference * HEAVY_STROKE_RATIO;
  const groups = new Map<string, DirectionalLine>();
  let heavyLength = 0;
  let layerLength = 0;
  for (const wall of walls) {
    const directional = toDirectionalWall(wall);
    if (!directional) continue;
    const key = `${directional.angleIndex}:${directional.offset.toFixed(4)}`;
    const group = groups.get(key) ?? {
      angleIndex: directional.angleIndex,
      ux: directional.ux,
      uy: directional.uy,
      nx: directional.nx,
      ny: directional.ny,
      offset: directional.offset,
      intervals: [],
      wallIntervals: [],
      strong: false,
    };
    const interval = { start: directional.start, end: directional.end };
    group.intervals.push(interval);
    const heavy =
      Boolean(wall.filled) || (reference > 0 && wall.strokeWidth >= heavyWidth);
    const layered = Boolean(wall.layer && WALL_LAYER.test(wall.layer));
    if (heavy) heavyLength += interval.end - interval.start;
    if (layered) layerLength += interval.end - interval.start;
    if (heavy || layered) group.wallIntervals.push(interval);
    groups.set(key, group);
  }
  const merged = mergeAdjacentOffsets(groups).map((line) => ({
    ...line,
    intervals: mergeIntervals(line.intervals, 0),
    wallIntervals: line.wallIntervals.length
      ? mergeIntervals(line.wallIntervals, 0)
      : [],
  }));
  let gridLines = 0;
  const lines = merged
    .map((line) => {
      if (hasGridCadence(line)) {
        gridLines += 1;
        return null;
      }
      // Column grid lines are long rows of short, free-floating dashes. Strip
      // the dashes but keep wall pieces (they end on jambs) on the same line.
      if (lineExtent(line) < GRID_LINE_EXTENT) return line;
      const dashes = line.intervals.filter(
        (item) =>
          item.end - item.start <= GRID_DASH_MAX &&
          !meetsCrossingLine(line, item.start, -1, merged, GRID * 3) &&
          !meetsCrossingLine(line, item.end, 1, merged, GRID * 3),
      );
      if (dashes.length < GRID_DASH_COUNT) return line;
      gridLines += 1;
      return {
        ...line,
        intervals: line.intervals.filter((item) => !dashes.includes(item)),
      };
    })
    .filter((line): line is DirectionalLine => Boolean(line?.intervals.length));
  return {
    lines,
    referenceStroke: reference,
    gridLines,
    evidence: { heavy: heavyLength, layered: layerLength },
  };
}

type PairCandidate = {
  low: DirectionalLine;
  high: DirectionalLine;
  gap: number;
  overlaps: Interval[];
};

function overlapIntervals(a: Interval[], b: Interval[]) {
  const out: Interval[] = [];
  for (const left of a) {
    for (const right of b) {
      const start = Math.max(left.start, right.start);
      const end = Math.min(left.end, right.end);
      if (end - start >= MIN_PAIR_OVERLAP) out.push({ start, end });
    }
  }
  return out;
}

function findPairCandidates(lines: DirectionalLine[]) {
  const byAngle = new Map<number, DirectionalLine[]>();
  for (const line of lines) {
    const list = byAngle.get(line.angleIndex) ?? [];
    list.push(line);
    byAngle.set(line.angleIndex, list);
  }
  const candidates: PairCandidate[] = [];
  for (const list of byAngle.values()) {
    list.sort((left, right) => left.offset - right.offset);
    for (let i = 0; i < list.length; i += 1) {
      const low = list[i]!;
      for (let j = i + 1; j < list.length; j += 1) {
        const high = list[j]!;
        const gap = high.offset - low.offset;
        if (gap > MAX_PAIR_GAP) break;
        if (gap < GRID * 1.5) continue;
        const overlaps = overlapIntervals(low.intervals, high.intervals);
        if (overlaps.length) candidates.push({ low, high, gap, overlaps });
      }
    }
  }
  return candidates;
}

/**
 * The most common nearest-parallel gap on a floor plan is the interior
 * partition thickness. Weight by overlap length so long walls dominate over
 * furniture and fixture outlines.
 */
export function estimateWallThickness(candidates: PairCandidate[]) {
  const nearest = new Map<DirectionalLine, PairCandidate>();
  for (const candidate of candidates) {
    for (const line of [candidate.low, candidate.high]) {
      const current = nearest.get(line);
      if (!current || candidate.gap < current.gap) nearest.set(line, candidate);
    }
  }
  const histogram = new Map<number, number>();
  for (const candidate of new Set(nearest.values())) {
    const bucket = Math.round(candidate.gap / THICKNESS_BUCKET);
    const weight = candidate.overlaps.reduce(
      (sum, item) => sum + (item.end - item.start),
      0,
    );
    histogram.set(bucket, (histogram.get(bucket) ?? 0) + weight);
  }
  let best = 0;
  let bestWeight = 0;
  for (const [bucket, weight] of histogram) {
    if (weight > bestWeight) {
      best = bucket;
      bestWeight = weight;
    }
  }
  return best * THICKNESS_BUCKET;
}

/**
 * Cut intervals into strong stretches (covered by wall evidence) and weak
 * leftovers. Slivers shorter than 2·GRID join the neighbouring strong
 * stretch so the line never develops a gap it did not have.
 */
function splitByEvidence(intervals: Interval[], evidence: Interval[]) {
  const strong: Interval[] = [];
  const weak: Interval[] = [];
  const cuts = evidence.length ? mergeIntervals(evidence, 0) : [];
  for (const interval of intervals) {
    const pieces: { start: number; end: number; strong: boolean }[] = [];
    let cursor = interval.start;
    for (const cut of cuts) {
      if (cut.end <= cursor || cut.start >= interval.end) continue;
      if (cut.start > cursor) {
        pieces.push({ start: cursor, end: cut.start, strong: false });
      }
      const end = Math.min(cut.end, interval.end);
      pieces.push({ start: Math.max(cursor, cut.start), end, strong: true });
      cursor = end;
    }
    if (cursor < interval.end) {
      pieces.push({ start: cursor, end: interval.end, strong: false });
    }
    if (!pieces.some((piece) => piece.strong)) {
      weak.push(interval);
      continue;
    }
    // Absorb slivers into the nearest strong piece.
    for (let i = 0; i < pieces.length; i += 1) {
      const piece = pieces[i]!;
      if (piece.strong || piece.end - piece.start >= GRID * 2) continue;
      const target = pieces[i - 1]?.strong ? pieces[i - 1]! : pieces[i + 1]!;
      target.start = Math.min(target.start, piece.start);
      target.end = Math.max(target.end, piece.end);
      pieces.splice(i, 1);
      i -= 1;
    }
    for (const piece of pieces) {
      (piece.strong ? strong : weak).push({
        start: piece.start,
        end: piece.end,
      });
    }
  }
  return { strong: strong.length ? mergeIntervals(strong, 0) : [], weak };
}

/**
 * Stage 2: grade every line. Parallel pairs a wall thickness apart collapse
 * to a strong centerline (the paired stretch is removed from both faces);
 * heavy or wall-layer lines are strong as drawn; the rest stay weak.
 */
export function gradeLines(lines: DirectionalLine[]) {
  const candidates = findPairCandidates(lines);
  const wallThickness = estimateWallThickness(candidates);
  const minGap = Math.max(GRID * 1.5, wallThickness * 0.4);
  const maxGap = Math.min(
    MAX_PAIR_GAP,
    Math.max(wallThickness * MAX_THICKNESS_MULTIPLE, MIN_MAX_PAIR_GAP),
  );

  // A line pairs with its nearest opposite face only; otherwise a wall face
  // also pairs with the counter beside it and phantom centerlines appear.
  const nearest = new Map<DirectionalLine, PairCandidate>();
  for (const candidate of candidates) {
    if (candidate.gap < minGap || candidate.gap > maxGap) continue;
    for (const line of [candidate.low, candidate.high]) {
      const current = nearest.get(line);
      if (!current || candidate.gap < current.gap) nearest.set(line, candidate);
    }
  }

  const centerlines = new Map<string, DirectionalLine>();
  const consumed = new Map<DirectionalLine, Interval[]>();
  for (const candidate of new Set(nearest.values())) {
    const offset = quantize((candidate.low.offset + candidate.high.offset) / 2);
    const key = `${candidate.low.angleIndex}:${offset.toFixed(4)}`;
    const line = centerlines.get(key) ?? {
      ...candidate.low,
      offset,
      intervals: [],
      wallIntervals: [],
      thickness: candidate.gap,
      strong: true,
    };
    line.intervals.push(...candidate.overlaps);
    line.thickness = Math.max(line.thickness ?? 0, candidate.gap);
    centerlines.set(key, line);
    for (const face of [candidate.low, candidate.high]) {
      const list = consumed.get(face) ?? [];
      list.push(...candidate.overlaps);
      consumed.set(face, list);
    }
  }

  const output: DirectionalLine[] = [];
  const stats = { paired: centerlines.size, strong: 0, weak: 0 };
  for (const line of centerlines.values()) {
    output.push({ ...line, intervals: mergeIntervals(line.intervals, GRID) });
  }
  for (const line of lines) {
    const remaining = subtractIntervals(
      line.intervals,
      consumed.get(line) ?? [],
    );
    if (remaining.length === 0) continue;
    // Heaviness is judged stretch by stretch: one drawn line often carries a
    // heavy wall stroke and its thin outline continuation.
    const { strong: strongParts, weak: weakParts } = splitByEvidence(
      remaining,
      line.wallIntervals,
    );
    if (strongParts.length) {
      stats.strong += 1;
      output.push({ ...line, intervals: strongParts, strong: true });
    }
    if (weakParts.length) {
      stats.weak += 1;
      output.push({ ...line, intervals: weakParts, strong: false });
    }
  }
  return { lines: output, wallThickness, stats };
}

/** Remove the paired stretches from a face line, keeping leftovers ≥ 2·GRID. */
function subtractIntervals(intervals: Interval[], cuts: Interval[]) {
  if (cuts.length === 0) return intervals;
  const merged = mergeIntervals(cuts, 0);
  const out: Interval[] = [];
  for (const interval of intervals) {
    let cursor = interval.start;
    for (const cut of merged) {
      if (cut.end <= cursor || cut.start >= interval.end) continue;
      if (cut.start - cursor >= GRID * 2) {
        out.push({ start: cursor, end: cut.start });
      }
      cursor = Math.max(cursor, cut.end);
    }
    if (interval.end - cursor >= GRID * 2) {
      out.push({ start: cursor, end: interval.end });
    }
  }
  return out;
}

/**
 * A thin line must run at least this far past a wall on both sides before
 * it reads as passing through the wall rather than ending at it.
 */
const ANNOTATION_OVERHANG = 0.006;

/**
 * Stage 2.2: thin lines that run straight through a strong wall are sheet
 * annotation — tag leaders, dimension strings, section cuts, match lines —
 * not building geometry. Left in, a leader slicing across a suite splits
 * its faces and, where it grazes a door band, zig-zags the noded linework
 * so the door never connects. Drop every weak stretch that crosses the
 * interior of a strong wall with a clear overhang on both sides.
 */
export function dropAnnotationLines(
  lines: DirectionalLine[],
  wallThickness: number,
) {
  const reach = Math.max(GRID * 3, wallThickness * JUNCTION_THICKNESS_MULTIPLE);
  const strong = lines.filter((line) => line.strong);
  let dropped = 0;
  const passesThroughWall = (line: DirectionalLine, interval: Interval) =>
    strong.some((wall) => {
      if (wall.angleIndex === line.angleIndex) return false;
      const denominator = line.ux * wall.nx + line.uy * wall.ny;
      if (Math.abs(denominator) < 0.05) return false;
      const px = line.nx * line.offset;
      const py = line.ny * line.offset;
      const t = (wall.offset - (px * wall.nx + py * wall.ny)) / denominator;
      if (
        t - interval.start < ANNOTATION_OVERHANG ||
        interval.end - t < ANNOTATION_OVERHANG
      ) {
        return false;
      }
      const qx = px + line.ux * t;
      const qy = py + line.uy * t;
      const along = qx * wall.ux + qy * wall.uy;
      return wall.intervals.some(
        (item) => along >= item.start + reach && along <= item.end - reach,
      );
    });
  const result = lines.flatMap((line) => {
    if (line.strong) return [line];
    const intervals = line.intervals.filter(
      (interval) => !passesThroughWall(line, interval),
    );
    dropped += line.intervals.length - intervals.length;
    return intervals.length ? [{ ...line, intervals }] : [];
  });
  return Object.assign(result, { dropped });
}

/** A line may stop this far short of the line it was meant to meet. */
const JUNCTION_THICKNESS_MULTIPLE = 3;

/**
 * Stage 2.5: CAD walls often stop at the far face of the wall they abut, a
 * thickness or so short of the line we kept for it. Extend every interval end
 * to the first crossing line within reach so the polygonizer sees a corner.
 */
export function closeJunctions(
  lines: DirectionalLine[],
  wallThickness: number,
): DirectionalLine[] {
  const reach = Math.max(GRID * 3, wallThickness * JUNCTION_THICKNESS_MULTIPLE);
  let extended = 0;
  const result = lines.map((line) => ({
    ...line,
    intervals: line.intervals.map((interval) => ({ ...interval })),
  }));
  for (const line of result) {
    for (const interval of line.intervals) {
      for (const side of [-1, 1] as const) {
        const t0 = side === 1 ? interval.end : interval.start;
        const ahead = distanceToCrossingLine(line, t0, side, result, reach);
        if (ahead === null || ahead <= 0) continue;
        extended += 1;
        if (side === 1) interval.end = quantize(t0 + ahead);
        else interval.start = quantize(t0 - ahead);
      }
    }
  }
  return Object.assign(result, { extended });
}

/**
 * Distance from position `t0` on `line`, looking in `side` direction, to the
 * nearest non-parallel line ahead whose drawn intervals reach the crossing
 * point (they may stop `reach` short of it: a near-miss corner); null when
 * nothing is within `reach`. Lines already crossed are ignored: overshooting
 * a corner by a hair must not stop a wall from meeting the next line, and any
 * overshoot past the crossing is a dangle the polygonizer drops.
 */
function distanceToCrossingLine(
  line: DirectionalLine,
  t0: number,
  side: -1 | 1,
  lines: DirectionalLine[],
  reach: number,
) {
  const px = line.ux * t0 + line.nx * line.offset;
  const py = line.uy * t0 + line.ny * line.offset;
  let best: number | null = null;
  for (const other of lines) {
    if (other === line || other.angleIndex === line.angleIndex) continue;
    const denominator = line.ux * other.nx + line.uy * other.ny;
    if (Math.abs(denominator) < 0.05) continue;
    const step = (other.offset - (px * other.nx + py * other.ny)) / denominator;
    const ahead = step * side;
    if (ahead <= 0 || ahead > reach || (best !== null && ahead >= best)) {
      continue;
    }
    const qx = px + line.ux * step;
    const qy = py + line.uy * step;
    const along = qx * other.ux + qy * other.uy;
    const covered = other.intervals.some(
      (item) => along >= item.start - reach && along <= item.end + reach,
    );
    if (covered) best = ahead;
  }
  return best;
}

/**
 * How far a crossing wall must continue on both sides of a wall end before
 * the end reads as a T-junction into a through wall rather than a jamb.
 */
const THROUGH_WALL_REACH = 0.006;
/** A gap end this far from the crossing wall still counts as meeting it. */
const THROUGH_WALL_SLACK = 0.004;

function meetsCrossingLine(
  line: DirectionalLine,
  t0: number,
  side: -1 | 1,
  lines: DirectionalLine[],
  reach: number,
) {
  return distanceToCrossingLine(line, t0, side, lines, reach) !== null;
}

/** Parallel lines this close are the same wall face drawn in two pieces. */
const MAX_WELD_STEP = GRID * 1.5;

/**
 * Where a wall continues on a parallel line one grid step away (a paired
 * centerline handing over to the unpaired rest of its source line, or CAD
 * pieces that quantized to neighbouring cells), the polygonizer sees two
 * lines that never touch and a one-pixel channel between them. Weld each
 * interval end to the neighbouring line with a perpendicular jog.
 */
export function weldOffsetSteps(lines: DirectionalLine[]): LineSegment[] {
  const byAngle = new Map<number, DirectionalLine[]>();
  for (const line of lines) {
    const list = byAngle.get(line.angleIndex) ?? [];
    list.push(line);
    byAngle.set(line.angleIndex, list);
  }
  const welds: LineSegment[] = [];
  const seen = new Set<string>();
  for (const list of byAngle.values()) {
    list.sort((left, right) => left.offset - right.offset);
    for (let i = 0; i < list.length; i += 1) {
      const line = list[i]!;
      for (let j = i + 1; j < list.length; j += 1) {
        const other = list[j]!;
        const step = other.offset - line.offset;
        if (step > MAX_WELD_STEP) break;
        if (step <= 0) continue;
        for (const [from, to] of [
          [line, other],
          [other, line],
        ] as const) {
          for (const interval of from.intervals) {
            for (const t of [interval.start, interval.end]) {
              const covered = to.intervals.some(
                (item) => item.start <= t + GRID && item.end >= t - GRID,
              );
              if (!covered) continue;
              const key = `${line.angleIndex}:${line.offset}:${other.offset}:${t}`;
              if (seen.has(key)) continue;
              seen.add(key);
              welds.push([
                [
                  line.ux * t + line.nx * line.offset,
                  line.uy * t + line.ny * line.offset,
                ],
                [
                  other.ux * t + other.nx * other.offset,
                  other.uy * t + other.ny * other.offset,
                ],
              ]);
            }
          }
        }
      }
    }
  }
  return welds;
}

/** Stage 3: close doorway-sized gaps, remembering every bridge. */
/** How far off the wall line a swing's hinge may sit (jamb + line thickness). */
const HINGE_SLACK = 0.004;
/** Fraction of a gap the drawn swings must reach across to call it a doorway. */
const SWING_COVERAGE = 0.6;

/**
 * Are door swings drawn across the gap `[start, end]` on `line`? A swing is
 * an arc hinged on the wall inside the gap whose free end sits in the band the
 * gap sweeps out perpendicular to the wall. Its reach (hinge to free end) is
 * the leaf width, so the swings found must reach across most of the gap: a
 * single leaf next to a much wider gap is a door beside an opening, not a door
 * across it.
 */
function doorArcAcrossGap(
  line: DirectionalLine,
  start: number,
  end: number,
  arcs: WallSegment[],
) {
  const gap = end - start;
  const slack = gap * 0.2;
  const base = line.nx * line.offset;
  const baseY = line.ny * line.offset;
  const measure = (point: { x: number; y: number }) => ({
    along: point.x * line.ux + point.y * line.uy,
    away: Math.abs((point.x - base) * line.nx + (point.y - baseY) * line.ny),
  });
  const inBand = (at: { along: number; away: number }) =>
    at.along >= start - slack &&
    at.along <= end + slack &&
    at.away <= gap * 1.3;
  const hinges: number[] = [];
  let reach = 0;
  for (const arc of arcs) {
    const ends = [
      measure({ x: arc.x1, y: arc.y1 }),
      measure({ x: arc.x2, y: arc.y2 }),
    ];
    if (!ends.every(inBand)) continue;
    const hinge = ends.find((at) => at.away <= HINGE_SLACK);
    if (!hinge) continue;
    if (hinges.some((at) => Math.abs(at - hinge.along) < GRID * 2)) continue;
    hinges.push(hinge.along);
    reach += Math.hypot(arc.x2 - arc.x1, arc.y2 - arc.y1);
  }
  return reach >= gap * SWING_COVERAGE;
}

/** Does a perpendicular strong wall meet `line` at `t0` (a corner or a T)? */
function meetsPerpendicularWall(
  line: DirectionalLine,
  t0: number,
  lines: DirectionalLine[],
) {
  const px = line.ux * t0 + line.nx * line.offset;
  const py = line.uy * t0 + line.ny * line.offset;
  for (const other of lines) {
    if (other === line || other.angleIndex === line.angleIndex) continue;
    const denominator = line.ux * other.nx + line.uy * other.ny;
    if (Math.abs(denominator) < 0.7) continue;
    const step = (other.offset - (px * other.nx + py * other.ny)) / denominator;
    if (Math.abs(step) > THROUGH_WALL_SLACK) continue;
    const qx = px + line.ux * step;
    const qy = py + line.uy * step;
    const along = qx * other.ux + qy * other.uy;
    const covered = (at: number) =>
      other.intervals.some(
        (item) => at >= item.start - GRID && at <= item.end + GRID,
      );
    if (
      covered(along - THROUGH_WALL_REACH) ||
      covered(along + THROUGH_WALL_REACH)
    ) {
      return true;
    }
  }
  return false;
}

export function bridgeGaps(
  lines: DirectionalLine[],
  options: { maxGap?: number; arcs?: WallSegment[] } = {},
) {
  const maxGap = options.maxGap ?? MAX_DOOR_GAP;
  const arcs = options.arcs ?? [];
  const output: LineSegment[] = [];
  const strong: LineSegment[] = [];
  const doors: LineSegment[] = [];
  const bridges: Bridge[] = [];
  const strongLines = lines.filter((line) => line.strong);
  for (const line of lines) {
    const { ux, uy, nx, ny, offset } = line;
    const toPoint = (t: number): [number, number] => [
      ux * t + nx * offset,
      uy * t + ny * offset,
    ];
    const intervals = [...line.intervals].sort(
      (left, right) => left.start - right.start,
    );
    let current = { ...intervals[0]! };
    const emit = () => {
      output.push([
        toPoint(current.start - CORNER_EXTENSION),
        toPoint(current.end + CORNER_EXTENSION),
      ]);
      if (!line.strong) return;
      // A wall that stops a door's width short of a crossing wall is a
      // doorway in the corner of the room (the common "door beside the wall"
      // layout); bridge it to the wall it was heading for.
      for (const side of [-1, 1] as const) {
        const t0 = side === 1 ? current.end : current.start;
        const ahead = distanceToCrossingLine(
          line,
          t0,
          side,
          strongLines,
          MAX_DOOR_WIDTH,
        );
        if (ahead === null || ahead < GRID * 3) continue;
        const door: LineSegment = [toPoint(t0), toPoint(t0 + side * ahead)];
        output.push(door);
        doors.push(door);
        bridges.push({ segment: door, length: ahead, strong: true });
      }
    };
    for (let i = 1; i < intervals.length; i += 1) {
      const next = intervals[i]!;
      // Two wall ends facing each other across a corridor or a room are not
      // a doorway: nothing swings there and both ends sit on other walls.
      // A drawn door swing settles it either way.
      const gap = next.start - current.end;
      const swing =
        line.strong &&
        gap > GRID &&
        gap <= MAX_SWING_GAP &&
        doorArcAcrossGap(line, current.end, next.start, arcs);
      const crossing =
        line.strong &&
        gap > GRID &&
        !swing &&
        meetsPerpendicularWall(line, current.end, strongLines) &&
        meetsPerpendicularWall(line, next.start, strongLines);
      if (swing || (gap <= maxGap && !crossing)) {
        if (next.start > current.end + GRID) {
          const length = next.start - current.end;
          bridges.push({
            segment: [toPoint(current.end), toPoint(next.start)],
            length,
            strong: line.strong,
          });
          // Any bridged gap in a strong wall is passable: a door or a cased
          // opening.
          if (line.strong) {
            doors.push([toPoint(current.end), toPoint(next.start)]);
          }
        }
        current.end = Math.max(current.end, next.end);
      } else {
        emit();
        current = { ...next };
      }
    }
    emit();
    if (line.strong) {
      for (const interval of intervals) {
        strong.push([toPoint(interval.start), toPoint(interval.end)]);
      }
    }
  }
  return { lines: output, strong, doors, bridges };
}

export function buildWallLinework(
  walls: WallSegment[],
  options: { mode?: "graded" | "all"; arcs?: WallSegment[] } = {},
): WallLinework {
  const grouped = groupLines(walls);
  if (options.mode === "all") {
    const strongLines = grouped.lines.map((line) => ({
      ...line,
      strong: true,
    }));
    const { lines, strong, doors, bridges } = bridgeGaps(
      closeJunctions(strongLines, 0),
      { arcs: options.arcs },
    );
    return {
      lines,
      strong,
      doors,
      bridges,
      wallThickness: 0,
      referenceStroke: grouped.referenceStroke,
      mode: "all",
      stats: {
        grouped: grouped.lines.length,
        paired: 0,
        strong: 0,
        weak: 0,
        gridLines: grouped.gridLines,
        heavyLength: grouped.evidence.heavy,
        layerLength: grouped.evidence.layered,
        annotations: 0,
      },
    };
  }
  const graded = gradeLines(grouped.lines);
  const kept = dropAnnotationLines(graded.lines, graded.wallThickness);
  const closed = closeJunctions(kept, graded.wallThickness);
  const { lines, strong, doors, bridges } = bridgeGaps(closed, {
    arcs: options.arcs,
  });
  lines.push(...weldOffsetSteps(closed));
  return {
    lines,
    strong,
    doors,
    bridges,
    wallThickness: graded.wallThickness,
    referenceStroke: grouped.referenceStroke,
    mode: "graded",
    stats: {
      grouped: grouped.lines.length,
      gridLines: grouped.gridLines,
      heavyLength: grouped.evidence.heavy,
      layerLength: grouped.evidence.layered,
      ...graded.stats,
      annotations: kept.dropped,
    },
  };
}

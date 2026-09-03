import type { WallSegment } from "./pdf-walls";

/**
 * Hatch patterns (floor/ceiling fills, stair treads, insulation) are drawn as
 * families of parallel lines at a fixed pitch, and CAD exporters emit a hatch
 * entity as one uninterrupted run of strokes. Walls are never that regular:
 * repeated unit partitions sit far wider apart than any hatch pitch, and
 * wall-thickness line pairs never chain more than two deep.
 */
const ANGLE_BUCKET_DEG = 1;
const OFFSET_QUANTUM = 0.0004;
const MIN_PITCH = 0.0015;
const MAX_PITCH = 0.015;
const PITCH_TOLERANCE = 0.25;
const MAX_SKIPPED_LINES = 2;
const MIN_LATTICE_LINES = 8;
const MIN_REGULAR_GAP_RATIO = 0.75;
/** Max content-stream distance between strokes of the same hatch entity. */
const MAX_ORDER_GAP = 12;

type Oriented = {
  index: number;
  angleBucket: number;
  offset: number;
  order: number;
};

function orient(segment: WallSegment, index: number): Oriented | null {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  if (Math.hypot(dx, dy) === 0) return null;
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  while (angle < 0) angle += 180;
  while (angle >= 180) angle -= 180;
  const angleBucket =
    Math.round(angle / ANGLE_BUCKET_DEG) % Math.round(180 / ANGLE_BUCKET_DEG);
  const rad = (angleBucket * ANGLE_BUCKET_DEG * Math.PI) / 180;
  const nx = -Math.sin(rad);
  const ny = Math.cos(rad);
  const offset =
    ((segment.x1 + segment.x2) / 2) * nx + ((segment.y1 + segment.y2) / 2) * ny;
  return { index, angleBucket, offset, order: segment.order ?? index };
}

/** Split a parallel family into runs that were emitted back to back. */
function emissionRuns(family: Oriented[]) {
  const sorted = [...family].sort((left, right) => left.order - right.order);
  const runs: Oriented[][] = [];
  let current: Oriented[] = [];
  for (const item of sorted) {
    const previous = current[current.length - 1];
    if (previous && item.order - previous.order > MAX_ORDER_GAP) {
      runs.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length) runs.push(current);
  return runs;
}

/** Collapse collinear pieces (clipped hatch lines, duplicate strokes) to one offset. */
function distinctOffsets(run: Oriented[]) {
  const offsets = run.map((item) => item.offset).sort((a, b) => a - b);
  const distinct: number[] = [];
  for (const offset of offsets) {
    const last = distinct[distinct.length - 1];
    if (last === undefined || offset - last > OFFSET_QUANTUM) {
      distinct.push(offset);
    }
  }
  return distinct;
}

function isMultipleOfPitch(gap: number, pitch: number) {
  for (let k = 1; k <= MAX_SKIPPED_LINES + 1; k += 1) {
    if (Math.abs(gap - k * pitch) <= pitch * PITCH_TOLERANCE) return true;
  }
  return false;
}

function isLattice(run: Oriented[]) {
  const offsets = distinctOffsets(run);
  if (offsets.length < MIN_LATTICE_LINES) return false;
  const gaps = offsets.slice(1).map((offset, i) => offset - offsets[i]!);
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const pitch = sortedGaps[Math.floor(sortedGaps.length / 2)]!;
  if (pitch < MIN_PITCH || pitch > MAX_PITCH) return false;
  const regular = gaps.filter((gap) => isMultipleOfPitch(gap, pitch)).length;
  return regular >= gaps.length * MIN_REGULAR_GAP_RATIO;
}

export function removeHatchSegments(segments: WallSegment[]): WallSegment[] {
  const families = new Map<number, Oriented[]>();
  for (let index = 0; index < segments.length; index += 1) {
    const oriented = orient(segments[index]!, index);
    if (!oriented) continue;
    const family = families.get(oriented.angleBucket) ?? [];
    family.push(oriented);
    families.set(oriented.angleBucket, family);
  }

  const drop = new Set<number>();
  for (const family of families.values()) {
    if (family.length < MIN_LATTICE_LINES) continue;
    for (const run of emissionRuns(family)) {
      if (run.length < MIN_LATTICE_LINES || !isLattice(run)) continue;
      for (const item of run) drop.add(item.index);
    }
  }
  if (drop.size === 0) return segments;
  return segments.filter((_, index) => !drop.has(index));
}

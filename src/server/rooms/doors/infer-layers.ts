import { swingSeals, type LayeredSegment } from "./door-graph";

/** A stroke as read from the PDF: sheet coordinates (0–1) plus its drawing style. */
export type StyledSegment = LayeredSegment & {
  pathId?: string;
  stroke?: string;
  width?: number;
  dash?: number[];
};

type Pt = { x: number; y: number };
export type InferredDoor = { hinge: Pt; ends: [Pt, Pt]; r: number; segments: number[] };

/** Fewer swings than this and the sheet is not a floor plan we can read by its doors. */
const MIN_DOORS = 20;
/** Strokes per redrawn swing. */
const ARC_STEPS = 8;

const styleOf = (s: StyledSegment) => `${s.stroke ?? ""}|${(s.width ?? 0).toFixed(6)}`;

/** Sheet units per working unit: swingSeals works in pixel-like numbers. */
const UNIT = 1e-4;
/** Door size guess in working units (1% of the sheet); swingSeals accepts radii 0.3–2.2× this. */
const DOOR_GUESS = 100;

/**
 * Door swings: smooth quarter-turn runs of short strokes (Bézier arcs
 * arrive flattened, often one stroke per path). Points are isotropic: y is
 * scaled by the sheet's aspect so circles stay circles.
 */
function swingArcs(segments: StyledSegment[], aspect: number): InferredDoor[] {
  const strokes = segments.map((s) => [
    { x: s.x1 / UNIT, y: (s.y1 * aspect) / UNIT },
    { x: s.x2 / UNIT, y: (s.y2 * aspect) / UNIT },
  ] as [Pt, Pt]);
  const scale = (p: Pt): Pt => ({ x: p.x * UNIT, y: p.y * UNIT });
  return swingSeals(strokes, DOOR_GUESS).map((seal) => ({
    hinge: scale(seal.hinge),
    ends: [scale(seal.ends[0]), scale(seal.ends[1])],
    r: seal.r * UNIT,
    segments: [],
  }));
}

/**
 * Plans exported without layers (printed to PDF, flattened): find door
 * swings by shape and the wall linework by the stroke style the swings
 * hinge on, then name them A-DOOR and A-WALL so the door graph can read the
 * plan like a layered CAD export. Null when the sheet has too few swings.
 */
export function inferPlanLayers(segments: StyledSegment[], aspect: number) {
  if (segments.some((s) => s.layer)) return null;
  const pt = (x: number, y: number): Pt => ({ x, y: y * aspect });
  const arcs = swingArcs(segments, aspect);
  if (arcs.length < MIN_DOORS) return null;

  // Grid of straight strokes for neighbourhood lookups.
  const radii = arcs.map((a) => a.r).sort((a, b) => a - b);
  const typical = radii[Math.floor(radii.length / 2)]!;
  const cellSize = typical;
  const grid = new Map<string, number[]>();
  const cellKey = (x: number, y: number) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
  segments.forEach((s, i) => {
    const a = pt(s.x1, s.y1), b = pt(s.x2, s.y2);
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / cellSize));
    const seen = new Set<string>();
    for (let k = 0; k <= steps; k++) {
      const key = cellKey(a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps);
      if (seen.has(key)) continue;
      seen.add(key);
      const list = grid.get(key);
      if (list) list.push(i);
      else grid.set(key, [i]);
    }
  });
  const near = (p: Pt) => {
    const gx = Math.floor(p.x / cellSize), gy = Math.floor(p.y / cellSize);
    const out = new Set<number>();
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) for (const i of grid.get(`${gx + dx},${gy + dy}`) ?? []) out.add(i);
    return out;
  };
  const distance = (p: Pt, s: StyledSegment) => {
    const a = pt(s.x1, s.y1), b = pt(s.x2, s.y2);
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  };

  // A swing has its leaf: a straight stroke from the hinge out to one arc
  // end. Toilet seats, bubbles and other arcs don't.
  const arcSegments = new Set(arcs.flatMap((a) => a.segments));
  const doors: InferredDoor[] = [];
  for (const arc of arcs) {
    if (arc.r < typical * 0.4 || arc.r > typical * 2) continue;
    const leaf: number[] = [];
    for (const end of arc.ends) {
      const ux = (end.x - arc.hinge.x) / arc.r, uy = (end.y - arc.hinge.y) / arc.r;
      for (const i of near(arc.hinge)) {
        if (arcSegments.has(i)) continue;
        const s = segments[i]!;
        const a = pt(s.x1, s.y1), b = pt(s.x2, s.y2);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < arc.r * 0.6 || len > arc.r * 1.3) continue;
        if (Math.abs(((b.x - a.x) * ux + (b.y - a.y) * uy) / len) < 0.97) continue;
        const off = (p: Pt) => Math.abs((p.x - arc.hinge.x) * uy - (p.y - arc.hinge.y) * ux);
        if (off(a) > arc.r * 0.12 || off(b) > arc.r * 0.12) continue;
        const along = (p: Pt) => (p.x - arc.hinge.x) * ux + (p.y - arc.hinge.y) * uy;
        if (Math.min(along(a), along(b)) > arc.r * 0.25 || Math.max(along(a), along(b)) < arc.r * 0.75) continue;
        leaf.push(i);
      }
    }
    if (leaf.length) doors.push({ ...arc, segments: [...arc.segments, ...leaf] });
  }
  if (doors.length < MIN_DOORS) return null;

  // Wall styles: the pens drawn at nearly every hinge (door jambs). Frames,
  // glazing and partitions are often drawn with lighter pens than the cut
  // walls, and all of them bound rooms.
  const doorSegments = new Set(doors.flatMap((d) => d.segments));
  const votes = new Map<string, number>();
  for (const door of doors) {
    const styles = new Set<string>();
    for (const i of near(door.hinge)) {
      if (doorSegments.has(i)) continue;
      if (distance(door.hinge, segments[i]!) < door.r * 0.2) styles.add(styleOf(segments[i]!));
    }
    for (const s of styles) votes.set(s, (votes.get(s) ?? 0) + 1);
  }
  const ranked = [...votes].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0]![1] < doors.length * 0.5) return null;
  const wallStyles = new Set(ranked.filter(([, v]) => v >= ranked[0]![1] * 0.8).map(([style]) => style));
  const walls = segments.map((s, i) => !doorSegments.has(i) && wallStyles.has(styleOf(s)) && !s.dash?.length);
  for (const i of dashedLines(segments, walls, aspect, typical)) walls[i] = false;
  for (const i of wallCrossings(segments, walls, aspect, typical)) walls[i] = false;
  const out: StyledSegment[] = segments.map((s, i) => ({
    ...s,
    layer: doorSegments.has(i) ? "A-DOOR" : walls[i] ? "A-WALL" : undefined,
  }));
  // Redraw each swing as a clean arc on the door layer; the source strokes
  // may be split, overlapping or mixed with other symbols.
  for (const door of doors) {
    const [a, b] = door.ends.map((e) => Math.atan2(e.y - door.hinge.y, e.x - door.hinge.x)) as [number, number];
    let sweep = b - a;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    const at = (k: number) => {
      const t = a + (sweep * k) / ARC_STEPS;
      return { x: door.hinge.x + door.r * Math.cos(t), y: (door.hinge.y + door.r * Math.sin(t)) / aspect };
    };
    for (let k = 0; k < ARC_STEPS; k++) {
      const p = at(k), q = at(k + 1);
      out.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, layer: "A-DOOR" });
    }
  }
  return { segments: out, doors, wallStyles: [...wallStyles] };
}

/**
 * Grid and centre lines printed without a dash pattern: the dashes arrive
 * as separate collinear strokes, evenly sized and evenly spaced along one
 * long line. A wall line breaks at openings of varying width between runs
 * of varying length.
 */
function dashedLines(segments: StyledSegment[], candidates: boolean[], aspect: number, doorRadius: number) {
  const tolerance = doorRadius * 0.02;
  const lines = new Map<string, Array<{ i: number; from: number; to: number }>>();
  segments.forEach((s, i) => {
    if (!candidates[i]) return;
    const dx = s.x2 - s.x1, dy = (s.y2 - s.y1) * aspect, len = Math.hypot(dx, dy);
    if (!len) return;
    // Direction folded to [0, π), offset measured along its normal.
    let ux = dx / len, uy = dy / len;
    if (uy < 0 || (uy === 0 && ux < 0)) { ux = -ux; uy = -uy; }
    const angle = Math.round((Math.atan2(uy, ux) * 180) / Math.PI / 0.25);
    const offset = Math.round((s.x1 * uy - s.y1 * aspect * ux) / tolerance);
    const a = s.x1 * ux + s.y1 * aspect * uy, b = s.x2 * ux + s.y2 * aspect * uy;
    const key = `${angle % 720},${offset}`;
    const list = lines.get(key);
    const piece = { i, from: Math.min(a, b), to: Math.max(a, b) };
    if (list) list.push(piece);
    else lines.set(key, [piece]);
  });
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]!;
  const regular = (values: number[]) => {
    const m = median(values);
    return values.filter((v) => v > m * 0.6 && v < m * 1.6).length >= values.length * 0.75;
  };
  const dashed: number[] = [];
  for (const pieces of lines.values()) {
    if (pieces.length < 6) continue;
    pieces.sort((p, q) => p.from - q.from);
    // Touching pieces form one run (a dash may be split at a dot).
    const runs: number[] = [];
    const gaps: number[] = [];
    let start = pieces[0]!.from, reach = pieces[0]!.to;
    for (const p of pieces.slice(1)) {
      if (p.from - reach > tolerance) {
        runs.push(reach - start);
        gaps.push(p.from - reach);
        start = p.from;
      }
      reach = Math.max(reach, p.to);
    }
    runs.push(reach - start);
    if (gaps.length < 5 || median(runs) > doorRadius * 5) continue;
    if (regular(gaps) && regular(runs)) dashed.push(...pieces.map((p) => p.i));
  }
  return dashed;
}

/**
 * Strokes that pass straight through a wall (crossing both of its faces):
 * grid lines, section cuts and leaders. Walls meet walls at corners and
 * tees; they don't cut through them.
 */
function wallCrossings(segments: StyledSegment[], candidates: boolean[], aspect: number, doorRadius: number) {
  const cell = doorRadius;
  const grid = new Map<string, number[]>();
  const pts = segments.map((s) => ({ ax: s.x1, ay: s.y1 * aspect, bx: s.x2, by: s.y2 * aspect }));
  pts.forEach((p, i) => {
    if (!candidates[i]) return;
    const steps = Math.max(1, Math.ceil(Math.hypot(p.bx - p.ax, p.by - p.ay) / cell));
    const seen = new Set<string>();
    for (let k = 0; k <= steps; k++) {
      const key = `${Math.floor((p.ax + ((p.bx - p.ax) * k) / steps) / cell)},${Math.floor((p.ay + ((p.by - p.ay) * k) / steps) / cell)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const list = grid.get(key);
      if (list) list.push(i);
      else grid.set(key, [i]);
    }
  });
  const crossers: number[] = [];
  pts.forEach((p, i) => {
    if (!candidates[i]) return;
    const dx = p.bx - p.ax, dy = p.by - p.ay, len = Math.hypot(dx, dy);
    if (len < doorRadius * 0.5) return;
    const seen = new Set<number>();
    const crossed: Array<{ ux: number; uy: number; offset: number }> = [];
    const steps = Math.ceil(len / cell);
    for (let k = 0; k <= steps; k++) {
      const gx = Math.floor((p.ax + (dx * k) / steps) / cell), gy = Math.floor((p.ay + (dy * k) / steps) / cell);
      for (const j of grid.get(`${gx},${gy}`) ?? []) {
        if (j === i || seen.has(j)) continue;
        seen.add(j);
        const q = pts[j]!;
        const ex = q.bx - q.ax, ey = q.by - q.ay;
        const denom = dx * ey - dy * ex;
        const qlen = Math.hypot(ex, ey);
        if (Math.abs(denom) < len * qlen * 0.2) continue; // near-parallel
        const t = ((q.ax - p.ax) * ey - (q.ay - p.ay) * ex) / denom;
        const u = ((q.ax - p.ax) * dy - (q.ay - p.ay) * dx) / denom;
        // Both strokes run well past the crossing: corner and tee
        // overshoots of a few centimetres are not crossings.
        const reach = doorRadius * 0.15;
        if (t * len < reach || (1 - t) * len < reach || u * qlen < reach || (1 - u) * qlen < reach) continue;
        let ux = ex / qlen, uy = ey / qlen;
        if (uy < 0 || (uy === 0 && ux < 0)) { ux = -ux; uy = -uy; }
        crossed.push({ ux, uy, offset: q.ax * uy - q.ay * ux });
      }
    }
    // Both faces of one wall: parallel strokes a wall's thickness apart.
    for (let a = 0; a < crossed.length; a++)
      for (let b = a + 1; b < crossed.length; b++) {
        const A = crossed[a]!, B = crossed[b]!;
        if (A.ux * B.ux + A.uy * B.uy < 0.998) continue;
        const gap = Math.abs(A.offset - B.offset);
        if (gap > doorRadius * 0.03 && gap < doorRadius * 0.6) { crossers.push(i); return; }
      }
  });
  return crossers;
}

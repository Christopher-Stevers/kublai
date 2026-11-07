import type { PipeLinework, PipeSegment } from "./pipe-system";
import type { SheetPoint } from "./sheet-measure";

const CELL = 0.002;
const JOIN = 0.00015;
const noteLayer = (layer?: string) =>
  /(?:^|[-_| ])(?:NOTE|ANNO|TAG)(?:[-_| ]|$)/i.test(layer ?? "");
type Path = { segments: PipeSegment[]; points: SheetPoint[] };

/** Recognize annotation leaders by three independent cues: a narrow filled
 * arrowhead, a shaft starting at its base, and an annotation at the other end:
 * either a tag on a note layer, or any printed note (such as "150Ø SAN @ 1%")
 * where the shaft ends freely beside the text. Exclude only those source
 * paths, never the pipe touched by the tip. */
export function pipeTagLeaderPaths(linework: PipeLinework): Set<string> {
  const excluded = new Set<string>();
  const aspect = linework.aspect;
  if (!(aspect > 0) || !Number.isFinite(aspect) || aspect > 100)
    return excluded;
  const texts = (linework.texts ?? [])
    .slice(0, 30000)
    .filter((t) => /[A-Z0-9]/i.test(t.text) && t.bottom > t.top);
  const tags = texts.filter((t) =>
    /^[A-Z]{1,8}\s*[-–]?\s*\d{1,5}[A-Z]?$/i.test(t.text.trim()),
  );
  if (!texts.length) return excluded;
  const dist = (a: SheetPoint, b: SheetPoint) =>
    Math.hypot(a.x - b.x, (a.y - b.y) * aspect);
  const start = (s: PipeSegment) => ({ x: s.x1, y: s.y1 });
  const end = (s: PipeSegment) => ({ x: s.x2, y: s.y2 });
  const key = (p: SheetPoint) =>
    `${Math.floor(p.x / CELL)},${Math.floor((p.y * aspect) / CELL)}`;
  const neighbors = (p: SheetPoint) => {
    const x = Math.floor(p.x / CELL),
      y = Math.floor((p.y * aspect) / CELL);
    return [-1, 0, 1].flatMap((dx) =>
      [-1, 0, 1].map((dy) => `${x + dx},${y + dy}`),
    );
  };
  const textCells = new Map<string, typeof texts>();
  for (const t of texts) {
    const x0 = Math.floor(t.left / CELL),
      x1 = Math.floor(t.right / CELL),
      y0 = Math.floor((t.top * aspect) / CELL),
      y1 = Math.floor((t.bottom * aspect) / CELL);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) continue;
    for (let x = x0 - 1; x <= x1 + 1; x++)
      for (let y = y0 - 1; y <= y1 + 1; y++) {
        const bucket = textCells.get(`${x},${y}`) ?? [];
        if (bucket.length < 64) bucket.push(t);
        textCells.set(`${x},${y}`, bucket);
      }
  }
  const layers = new Map<string | undefined, PipeSegment[]>();
  const groups = new Map<string, PipeSegment[]>();
  const notes = new Map<string, SheetPoint[]>();
  for (const s of linework.segments.slice(0, 200000)) {
    const group = groups.get(s.pathId) ?? [];
    if (group.length < 17) group.push(s);
    groups.set(s.pathId, group);
    const layer = layers.get(s.layer) ?? [];
    layer.push(s);
    layers.set(s.layer, layer);
    if (noteLayer(s.layer))
      for (const p of [start(s), end(s)]) {
        const bucket = notes.get(key(p)) ?? [];
        if (bucket.length < 256) bucket.push(p);
        notes.set(key(p), bucket);
      }
  }
  const open = new Map<string, Path[]>();
  const arrows: Path[] = [];
  for (const segments of groups.values()) {
    if (!segments.length || segments.length > 16) continue;
    const points = [start(segments[0]!)];
    let contiguous = true;
    for (const s of segments) {
      if (dist(points.at(-1)!, start(s)) > 1e-8) {
        contiguous = false;
        break;
      }
      points.push(end(s));
    }
    if (!contiguous) continue;
    const path = { segments, points };
    if (
      segments.length === 3 &&
      segments.every((s) => s.closed && s.width === 0) &&
      dist(points[0]!, points[3]!) < 1e-8
    ) {
      arrows.push(path);
    } else if (
      segments.every((s) => !s.closed && s.width > 0 && !s.dash.length)
    ) {
      for (const p of [points[0]!, points.at(-1)!]) {
        const bucket = open.get(key(p)) ?? [];
        if (bucket.length < 256) bucket.push(path);
        open.set(key(p), bucket);
      }
    }
  }
  const tagged = (p: SheetPoint) => {
    if (
      !neighbors(p).some((k) => notes.get(k)?.some((q) => dist(p, q) <= JOIN))
    )
      return false;
    return tags.some((t) => {
      const h = (t.bottom - t.top) * aspect;
      const dx = Math.max(t.left - p.x, 0, p.x - t.right);
      const dy = Math.max(t.top - p.y, 0, p.y - t.bottom) * aspect;
      return h > 0 && Math.hypot(dx, dy) <= Math.min(0.008, h * 2);
    });
  };
  const textGap = (
    t: (typeof texts)[number],
    p: SheetPoint,
    limit: number,
  ) => {
    const h = (t.bottom - t.top) * aspect;
    const dx = Math.max(t.left - p.x, 0, p.x - t.right);
    const dy = Math.max(t.top - p.y, 0, p.y - t.bottom) * aspect;
    return h > 0 && Math.hypot(dx, dy) <= Math.min(limit, h * 1.5);
  };
  const onSegment = (p: SheetPoint, s: PipeSegment) => {
    const ax = s.x2 - s.x1,
      ay = (s.y2 - s.y1) * aspect,
      px = p.x - s.x1,
      py = (p.y - s.y1) * aspect,
      l2 = ax * ax + ay * ay;
    const t = l2 > 0 ? Math.max(0, Math.min(1, (px * ax + py * ay) / l2)) : 0;
    return Math.hypot(px - t * ax, py - t * ay) <= JOIN;
  };
  // A pipe continues into other linework; a note leader stops beside its text.
  const noted = (p: SheetPoint, path: Path, arrow: Path) => {
    const near = neighbors(p).flatMap((k) => textCells.get(k) ?? []);
    if (!near.some((t) => textGap(t, p, 0.004))) return false;
    const pool = layers.get(path.segments[0]!.layer) ?? [];
    if (pool.length > 50000) return false;
    const own = new Set([path.segments[0]!.pathId, arrow.segments[0]!.pathId]);
    return !pool.some((s) => !own.has(s.pathId) && onSegment(p, s));
  };
  for (const arrow of arrows) {
    const vertices = arrow.points.slice(0, 3);
    const edges = vertices
      .map((p, i) => ({ i, length: dist(p, vertices[(i + 1) % 3]!) }))
      .sort((a, b) => a.length - b.length);
    const baseEdge = edges[0]!,
      side1 = edges[1]!.length,
      side2 = edges[2]!.length;
    if (
      baseEdge.length < 0.0001 ||
      side2 > 0.01 ||
      side1 / side2 < 0.85 ||
      baseEdge.length / side1 > 0.6
    )
      continue;
    const a = vertices[baseEdge.i]!,
      b = vertices[(baseEdge.i + 1) % 3]!,
      tip = vertices[(baseEdge.i + 2) % 3]!;
    const base = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const ax = base.x - tip.x,
      ay = (base.y - tip.y) * aspect,
      al = Math.hypot(ax, ay);
    const matches = new Set<Path>();
    for (const k of neighbors(base))
      for (const path of open.get(k) ?? []) {
        const first = path.segments[0]!;
        if (
          first.layer !== arrow.segments[0]!.layer ||
          first.stroke !== arrow.segments[0]!.stroke
        )
          continue;
        const points =
          dist(path.points[0]!, base) <= JOIN
            ? path.points
            : [...path.points].reverse();
        if (dist(points[0]!, base) > JOIN) continue;
        const nx = points[1]!.x - points[0]!.x,
          ny = (points[1]!.y - points[0]!.y) * aspect;
        if ((nx * ax + ny * ay) / (Math.hypot(nx, ny) * al) < 0.98) continue;
        const far = points.at(-1)!;
        if (
          points.some((p) => dist(p, base) > 0.15) ||
          !(tagged(far) || noted(far, path, arrow))
        )
          continue;
        matches.add(path);
      }
    // Ambiguous shafts stay visible for review.
    if (matches.size !== 1) continue;
    excluded.add(arrow.segments[0]!.pathId);
    excluded.add([...matches][0]!.segments[0]!.pathId);
  }
  return excluded;
}

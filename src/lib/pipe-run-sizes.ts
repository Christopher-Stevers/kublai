import type { PipeDrawingText } from "./pipe-components-types";
import type { PipeSegment, PipeSystemSelection } from "./pipe-system";
import { PIPE_SYSTEM_NAMES, unionLength } from "./pipe-system";

/** A nominal pipe size: inches for imperial drawings, millimetres for metric. */
export type PipeSize = { unit: "in" | "mm"; nominal: number };
/** A size printed on the sheet, such as `4"Ø SAN` or `DN100`. */
export type PipeSizeTag = PipeDrawingText & { size: PipeSize; systems: string[] };
export type PipeRunSize = { size: PipeSize | null; lengthInSheetWidths: number };
export type PipeSizeBreakdown = {
  /** Largest first; the run with `size: null` had no readable tag. */
  runs: PipeRunSize[];
  /** Each selected segment's size, for sizing fittings from their pipe. */
  segmentSizes: Map<string, PipeSize>;
  tagCount: number;
};

const JOIN = 0.0005;
const STRAIGHT = Math.cos((10 * Math.PI) / 180);
const SYSTEM_WORD = /\b(?:SAN|VENT|VTR|ST|STM|STORM|RWL|DCW|DHW|DHWR|HWS|HWR|CHWS|CHWR|CWS|CWR|CW|HW|GAS|NG|FIRE|FP|W|V|S)\b/gi;

export function sizeKey(size: PipeSize) {
  return `${size.unit}:${size.nominal}`;
}

/** `1.5` in → `1-1/2"`; metric sizes read `100 mm`. */
export function formatPipeSize(size: PipeSize | null) {
  if (!size) return "Unknown size";
  if (size.unit === "mm") return `${size.nominal} mm`;
  const whole = Math.floor(size.nominal + 1e-9);
  const rest = size.nominal - whole;
  if (rest < 1e-6) return `${whole}"`;
  const sixteenths = Math.round(rest * 16);
  if (Math.abs(sixteenths / 16 - rest) < 1e-6) {
    let num = sixteenths,
      den = 16;
    while (num % 2 === 0) [num, den] = [num / 2, den / 2];
    return whole ? `${whole}-${num}/${den}"` : `${num}/${den}"`;
  }
  return `${Math.round(size.nominal * 1000) / 1000}"`;
}

function inches(text: string) {
  const mixed = /^(\d+)[- ](\d+)\/(\d+)$/.exec(text);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\/(\d+)$/.exec(text);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  return Number(text);
}

const NUMBER = String.raw`(\d+[- ]\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+)`;
const INCH = String.raw`(?:"|″|''|\s?in(?:ch(?:es)?)?\b)`;

/** Read one nominal pipe size from a drawing note, or null when the note is
 * a dimension, a reducing size, or has no size mark (Ø, ", mm or DN). */
export function parsePipeSize(raw: string): PipeSize | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text || text.length > 60) return null;
  // Feet-and-inch dimensions (12'-6") and reducing sizes (4"x3").
  if (/\d\s*['′](?!['′])/.test(text) || /\d\s*(?:"|″|mm)?\s*[x×]\s*\d/i.test(text))
    return null;
  const dn = /\bDN\s?(\d{2,4})\b/i.exec(text);
  if (dn) return { unit: "mm", nominal: Number(dn[1]) };
  const found: PipeSize[] = [];
  const marked = new RegExp(String.raw`(?:^|[^\d/.])${NUMBER}\s*(${INCH})?\s*(?:Ø|ø|⌀|DIA\b)|(?:Ø|ø|⌀)\s*${NUMBER}\s*(${INCH}|mm\b)?`, "gi");
  for (const match of text.matchAll(marked)) {
    const value = match[1] ?? match[3]!;
    const mark = match[2] ?? match[4];
    const nominal = inches(value);
    if (!(nominal > 0)) continue;
    // A bare Ø size reads as inches up to 12, as millimetres above that.
    const metric = mark ? /mm/i.test(mark) : nominal > 12;
    found.push({ unit: metric ? "mm" : "in", nominal });
  }
  if (!found.length) {
    const plain = new RegExp(String.raw`(?:^|[^\d/.])${NUMBER}\s*(${INCH}|mm\b)`, "gi");
    // Unmarked sizes must be the whole note or sit beside a system code.
    const rest = text.replace(plain, " ").replace(SYSTEM_WORD, " ").trim();
    if (rest.length > 3 && !/\b(?:PIPE|UP|DN|DOWN|@|%)/i.test(rest)) return null;
    for (const match of text.matchAll(plain)) {
      const nominal = inches(match[1]!);
      if (nominal > 0)
        found.push({ unit: /mm/i.test(match[2]!) ? "mm" : "in", nominal });
    }
  }
  const sizes = new Map(found.map((size) => [sizeKey(size), size]));
  if (sizes.size !== 1) return null;
  const size = [...sizes.values()][0]!;
  if (size.unit === "in" ? size.nominal > 72 : size.nominal < 6 || size.nominal > 2000)
    return null;
  return size;
}

export function pipeSizeTags(texts: readonly PipeDrawingText[]): PipeSizeTag[] {
  const tags: PipeSizeTag[] = [];
  for (const text of texts.slice(0, 30_000)) {
    if (!(text.bottom > text.top) || !(text.right > text.left)) continue;
    const size = parsePipeSize(text.text);
    if (!size) continue;
    const systems = [...text.text.matchAll(SYSTEM_WORD)].map((m) => m[0].toUpperCase());
    tags.push({ ...text, size, systems });
  }
  return tags;
}

type Point = { x: number; y: number };

class Heap<T> {
  private items: T[] = [];
  constructor(private before: (a: T, b: T) => number) {}
  get size() {
    return this.items.length;
  }
  push(item: T) {
    const items = this.items;
    items.push(item);
    for (let i = items.length - 1; i > 0; ) {
      const up = (i - 1) >> 1;
      if (this.before(items[i]!, items[up]!) >= 0) break;
      [items[i], items[up]] = [items[up]!, items[i]!];
      i = up;
    }
  }
  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length && last !== undefined) {
      items[0] = last;
      for (let i = 0; ; ) {
        const l = i * 2 + 1,
          r = l + 1;
        let m = i;
        if (l < items.length && this.before(items[l]!, items[m]!) < 0) m = l;
        if (r < items.length && this.before(items[r]!, items[m]!) < 0) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m]!, items[i]!];
        i = m;
      }
    }
    return top;
  }
}
function rectDistance(tag: PipeDrawingText, s: PipeSegment, aspect: number) {
  // Sample the segment against the box; exact enough for nearby labels.
  const a = { x: s.x1, y: s.y1 * aspect },
    b = { x: s.x2, y: s.y2 * aspect };
  const box = { l: tag.left, r: tag.right, t: tag.top * aspect, b: tag.bottom * aspect };
  const inside = (p: Point) => Math.hypot(Math.max(box.l - p.x, 0, p.x - box.r), Math.max(box.t - p.y, 0, p.y - box.b));
  const center = { x: (box.l + box.r) / 2, y: (box.t + box.b) / 2 };
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((center.x - a.x) * dx + (center.y - a.y) * dy) / l2)) : 0;
  return Math.min(inside(a), inside(b), inside({ x: a.x + t * dx, y: a.y + t * dy }));
}

/**
 * Split a selected pipe by the sizes printed beside it. Each tag sizes its
 * nearest selected line; sizes then follow the pipe through bends and straight
 * through tees, never into branches, and the nearest tag along the pipe wins.
 */
export function pipeRunSizes(
  selection: Pick<PipeSystemSelection, "segments" | "system">,
  tags: readonly PipeSizeTag[],
  aspect: number,
): PipeSizeBreakdown {
  const segments = selection.segments.slice(0, 20_000);
  const metric = (s: PipeSegment) => ({
    a: { x: s.x1, y: s.y1 * aspect },
    b: { x: s.x2, y: s.y2 * aspect },
  });
  const ends = segments.map(metric);
  const lengths = ends.map(({ a, b }) => Math.hypot(b.x - a.x, b.y - a.y));
  // Join line ends that meet; bucket by a coarse grid.
  const cell = (p: Point) => [Math.floor(p.x / JOIN), Math.floor(p.y / JOIN)] as const;
  const grid = new Map<string, number[]>();
  const nodeOf: number[][] = segments.map(() => []);
  const nodePoints: Point[] = [];
  const nodeFor = (p: Point) => {
    const [cx, cy] = cell(p);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const id of grid.get(`${cx + dx},${cy + dy}`) ?? [])
          if (Math.hypot(nodePoints[id]!.x - p.x, nodePoints[id]!.y - p.y) <= JOIN) return id;
    nodePoints.push(p);
    const key = `${cx},${cy}`;
    const bucket = grid.get(key) ?? [];
    bucket.push(nodePoints.length - 1);
    grid.set(key, bucket);
    return nodePoints.length - 1;
  };
  const atNode = new Map<number, number[]>();
  ends.forEach(({ a, b }, i) => {
    for (const p of [a, b]) {
      const node = nodeFor(p);
      nodeOf[i]!.push(node);
      const list = atNode.get(node) ?? [];
      list.push(i);
      atNode.set(node, list);
    }
  });
  const direction = (i: number, node: number) => {
    // Unit vector pointing away from `node` along segment i.
    const { a, b } = ends[i]!;
    const from = nodeOf[i]![0] === node ? a : b,
      to = from === a ? b : a;
    const l = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return { x: (to.x - from.x) / l, y: (to.y - from.y) / l };
  };
  const passes = (from: number, to: number, node: number) => {
    const touching = atNode.get(node)!;
    if (touching.length <= 2) return true;
    const a = direction(from, node),
      b = direction(to, node);
    return a.x * b.x + a.y * b.y <= -STRAIGHT;
  };

  const system = selection.system?.toUpperCase();
  const seeds = new Map<number, { size: PipeSize; distance: number }>();
  let tagCount = 0;
  for (const tag of tags) {
    // A tag naming another system belongs to a neighbouring pipe.
    const named = tag.systems.filter((code) => code in PIPE_SYSTEM_NAMES);
    if (system && named.length && !named.includes(system)) continue;
    const height = (tag.bottom - tag.top) * aspect;
    const limit = Math.max(height * 2.5, 0.004);
    let best = -1,
      bestDistance = limit;
    segments.forEach((s, i) => {
      if (
        Math.min(s.x1, s.x2) > tag.right + limit ||
        Math.max(s.x1, s.x2) < tag.left - limit ||
        Math.min(s.y1, s.y2) * aspect > tag.bottom * aspect + limit ||
        Math.max(s.y1, s.y2) * aspect < tag.top * aspect - limit
      )
        return;
      const d = rectDistance(tag, s, aspect);
      if (d <= bestDistance) [best, bestDistance] = [i, d];
    });
    if (best < 0) continue;
    tagCount++;
    const old = seeds.get(best);
    if (!old || bestDistance < old.distance) seeds.set(best, { size: tag.size, distance: bestDistance });
  }

  // Multi-source Dijkstra by distance along the pipe.
  const owner: (PipeSize | null)[] = segments.map(() => null);
  const best = segments.map(() => Infinity);
  const queue = new Heap<{ i: number; d: number; size: PipeSize }>((a, b) => a.d - b.d);
  for (const [i, seed] of seeds) {
    best[i] = 0;
    owner[i] = seed.size;
    queue.push({ i, d: 0, size: seed.size });
  }
  while (queue.size) {
    const { i, d, size } = queue.pop()!;
    if (d > best[i]!) continue;
    for (const node of nodeOf[i]!)
      for (const j of atNode.get(node) ?? []) {
        if (j === i || !passes(i, j, node)) continue;
        const next = d + lengths[i]! / 2 + lengths[j]! / 2;
        if (next >= best[j]!) continue;
        best[j] = next;
        owner[j] = size;
        queue.push({ i: j, d: next, size });
      }
  }

  const groups = new Map<string, { size: PipeSize | null; segments: PipeSegment[] }>();
  const segmentSizes = new Map<string, PipeSize>();
  segments.forEach((s, i) => {
    const size = owner[i] ?? null;
    if (size) segmentSizes.set(s.id, size);
    const key = size ? sizeKey(size) : "unknown";
    const group = groups.get(key) ?? { size, segments: [] };
    group.segments.push(s);
    groups.set(key, group);
  });
  const runs = [...groups.values()]
    .map((group) => ({ size: group.size, lengthInSheetWidths: unionLength(group.segments, aspect) }))
    .filter((run) => run.lengthInSheetWidths > 0)
    .sort((a, b) =>
      !a.size ? 1 : !b.size ? -1 : b.size.nominal - a.size.nominal,
    );
  return { runs, segmentSizes, tagCount };
}

/** The size of the selected pipe nearest a fitting, for unlabeled fittings. */
export function nearestPipeSize(
  point: Point,
  selection: Pick<PipeSystemSelection, "segments">,
  sizes: Map<string, PipeSize>,
  aspect: number,
) {
  let found: PipeSize | null = null,
    nearest = 0.01;
  for (const s of selection.segments) {
    const size = sizes.get(s.id);
    if (!size) continue;
    const d = rectDistance(
      { text: "", left: point.x, right: point.x, top: point.y, bottom: point.y },
      s,
      aspect,
    );
    if (d < nearest) [found, nearest] = [size, d];
  }
  return found;
}

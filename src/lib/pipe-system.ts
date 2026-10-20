import type { PipeSymbolPath, PipeDrawingText } from "./pipe-components-types";
import type { SheetPoint } from "./sheet-measure";
import type { SnapSegment } from "./sheet-snap";
import { pipeTagLeaderPaths } from "./pipe-tag-leaders";

/** PDF geometry in sheet coordinates; stroke dimensions are in sheet-widths. */
export type PipeSegment = SnapSegment & {
  id: string;
  pathId: string;
  stroke: string;
  width: number;
  dash: number[];
  layer?: string;
  closed?: boolean;
};

export type PipeLabel = {
  text: string;
  system: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Text baseline in sheet coordinates; bounding boxes lose rotated orientation. */
  direction?: SheetPoint;
};

export type PipeLinework = {
  symbols?: PipeSymbolPath[];
  texts?: PipeDrawingText[];
  componentDataVersion?: 1 | 2 | 3;
  componentDataPartial?: boolean;
  segments: PipeSegment[];
  labels: PipeLabel[];
  /** Sheet height divided by sheet width. */
  aspect: number;
  truncated: boolean;
  warnings?: string[];
};

export type PipeSystemSelection = {
  /** Confirmed annotation paths omitted from highlighting and fitting analysis. */
  excludedAnnotationPathIds?: string[];
  source?: "layer";
  system: string | null;
  segments: PipeSegment[];
  lengthInSheetWidths: number;
  warnings: string[];
  truncated: boolean;
};

type MetricPoint = { x: number; y: number };
type Edge = { to: number; bridge?: PipeSegment };
type LabelBinding = { label: PipeLabel; segments: number[] };

/** The index is reusable between clicks; connectivity does not depend on zoom. */
export type PipeSystemIndex = {
  linework: PipeLinework;
  segments: PipeSegment[];
  labels: PipeLabel[];
  aspect: number;
  truncated: boolean;
  warnings: string[];
  /** Internal caches are exposed for serialization-free, inexpensive reuse. */
  buckets: Map<string, number[]>;
  styleBuckets: Map<string, Map<string, number[]>>;
  styles: Map<string, PipeSegment>;
  segmentStyles: string[];
  compatibleStyles: Map<string, string[]>;
  partialStyles: Set<string>;
  partialStyleCells: Map<string, Set<string>>;
  partialQueryStyles: Set<string>;
  partialNeighbors: Set<number>;
  selectionPartial: boolean;
  building: boolean;
  cells: Map<number, string[]>;
  bindings: LabelBinding[];
  segmentSystems: Map<number, Set<string>>;
  systemBuckets: Map<string, Map<string, number[]>>;
  labelReach: Map<number, number>;
  excluded: Set<number>;
  annotationPaths: Set<string>;
  neighbors: Map<number, Edge[]>;
  work: number;
};

const CELL = 0.02;
const JOIN = 0.00015;
const COLLINEAR = 0.00001;
const MAX_BRIDGE = 0.075;
const MAX_SEGMENTS = 200_000;
const MAX_LABELS = 8_000;
const MAX_BUCKET = 512;
const MAX_QUERY = 2_048;
const MAX_WORK = 4_000_000;
const MAX_SELECTION = 20_000;
const EPSILON = 1e-9;
const CHECK_WARNING = "Trace follows matching PDF linework. Check branches, crossings, and drawing symbols before using the total.";
const PARTIAL_WARNING = "Drawing complexity exceeded the tracing limit. Highlight and length are partial.";

function metric(point: SheetPoint, aspect: number): MetricPoint {
  return { x: point.x, y: point.y * aspect };
}

function ends(segment: PipeSegment, aspect: number): [MetricPoint, MetricPoint] {
  return [
    { x: segment.x1, y: segment.y1 * aspect },
    { x: segment.x2, y: segment.y2 * aspect },
  ];
}

function distance(a: MetricPoint, b: MetricPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function segmentLength(segment: PipeSegment, aspect: number) {
  return Math.hypot(segment.x2 - segment.x1, (segment.y2 - segment.y1) * aspect);
}

function project(point: MetricPoint, segment: PipeSegment, aspect: number) {
  const [a, b] = ends(segment, aspect);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const unbounded = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
  const t = Math.max(0, Math.min(1, unbounded));
  const nearest = { x: a.x + t * dx, y: a.y + t * dy };
  return { distance: distance(point, nearest), t, unbounded, nearest };
}

function validSegment(segment: PipeSegment) {
  return (
    [segment.x1, segment.y1, segment.x2, segment.y2, segment.width].every(Number.isFinite) &&
    segment.width >= 0 &&
    [segment.x1, segment.y1, segment.x2, segment.y2].every((value) => value >= 0 && value <= 1) &&
    (segment.x1 !== segment.x2 || segment.y1 !== segment.y2) &&
    typeof segment.id === "string" &&
    typeof segment.pathId === "string" &&
    typeof segment.stroke === "string" &&
    Array.isArray(segment.dash) &&
    segment.dash.length <= 64 &&
    segment.dash.every((value) => Number.isFinite(value) && value >= 0)
  );
}

function normalSystem(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

function validLabel(label: PipeLabel) {
  return (
    typeof label.text === "string" &&
    typeof label.system === "string" &&
    normalSystem(label.system).length > 0 &&
    normalSystem(label.system).length <= 24 &&
    [label.left, label.top, label.right, label.bottom].every(Number.isFinite) &&
    label.left >= 0 && label.top >= 0 && label.right <= 1 && label.bottom <= 1 &&
    label.left <= label.right && label.top <= label.bottom
  );
}

function warn(index: PipeSystemIndex, value: string) {
  if (!index.warnings.includes(value)) index.warnings.push(value);
}

function limited(index: PipeSystemIndex) {
  index.truncated = true;
  index.linework.truncated = true;
  warn(index, PARTIAL_WARNING);
}

function runtimeLimit(index: PipeSystemIndex) {
  if (index.building) limited(index);
  else index.selectionPartial = true;
}

function key(x: number, y: number) {
  return `${x},${y}`;
}

function styleKey(segment: PipeSegment) {
  return JSON.stringify([
    segment.stroke.trim().toLowerCase(),
    segment.width.toPrecision(3),
    segment.dash.map((value) => value.toPrecision(3)),
    segment.layer ?? "",
  ]);
}

function compatibleStyleKeys(index: PipeSystemIndex, segment: PipeSegment) {
  const sourceKey = styleKey(segment);
  let compatible = index.compatibleStyles.get(sourceKey);
  if (!compatible) {
    compatible = [];
    for (const [key, other] of index.styles) {
      if (++index.work > MAX_WORK) { runtimeLimit(index); break; }
      if (sameStyle(segment, other)) compatible.push(key);
    }
    index.compatibleStyles.set(sourceKey, compatible);
  }
  return compatible;
}

/** Walk cells touched by a line, rather than indexing its whole bounding box. */
function addToGrid(index: PipeSystemIndex, segment: PipeSegment, id: number) {
  const [a, b] = ends(segment, index.aspect);
  let x = Math.floor(a.x / CELL);
  let y = Math.floor(a.y / CELL);
  const lastX = Math.floor(b.x / CELL);
  const lastY = Math.floor(b.y / CELL);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  let nextX = dx === 0 ? Infinity : ((stepX > 0 ? x + 1 : x) * CELL - a.x) / dx;
  let nextY = dy === 0 ? Infinity : ((stepY > 0 ? y + 1 : y) * CELL - a.y) / dy;
  const deltaX = dx === 0 ? Infinity : CELL / Math.abs(dx);
  const deltaY = dy === 0 ? Infinity : CELL / Math.abs(dy);
  const maximum = Math.abs(lastX - x) + Math.abs(lastY - y) + 3;
  const cells: string[] = [];
  const segmentStyle = styleKey(segment);
  index.segmentStyles[id] = segmentStyle;
  index.styles.set(segmentStyle, segment);
  const styleBuckets = index.styleBuckets.get(segmentStyle) ?? new Map<string, number[]>();
  index.styleBuckets.set(segmentStyle, styleBuckets);
  for (let step = 0; step < maximum; step++) {
    if (++index.work > MAX_WORK) { limited(index); break; }
    const bucketKey = key(x, y);
    cells.push(bucketKey);
    const styleBucket = styleBuckets.get(bucketKey) ?? [];
    if (styleBucket.length < MAX_BUCKET) {
      styleBucket.push(id);
      const bucket = index.buckets.get(bucketKey) ?? [];
      bucket.push(id);
      index.buckets.set(bucketKey, bucket);
    } else {
      index.partialStyles.add(segmentStyle);
      const partial = index.partialStyleCells.get(segmentStyle) ?? new Set<string>();
      partial.add(bucketKey);
      index.partialStyleCells.set(segmentStyle, partial);
    }
    styleBuckets.set(bucketKey, styleBucket);
    if (x === lastX && y === lastY) break;
    if (nextX < nextY) {
      x += stepX;
      nextX += deltaX;
    } else {
      y += stepY;
      nextY += deltaY;
    }
  }
  index.cells.set(id, cells);
}

function query(index: PipeSystemIndex, point: MetricPoint, radius: number, source?: PipeSegment): number[] {
  const found = new Set<number>();
  const minX = Math.floor((point.x - radius) / CELL);
  const maxX = Math.floor((point.x + radius) / CELL);
  const minY = Math.floor((point.y - radius) / CELL);
  const maxY = Math.floor((point.y + radius) / CELL);
  if (!source) {
    const counts = new Map<string, Set<number>>();
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (const id of index.buckets.get(key(x, y)) ?? []) {
          if (++index.work > MAX_WORK) { runtimeLimit(index); return [...found]; }
          const style = index.segmentStyles[id]!;
          const perStyle = counts.get(style) ?? new Set<number>();
          counts.set(style, perStyle);
          if (perStyle.size >= MAX_QUERY && !perStyle.has(id)) {
            index.partialQueryStyles.add(style);
            continue;
          }
          perStyle.add(id);
          found.add(id);
        }
      }
    }
    return [...found];
  }
  const styles = compatibleStyleKeys(index, source);
  for (const style of styles) {
    const perStyle = new Set<number>();
    const styleBuckets = index.styleBuckets.get(style)!;
    let bounded = false;
    for (let x = minX; x <= maxX && !bounded; x++) {
      for (let y = minY; y <= maxY && !bounded; y++) {
        if (index.partialStyleCells.get(style)?.has(key(x, y))) index.selectionPartial = true;
        for (const id of styleBuckets.get(key(x, y)) ?? []) {
          if (++index.work > MAX_WORK) { runtimeLimit(index); return [...found]; }
          if (perStyle.size >= MAX_QUERY) {
            index.partialQueryStyles.add(style);
            bounded = true;
            break;
          }
          perStyle.add(id);
          found.add(id);
        }
      }
    }
  }
  return [...found];
}

function similarScalar(a: number, b: number) {
  if (a === b) return true;
  return a > 0 && b > 0 && Math.max(a, b) / Math.min(a, b) <= 1.35;
}

function sameStyle(a: PipeSegment, b: PipeSegment) {
  if (a.stroke.trim().toLowerCase() !== b.stroke.trim().toLowerCase()) return false;
  if (a.layer && b.layer && a.layer !== b.layer) return false;
  if (!similarScalar(a.width, b.width) || a.dash.length !== b.dash.length) return false;
  return a.dash.every((value, i) => similarScalar(value, b.dash[i]!));
}

function confirmedSameSystem(index: PipeSystemIndex, a: number, b: number) {
  const first = index.segmentSystems.get(a);
  const second = index.segmentSystems.get(b);
  if (first?.size !== 1 || second?.size !== 1 || ![...first].some((code) => second.has(code))) return false;
  const firstSegment = index.segments[a]!;
  const secondSegment = index.segments[b]!;
  return firstSegment.stroke.trim().toLowerCase() === secondSegment.stroke.trim().toLowerCase() &&
    !(firstSegment.layer && secondSegment.layer && firstSegment.layer !== secondSegment.layer);
}

function collinear(a: PipeSegment, b: PipeSegment, aspect: number, tolerance = COLLINEAR) {
  const [start, end] = ends(a, aspect);
  const length = distance(start, end);
  const [p, q] = ends(b, aspect);
  const lineDistance = (point: MetricPoint) => Math.abs(
    (point.x - start.x) * (end.y - start.y) - (point.y - start.y) * (end.x - start.x),
  ) / length;
  return lineDistance(p) <= tolerance && lineDistance(q) <= tolerance;
}

function connectionCollinear(index: PipeSystemIndex, a: number, b: number) {
  const first = index.segments[a]!, second = index.segments[b]!;
  // Angled CAD dashes are rounded separately. Bound that error by a fraction
  // of the source stroke; never move geometry or merge nearby parallel lanes.
  const tolerance = layerSystem(first.layer) && confirmedSameSystem(index, a, b)
    ? Math.max(COLLINEAR, Math.min(JOIN, Math.min(first.width, second.width) * 0.25)) : COLLINEAR;
  // Short CAD dash pieces have less reliable tangents after coordinate
  // rounding. Native layer evidence lets either interval support the join;
  // this also keeps dash connectivity independent of the click direction.
  return collinear(first, second, index.aspect, tolerance) ||
    tolerance > COLLINEAR && collinear(second, first, index.aspect, tolerance);
}

function labelBox(label: PipeLabel, aspect: number) {
  const width = label.right - label.left;
  const height = (label.bottom - label.top) * aspect;
  return {
    center: { x: (label.left + label.right) / 2, y: (label.top + label.bottom) * aspect / 2 },
    width,
    height,
    horizontal: width >= height,
    radius: Math.min(MAX_BRIDGE, Math.max(0.004, Math.hypot(width, height) / 2 + Math.min(0.0225, Math.min(width, height) * 1.3))),
  };
}

function labelParallel(label: PipeLabel, segment: PipeSegment, aspect: number) {
  const box = labelBox(label, aspect);
  const dx = segment.x2 - segment.x1;
  const dy = (segment.y2 - segment.y1) * aspect;
  const direction = label.direction;
  if (direction && Number.isFinite(direction.x) && Number.isFinite(direction.y)) {
    const length = Math.hypot(direction.x, direction.y * aspect) * Math.hypot(dx, dy);
    if (length > 1e-12) return Math.abs(direction.x * dx + direction.y * aspect * dy) / length >= Math.cos(Math.PI / 12);
  }
  return box.horizontal ? Math.abs(dy) <= Math.abs(dx) * 0.25 : Math.abs(dx) <= Math.abs(dy) * 0.25;
}


/** Conservative CAD discipline names are stronger than a nearby annotation. */
export function layerSystem(layer?: string): string | null {
  if (!layer) return null;
  if (/(?:^|[|])M[-_]FIRE[-_]PIPE(?:[-_]|$)/i.test(layer)) return "FIRE";
  if (/(?:^|[|])M[-_]FUEL[-_]GAS(?:[-_]|$)/i.test(layer)) return "GAS";
  const match = /(?:^|[-_| ])(?:PLMB|PIPE|PIPING|HYDR|P)[-_| ](.+)$/i.exec(layer);
  if (!match) return null;
  // Status/location suffixes do not erase the source system assignment.
  const code = match[1]!.toUpperCase().replace(/(?:[-_| ](?:BELW|ABOV|EXST|DEMO|NEW))+$/, "");
  const aliases: Record<string, string> = { SANI: "SAN", SANITARY: "SAN", STRM: "ST", STORM: "ST", DCWT: "DCW", DHWT: "DHW", CHS: "CHWS", CHR: "CHWR", CWS: "CWS", CWR: "CWR", "RFRG-SPLY": "RFRG-SPLY", "RFRG-RTRN": "RFRG-RTRN", "RFRG-RETN": "RFRG-RTRN" };
  return aliases[code] ?? (/^(ST|SAN|CW|HW|HWR|DCW|DHW|DHWR|RW|RWL|SW|FW|CHWS|CHWR|HWS|MWS|MWR|NG|LPG|GAS|CD|COND|SD|PD|VENT)$/.test(code) ? code : null);
}

export const PIPE_SYSTEM_NAMES: Record<string, string> = {
  SAN: "Sanitary", VENT: "Vent", ST: "Storm", DCW: "Domestic cold water",
  DHW: "Domestic hot water", DHWR: "Domestic hot-water return",
  HWS: "Heating water supply", HWR: "Heating water return",
  CHWS: "Chilled water supply", CHWR: "Chilled water return",
  CWS: "Condenser water supply", CWR: "Condenser water return",
  GAS: "Gas", FIRE: "Fire piping", "RFRG-SPLY": "Refrigerant supply", "RFRG-RTRN": "Refrigerant return",
};

export function pipeLayerCodes(linework: PipeLinework): string[] {
  return [...new Set(linework.segments.map(segment => layerSystem(segment.layer)).filter((code): code is string => Boolean(code)))].sort();
}

/** Exact source-layer membership, including disconnected runs on the sheet. */
export function selectPipeLayerSystem(linework: PipeLinework, system: string): PipeSystemSelection {
  const annotationPaths = pipeTagLeaderPaths(linework);
  const segments = linework.segments.filter(segment => layerSystem(segment.layer) === system && !annotationPaths.has(segment.pathId));
  return {
    ...(annotationPaths.size ? { excludedAnnotationPathIds: [...annotationPaths] } : {}),
    source: "layer", system, segments,
    lengthInSheetWidths: unionLength(segments, linework.aspect),
    truncated: linework.truncated,
    warnings: [...(linework.warnings ?? []), ...(linework.truncated ? [PARTIAL_WARNING] : []), "Length covers the highlighted PDF linework, including any symbols on the system layer."],
  };
}

function annotationLayer(layer?: string) {
  return Boolean(layer && (
    /(?:^|[|])A[-_]/i.test(layer) ||
    /(?:^|[-_| ])(?:ANNO|NOTE|TEXT|TTLB|TITLE|WALL|DOOR|FURN|MASK|GRID)(?:[-_| ]|$)/i.test(layer)
  ));
}

function bindLabels(index: PipeSystemIndex) {
  for (const label of index.labels) {
    const box = labelBox(label, index.aspect);
    const nearby = query(index, box.center, box.radius)
      .map((id) => ({ id, hit: project(box.center, index.segments[id]!, index.aspect) }))
      .filter(({ id, hit }) => {
        const segment = index.segments[id]!;
        // Text strokes, arrowheads and fitting glyphs must not become a system
        // simply because they are the closest tiny stroke to its label.
        return !index.excluded.has(id) && !annotationLayer(segment.layer) &&
          (!layerSystem(segment.layer) || layerSystem(segment.layer) === label.system) && hit.distance <= box.radius &&
          segmentLength(segment, index.aspect) >= Math.min(0.0015, Math.min(box.width, box.height) * 0.5) &&
          !(segment.closed && segment.width === 0);
      })
      .sort((a, b) => a.hit.distance - b.hit.distance);
    const parallel = nearby.filter(({ id }) => labelParallel(label, index.segments[id]!, index.aspect));
    // CAD labels beside vertical pipes can remain horizontal. Prefer a nearby
    // parallel candidate; a bounded perpendicular candidate is a fallback.
    const candidates = parallel.length > 0 ? parallel : nearby;
    const first = candidates.find(({ id }) => layerSystem(index.segments[id]!.layer) === label.system) ??
      candidates.find(({ id }) => index.segments[id]!.stroke.toLowerCase() === "#000000") ?? candidates[0];
    if (!first) {
      index.bindings.push({ label, segments: [] });
      continue;
    }
    const seed = index.segments[first.id]!;
    const bound = candidates.filter(({ id, hit }) => {
      const segment = index.segments[id]!;
      if (!sameStyle(seed, segment) || !collinear(seed, segment, index.aspect)) return false;
      // Associate only the nearest supporting line, including the two sides of
      // an inline label. Nearby parallel pipes never inherit the same label.
      return hit.distance <= first.hit.distance + Math.max(JOIN, Math.min(0.004, box.height / 2));
    }).map(({ id }) => id);
    for (const id of bound) {
      const codes = index.segmentSystems.get(id) ?? new Set<string>();
      codes.add(label.system);
      index.segmentSystems.set(id, codes);
      index.labelReach.set(id, Math.max(index.labelReach.get(id) ?? 0, Math.min(MAX_BRIDGE, box.radius * 2)));
    }
    index.bindings.push({ label, segments: bound });
  }
}


function excludeRectangles(index: PipeSystemIndex) {
  const paths = new Map<string, number[]>();
  index.segments.forEach((segment, id) => {
    if (!segment.closed) return;
    const path = paths.get(segment.pathId) ?? [];
    path.push(id);
    paths.set(segment.pathId, path);
  });
  for (const ids of paths.values()) {
    if (ids.length !== 4 || ids.some((id) => index.segmentSystems.has(id))) continue;
    const corners = new Set<string>();
    let horizontal = 0;
    let vertical = 0;
    for (const id of ids) {
      const segment = index.segments[id]!;
      const [a, b] = ends(segment, index.aspect);
      corners.add(`${Math.round(a.x / COLLINEAR)},${Math.round(a.y / COLLINEAR)}`);
      corners.add(`${Math.round(b.x / COLLINEAR)},${Math.round(b.y / COLLINEAR)}`);
      if (Math.abs(a.y - b.y) <= COLLINEAR) horizontal++;
      if (Math.abs(a.x - b.x) <= COLLINEAR) vertical++;
    }
    if (corners.size === 4 && horizontal === 2 && vertical === 2) {
      for (const id of ids) index.excluded.add(id);
    }
  }
}

function indexConfirmedSystems(index: PipeSystemIndex) {
  for (const [id, codes] of index.segmentSystems) {
    if (index.excluded.has(id)) continue;
    for (const code of codes) {
      const buckets = index.systemBuckets.get(code) ?? new Map<string, number[]>();
      for (const cell of index.cells.get(id) ?? []) {
        const bucket = buckets.get(cell) ?? [];
        if (bucket.length < MAX_BUCKET) bucket.push(id);
        else {
          const style = index.segmentStyles[id]!;
          const partial = index.partialStyleCells.get(style) ?? new Set<string>();
          partial.add(cell);
          index.partialStyleCells.set(style, partial);
        }
        buckets.set(cell, bucket);
      }
      index.systemBuckets.set(code, buckets);
    }
  }
}

/** Build bounded spatial lookup. Graph edges are computed lazily for the clicked system. */
export function buildPipeSystemIndex(linework: PipeLinework): PipeSystemIndex {
  const validAspect = Number.isFinite(linework.aspect) && linework.aspect >= 0.01 && linework.aspect <= 100;
  const valid = validAspect ? linework.segments.filter(validSegment) : [];
  const index: PipeSystemIndex = {
    linework: { segments: [], labels: [], aspect: validAspect ? linework.aspect : 1, truncated: linework.truncated },
    segments: valid.slice(0, MAX_SEGMENTS),
    labels: validAspect ? linework.labels.filter(validLabel).slice(0, MAX_LABELS).map((label) => ({ ...label, system: normalSystem(label.system) })) : [],
    aspect: validAspect ? linework.aspect : 1,
    truncated: linework.truncated || valid.length > MAX_SEGMENTS || linework.labels.length > MAX_LABELS,
    warnings: [...new Set(linework.warnings ?? [])],
    buckets: new Map(),
    styleBuckets: new Map(),
    styles: new Map(),
    segmentStyles: [],
    compatibleStyles: new Map(),
    partialStyles: new Set(),
    partialStyleCells: new Map(),
    partialQueryStyles: new Set(),
    partialNeighbors: new Set(),
    selectionPartial: false,
    building: true,
    cells: new Map(),
    bindings: [],
    segmentSystems: new Map(),
    systemBuckets: new Map(),
    labelReach: new Map(),
    excluded: new Set(),
    annotationPaths: new Set(),
    neighbors: new Map(),
    work: 0,
  };
  index.linework = { ...linework, segments: index.segments, labels: index.labels, aspect: index.aspect, truncated: index.truncated, warnings: index.warnings };
  if (!validAspect) warn(index, "The drawing has no usable page dimensions.");
  if (valid.length !== linework.segments.length) warn(index, "Invalid or out-of-page linework was skipped.");
  if (index.truncated) warn(index, PARTIAL_WARNING);
  index.segments.forEach((segment, id) => addToGrid(index, segment, id));
  const annotationPaths = pipeTagLeaderPaths(index.linework);
  index.annotationPaths = annotationPaths;
  index.segments.forEach((segment, id) => {
    const system = layerSystem(segment.layer);
    if (system) index.segmentSystems.set(id, new Set([system]));
    if (annotationLayer(segment.layer) || annotationPaths.has(segment.pathId)) index.excluded.add(id);
  });
  bindLabels(index);
  excludeRectangles(index);
  indexConfirmedSystems(index);
  index.work = 0;
  index.building = false;
  index.partialQueryStyles.clear();
  return index;
}

function makeBridge(a: PipeSegment, b: PipeSegment, p: MetricPoint, q: MetricPoint, aspect: number): PipeSegment {
  return {
    ...a,
    id: `pipe-bridge:${[a.id, b.id].sort().join(":")}`,
    pathId: `pipe-bridge:${[a.pathId, b.pathId].sort().join(":")}`,
    x1: p.x,
    y1: p.y / aspect,
    x2: q.x,
    y2: q.y / aspect,
    closed: false,
  };
}

function labelInGap(index: PipeSystemIndex, a: number, b: number, p: MetricPoint, q: MetricPoint) {
  const aCodes = index.segmentSystems.get(a);
  const bCodes = index.segmentSystems.get(b);
  if (!aCodes || !bCodes || ![...aCodes].some((code) => bCodes.has(code))) return false;
  const middle = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  return index.bindings.some((binding) => {
    if (!binding.segments.includes(a) || !binding.segments.includes(b)) return false;
    const { center, width, height } = labelBox(binding.label, index.aspect);
    return distance(center, middle) <= Math.hypot(width, height) / 2 + JOIN;
  });
}

function touching(a: PipeSegment, b: PipeSegment, aspect: number) {
  const [p, q] = ends(a, aspect);
  const [r, s] = ends(b, aspect);
  // Adjacent subdivisions of a curve (and shallow pipe elbows) share an exact
  // endpoint. They must join even when their tangents are almost parallel.
  if (Math.min(distance(p, r), distance(p, s), distance(q, r), distance(q, s)) <= COLLINEAR) return true;
  const cosine = Math.abs(((q.x - p.x) * (s.x - r.x) + (q.y - p.y) * (s.y - r.y)) / distance(p, q) / distance(r, s));
  if (cosine >= 0.98 && !collinear(a, b, aspect)) return false;
  return [p, q].some((point) => project(point, b, aspect).distance <= JOIN) ||
    [r, s].some((point) => project(point, a, aspect).distance <= JOIN);
}

function manualDashPattern(index: PipeSystemIndex, a: number, b: number, gap: number, candidates: number[]) {
  const first = index.segments[a]!;
  const second = index.segments[b]!;
  const firstLength = segmentLength(first, index.aspect);
  const secondLength = segmentLength(second, index.aspect);
  const native = Boolean(layerSystem(first.layer) && confirmedSameSystem(index, a, b));
  if (first.dash.length !== 0 || gap > 0.012 || gap < JOIN ||
    firstLength < 0.0004 || firstLength > 0.03 || secondLength < 0.0004 || secondLength > 0.03 ||
    (!native && !similarScalar(firstLength, secondLength)) || gap > Math.min(firstLength, secondLength) * 1.5) return false;
  const endpoints = [...ends(first, index.aspect), ...ends(second, index.aspect)];
  const supports = (id: number) => {
    if (id === a || id === b || index.excluded.has(id)) return false;
    const third = index.segments[id]!;
    if (!sameStyle(first, third) || !connectionCollinear(index, a, id) ||
      (native ? !confirmedSameSystem(index, a, id) || segmentLength(third, index.aspect) < 0.0004 || segmentLength(third, index.aspect) > 0.03
        : !similarScalar(firstLength, segmentLength(third, index.aspect)))) return false;
    const otherEndpoints = ends(third, index.aspect);
    const thirdGap = Math.min(...endpoints.flatMap((point) => otherEndpoints.map((other) => distance(point, other))));
    return thirdGap > JOIN && Math.abs(thirdGap - gap) <= Math.max(JOIN, gap * 0.25);
  };
  if (candidates.some(supports)) return true;
  // The supporting third dash can lie beyond the far end of either interval.
  // Look at both outside ends, so the graph is the same from every dash click.
  const [start, end] = ends(first, index.aspect);
  const ux = (end.x - start.x) / firstLength;
  const uy = (end.y - start.y) / firstLength;
  endpoints.sort((a, b) => a.x * ux + a.y * uy - b.x * ux - b.y * uy);
  return [endpoints[0]!, endpoints[endpoints.length - 1]!].some((endpoint) =>
    query(index, endpoint, Math.min(0.016, gap * 1.25 + JOIN), first).some(supports),
  );
}

function graphNeighbors(index: PipeSystemIndex, id: number): Edge[] {
  const cached = index.neighbors.get(id);
  if (cached) {
    if (index.partialNeighbors.has(id)) index.selectionPartial = true;
    return cached;
  }
  const segment = index.segments[id]!;
  const endpoints = ends(segment, index.aspect);
  const found = new Map<number, Edge>();
  const gapReach = Math.max(0.012, index.labelReach.get(id) ?? 0);
  const compatible = compatibleStyleKeys(index, segment);
  const codes = index.segmentSystems.get(id);
  let partial = false;
  const contactCandidates = new Set<number>();
  // Checking the whole line is essential: a branch endpoint can join the
  // middle of this line even though neither of this line's endpoints is near it.
  contactScan: for (const cell of index.cells.get(id) ?? []) {
    const [x, y] = cell.split(",").map(Number) as [number, number];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const style of compatible) {
          if (index.partialStyleCells.get(style)?.has(key(x + dx, y + dy))) partial = true;
          for (const candidate of index.styleBuckets.get(style)!.get(key(x + dx, y + dy)) ?? []) {
            if (++index.work > MAX_WORK) { runtimeLimit(index); partial = true; break contactScan; }
            if (contactCandidates.size >= MAX_QUERY * 4) {
              partial = true;
              break contactScan;
            }
            contactCandidates.add(candidate);
          }
        }
        for (const code of codes ?? []) {
          for (const candidate of index.systemBuckets.get(code)?.get(key(x + dx, y + dy)) ?? []) {
            if (++index.work > MAX_WORK) { runtimeLimit(index); partial = true; break contactScan; }
            if (contactCandidates.size >= MAX_QUERY * 4) { partial = true; break contactScan; }
            contactCandidates.add(candidate);
          }
        }
      }
    }
  }
  for (const otherId of contactCandidates) {
    if (otherId === id || index.excluded.has(otherId)) continue;
    const other = index.segments[otherId]!;
    if ((sameStyle(segment, other) || confirmedSameSystem(index, id, otherId)) && touching(segment, other, index.aspect)) found.set(otherId, { to: otherId });
  }
  for (const endpoint of endpoints) {
    const nearby = query(index, endpoint, gapReach, segment);
    if (index.work > MAX_WORK || compatible.some((style) => index.partialQueryStyles.has(style))) partial = true;
    const gaps: { id: number; endpoint: MetricPoint; gap: number }[] = [];
    for (const otherId of nearby) {
      if (otherId === id || index.excluded.has(otherId)) continue;
      const other = index.segments[otherId]!;
      if (!sameStyle(segment, other)) continue;
      const hit = project(endpoint, other, index.aspect);
      const [p, q] = ends(other, index.aspect);
      const theirEndpoint = distance(endpoint, p) <= distance(endpoint, q) ? p : q;
      const endpointGap = distance(endpoint, theirEndpoint);
      const parallel = connectionCollinear(index, id, otherId);
      if (!parallel || endpointGap <= JOIN || endpointGap > MAX_BRIDGE + EPSILON) continue;
      // Bridging is restricted to opposing ends, never overlapping interiors.
      if (hit.unbounded > 0 && hit.unbounded < 1) continue;
      const [a, b] = endpoints;
      const away = endpoint === a ? b : a;
      if ((away.x - endpoint.x) * (theirEndpoint.x - endpoint.x) + (away.y - endpoint.y) * (theirEndpoint.y - endpoint.y) >= 0) continue;
      gaps.push({ id: otherId, endpoint: theirEndpoint, gap: endpointGap });
    }
    // Connect only the first compatible interval on this supporting line. This
    // avoids skipping a real dash, valve, or differently labeled pipe section.
    gaps.sort((a, b) => a.gap - b.gap);
    const closest = gaps[0];
    for (const gap of gaps.filter((candidate) => closest && candidate.gap <= closest.gap + COLLINEAR)) {
      const other = index.segments[gap.id]!;
      const declaredDashGap = segment.dash.length > 0
        ? Math.min(0.012, Math.max(...segment.dash.filter((_, position) => position % 2 === 1), 0) * 1.35 + JOIN)
        : 0;
      const dashBridge = declaredDashGap > 0 && gap.gap <= declaredDashGap &&
        gap.gap <= Math.max(segmentLength(segment, index.aspect), segmentLength(other, index.aspect)) * 2;
      if (dashBridge || manualDashPattern(index, id, gap.id, gap.gap, nearby) || labelInGap(index, id, gap.id, endpoint, gap.endpoint)) {
        found.set(gap.id, { to: gap.id, bridge: makeBridge(segment, other, endpoint, gap.endpoint, index.aspect) });
      }
    }
  }
  const result = [...found.values()];
  if (partial) {
    index.partialNeighbors.add(id);
    index.selectionPartial = true;
  }
  index.neighbors.set(id, result);
  return result;
}

function allowed(index: PipeSystemIndex, id: number, system: string | null) {
  const codes = index.segmentSystems.get(id);
  return !codes || codes.size === 0 || system !== null && codes.size === 1 && codes.has(system);
}

function inferSystem(index: PipeSystemIndex, seeds: number[]): string | null {
  const queue = [...seeds];
  const visited = new Set(queue);
  for (let cursor = 0; cursor < queue.length && cursor < MAX_SELECTION; cursor++) {
    const id = queue[cursor]!;
    const codes = index.segmentSystems.get(id);
    if (codes?.size === 1) return [...codes][0]!;
    if (codes && codes.size > 1) continue;
    for (const edge of graphNeighbors(index, id)) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        queue.push(edge.to);
      }
    }
    if (index.work > MAX_WORK) break;
  }
  if (queue.length > MAX_SELECTION) runtimeLimit(index);
  return null;
}

/** Union collinear intervals so coincident/overlapping PDF strokes count once. */
function unionLength(segments: PipeSegment[], aspect: number) {
  type Run = { source: PipeSegment; a: MetricPoint; ux: number; uy: number; intervals: [number, number][] };
  const groups = new Map<string, Run[]>();
  for (const segment of segments) {
    const [a, b] = ends(segment, aspect);
    const length = distance(a, b);
    if (length <= EPSILON) continue;
    let ux = (b.x - a.x) / length;
    let uy = (b.y - a.y) / length;
    if (ux < -EPSILON || Math.abs(ux) <= EPSILON && uy < 0) { ux = -ux; uy = -uy; }
    const angle = Math.round(Math.atan2(uy, ux) / 0.00001);
    const offset = Math.round((-uy * a.x + ux * a.y) / 0.00001);
    let run: Run | undefined;
    for (let dAngle = -1; dAngle <= 1 && !run; dAngle++) {
      for (let dOffset = -1; dOffset <= 1 && !run; dOffset++) {
        run = groups.get(`${angle + dAngle},${offset + dOffset}`)?.find((candidate) => collinear(candidate.source, segment, aspect));
      }
    }
    if (!run) {
      run = { source: segment, a, ux, uy, intervals: [] };
      const groupKey = `${angle},${offset}`;
      const list = groups.get(groupKey) ?? [];
      list.push(run);
      groups.set(groupKey, list);
    }
    const start = (a.x - run.a.x) * run.ux + (a.y - run.a.y) * run.uy;
    const end = (b.x - run.a.x) * run.ux + (b.y - run.a.y) * run.uy;
    run.intervals.push([Math.min(start, end), Math.max(start, end)]);
  }
  let total = 0;
  for (const runs of groups.values()) {
    for (const run of runs) {
      run.intervals.sort((a, b) => a[0] - b[0]);
      let start = run.intervals[0]![0];
      let end = run.intervals[0]![1];
      for (let i = 1; i < run.intervals.length; i++) {
        const interval = run.intervals[i]!;
        if (interval[0] <= end + EPSILON) end = Math.max(end, interval[1]);
        else { total += end - start; [start, end] = interval; }
      }
      total += end - start;
    }
  }
  return total;
}

/** Prefer the clicked line's source system; infer a connected run only without it. */
export function selectPipeSystem(
  index: PipeSystemIndex,
  point: SheetPoint,
  tolerance: number,
  systemFilter?: string,
): PipeSystemSelection {
  const warnings = [...index.warnings];
  const empty = (): PipeSystemSelection => ({ system: null, segments: [], lengthInSheetWidths: 0, warnings: [...new Set(warnings)], truncated: index.truncated });
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1 || !Number.isFinite(tolerance) || tolerance <= 0) return empty();
  index.work = 0;
  index.selectionPartial = false;
  index.partialQueryStyles.clear();
  const filter = systemFilter ? normalSystem(systemFilter) : undefined;
  const target = metric(point, index.aspect);
  const reach = Math.min(0.05, tolerance);
  const hits = query(index, target, reach)
    .filter((id) => !index.excluded.has(id))
    .map((id) => ({ id, distance: project(target, index.segments[id]!, index.aspect).distance }))
    .filter((hit) => hit.distance <= reach)
    .sort((a, b) => a.distance - b.distance);
  // Ask the actual nearest line for its source system before borrowing text
  // or walking a visual connection graph. Unclassified neighbours must never
  // acquire membership simply because they touch a source-tagged pipe.
  const clicked = hits[0];
  const sourceSystem = clicked && layerSystem(index.segments[clicked.id]!.layer);
  if (sourceSystem) {
    if (filter && filter !== sourceSystem) return empty();
    return selectPipeLayerSystem(index.linework, sourceSystem);
  }
  const labels = index.bindings.filter(({ label, segments }) => {
    if (segments.length === 0 || filter && label.system !== filter) return false;
    return target.x >= label.left - reach && target.x <= label.right + reach &&
      target.y >= label.top * index.aspect - reach && target.y <= label.bottom * index.aspect + reach;
  }).sort((a, b) => distance(target, labelBox(a.label, index.aspect).center) - distance(target, labelBox(b.label, index.aspect).center));
  let seeds: number[];
  let system: string | null;
  if (labels[0]) {
    seeds = labels[0].segments.filter((id) => !index.excluded.has(id));
    system = labels[0].label.system;
  } else {
    let hit = hits[0];
    if (hit && !filter) {
      // In pipe mode, a classified pipe inside the actual tap tolerance is
      // stronger evidence than an unclassified note or wall underneath it.
      hit = hits.find((candidate) => index.segmentSystems.get(candidate.id)?.size === 1) ?? hit;
    }
    if (filter) hit = hits.find(({ id }) => allowed(index, id, filter) && inferSystem(index, [id]) === filter);
    if (!hit) return empty();
    seeds = [hit.id];
    system = filter ?? inferSystem(index, seeds);
  }
  if (seeds.length === 0) return empty();
  const queue = seeds.filter((id) => allowed(index, id, system));
  const visited = new Set(queue);
  const bridges = new Map<string, PipeSegment>();
  let conflict = false;
  for (let cursor = 0; cursor < queue.length && cursor < MAX_SELECTION; cursor++) {
    const id = queue[cursor]!;
    for (const edge of graphNeighbors(index, id)) {
      if (!allowed(index, edge.to, system)) { conflict = true; continue; }
      if (edge.bridge) bridges.set(edge.bridge.id, edge.bridge);
      if (!visited.has(edge.to)) { visited.add(edge.to); queue.push(edge.to); }
    }
    if (index.work > MAX_WORK) break;
  }
  if (queue.length > MAX_SELECTION || index.work > MAX_WORK) runtimeLimit(index);
  const selected = queue.slice(0, MAX_SELECTION).map((id) => index.segments[id]!);
  selected.push(...bridges.values());
  if (selected.length === 0) return empty();
  const partial = index.truncated || index.selectionPartial || queue.some((id) => {
    const segment = index.segments[id]!;
    const styles = compatibleStyleKeys(index, segment);
    return styles.some((style) => index.partialQueryStyles.has(style) ||
      (index.cells.get(id) ?? []).some((cell) => index.partialStyleCells.get(style)?.has(cell)));
  });
  warnings.push(CHECK_WARNING);
  if (!system) warnings.push("No nearby system label was found. This is an unclassified linework trace.");
  if (conflict) warnings.push("Trace stopped at linework labeled for a different system.");
  if (bridges.size > 0) warnings.push("Small matching dash or label gaps were included in the distance.");
  warnings.push(...index.warnings);
  if (partial) warnings.push(PARTIAL_WARNING);
  return {
    system,
    ...(index.annotationPaths.size ? { excludedAnnotationPathIds: [...index.annotationPaths] } : {}),
    segments: selected,
    lengthInSheetWidths: unionLength(selected, index.aspect),
    warnings: [...new Set(warnings)],
    truncated: partial,
  };
}

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { removeHatchSegments } from "./hatch-filter";

export type WallSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** PDF stroke width in page user-space units. */
  strokeWidth: number;
  /** True when the PDF stroke uses a dash pattern (grids, setbacks, etc.). */
  dashed?: boolean;
  /** Operator index in the page content stream; hatch fills are emitted as runs. */
  order?: number;
  /** Chord of a curve (door swing, arc); never a wall, useful for door detection. */
  curve?: boolean;
  /** Edge of a filled solid (poché wall, column, jamb): as good as a heavy stroke. */
  filled?: boolean;
  /** Optional-content (layer) name when the source keeps layers. */
  layer?: string;
};

export type FloorLinework = {
  segments: WallSegment[];
  /** Curve chords (door swings) kept out of the wall candidates. */
  arcs: WallSegment[];
  /** Layer names seen on kept segments, most used first. */
  layers: string[];
  source: "pdf-vector" | "dxf" | "raster";
};

export type PdfLabel = {
  name: string;
  /** Middle of the text run. */
  x: number;
  y: number;
  /** Fallback anchors (text start, text end) when the middle sits on a wall. */
  anchors?: { x: number; y: number }[];
};

export type PdfRoomSeed = PdfLabel & {
  kind: "unit" | "room";
  areaSqFt?: number;
};

const UNIT_CODE = /^[A-Z]{1,3}\d{2,4}[A-Z]?$/i;
const UNIT_CONTEXT =
  /\b(?:\d[\d,.]*\s*SF|\d+(?:\.\d+)?\s*m²|MICRO|NANO|STUDIO|\d+\s*BD)\b/i;
const ROOM_LABEL =
  /\b(?:kitchen|bath(?:room)?|powder(?:\s*room)?|ensuite|bed(?:room)?|living(?:\s*room)?|family(?:\s*room)?|great\s*room|dining(?:\s*room)?|closet|corridor|hall(?:way)?|foyer|lobby|entry|mudroom|laundry|utility|pantry|storage|mechanical|mech\s+(?:room|ph)|electrical|elec(?:\.|trical)?\s*closet|stair(?:\s+[A-Z])?|elevator|garbage|office|den|amenity|vest(?:ibule)?|janitor|washroom|locker)\b/i;
const ROOM_ANNOTATION =
  /\b(?:refer|detail|section|typ(?:ical)?|window|wall|door|note|drawing)\b/i;

const RENDER_SCALE = 2;

const OPS = {
  setLineWidth: 2,
  beginMarkedContent: 69,
  beginMarkedContentProps: 70,
  endMarkedContent: 71,
  setDash: 6,
  save: 10,
  restore: 11,
  transform: 12,
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  curveTo2: 16,
  curveTo3: 17,
  closePath: 18,
  rectangle: 19,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
  constructPath: 91,
} as const;

const DRAW = {
  moveTo: 0,
  lineTo: 1,
  curveTo: 2,
  quadraticCurveTo: 3,
  closePath: 4,
} as const;

type Matrix = [number, number, number, number, number, number];

type GraphicsState = {
  ctm: Matrix;
  lineWidth: number;
  dashPattern: number[];
};

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function apply(m: Matrix, x: number, y: number) {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5],
  };
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function toNumbers(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number);
  if (ArrayBuffer.isView(value) && "length" in value) {
    const view = value as ArrayBufferView & {
      length: number;
      [index: number]: number;
    };
    const out: number[] = [];
    for (let i = 0; i < view.length; i += 1) out.push(Number(view[i]));
    return out;
  }
  return [];
}

/** Segment budget per page; keeps polygonization bounded on busy sheets. */
const MAX_SEGMENTS = 4000;

/** Strokes this many times wider than the page's typical stroke are wall poché. */
const HEAVY_STUB_RATIO = 2.5;

/** Length-weighted median stroke width of the page's plain linework. */
function medianStrokeWidth(segments: WallSegment[]) {
  const rows = segments
    .filter((seg) => !seg.dashed && !seg.curve && !seg.filled)
    .map((seg) => ({ width: seg.strokeWidth, length: segmentLength(seg) }))
    .sort((left, right) => left.width - right.width);
  const total = rows.reduce((sum, row) => sum + row.length, 0);
  let acc = 0;
  for (const row of rows) {
    acc += row.length;
    if (acc >= total / 2) return row.width;
  }
  return 0;
}

/** Filled solids wider than this are backgrounds/title blocks, not walls. */
const FILL_MAX_SIDE = 0.08;
/** Thinner solids are fixture linework drawn as strips, not wall poché. */
const FILL_MIN_THICK = 0.001;
const ARC_PIECE_MAX = 0.02;
const ARC_PIECE_TURN_MIN = Math.PI / 180;
const ARC_PIECE_TURN_MAX = Math.PI / 3;
const ARC_TURN_MIN = Math.PI / 6;

/**
 * Door swings are often flattened into a run of short line pieces that keep
 * turning the same way. Chain those runs (consecutive, end-to-start, steady
 * turn) and report each as one chord so door detection sees the swing.
 */
function recoverArcChords(raw: WallSegment[]): WallSegment[] {
  const chords: WallSegment[] = [];
  let chain: WallSegment[] = [];
  let turn = 0;
  let sign = 0;
  const flush = () => {
    if (chain.length >= 2 && Math.abs(turn) >= ARC_TURN_MIN) {
      const first = chain[0]!;
      const last = chain[chain.length - 1]!;
      chords.push({ ...first, x2: last.x2, y2: last.y2, curve: true });
    }
    chain = [];
    turn = 0;
    sign = 0;
  };
  const heading = (seg: WallSegment) => Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1);
  for (const seg of raw) {
    if (seg.dashed || segmentLength(seg) > ARC_PIECE_MAX) {
      flush();
      continue;
    }
    const prev = chain[chain.length - 1];
    if (prev) {
      const joined =
        Math.hypot(prev.x2 - seg.x1, prev.y2 - seg.y1) < 1e-6 &&
        (seg.order ?? 0) - (prev.order ?? 0) <= 1;
      let delta = heading(seg) - heading(prev);
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      const magnitude = Math.abs(delta);
      const steady =
        magnitude >= ARC_PIECE_TURN_MIN &&
        magnitude <= ARC_PIECE_TURN_MAX &&
        (sign === 0 || Math.sign(delta) === sign);
      if (!joined || !steady) {
        flush();
        chain.push(seg);
        continue;
      }
      sign = Math.sign(delta);
      turn += delta;
    }
    chain.push(seg);
  }
  flush();
  return chords;
}

const DASH_RUN_MIN = 4;
const DASH_GAP_MAX = 0.008;
const DASH_PIECE_MAX = 0.04;
const DASH_OFFSET_TOL = 0.0006;
const DASH_LENGTH_TOL = 0.35;

function similar(a: number, b: number, tolerance: number) {
  return Math.abs(a - b) <= tolerance * Math.max(a, b);
}

/**
 * Section cuts, match lines and property lines are frequently exported as a
 * run of solid pieces (dash, dot, dash, dot …) rather than one dashed stroke.
 * Bridged together those pieces read as a wall straight through a unit. A run
 * of collinear, consecutively drawn pieces with even gaps and a periodic
 * length pattern is such a line: flag every piece as dashed.
 */
function markDashPatterns(raw: WallSegment[]) {
  let run: WallSegment[] = [];
  const flush = () => {
    if (run.length >= DASH_RUN_MIN) {
      const lengths = run.map(segmentLength);
      const first = run[0]!;
      const ux = (first.x2 - first.x1) / lengths[0]!;
      const uy = (first.y2 - first.y1) / lengths[0]!;
      const along = (seg: WallSegment) => {
        const a = (seg.x1 - first.x1) * ux + (seg.y1 - first.y1) * uy;
        const b = (seg.x2 - first.x1) * ux + (seg.y2 - first.y1) * uy;
        return { start: Math.min(a, b), end: Math.max(a, b) };
      };
      const gaps = run.slice(1).map((seg, i) => along(seg).start - along(run[i]!).end);
      const gapMin = Math.min(...gaps);
      const gapMax = Math.max(...gaps);
      const evenGaps = gapMin > 0 && gapMax <= gapMin * 1.6;
      const even = lengths.filter((_, i) => i % 2 === 0);
      const odd = lengths.filter((_, i) => i % 2 === 1);
      const uniform = (values: number[]) =>
        values.every((value) => similar(value, values[0]!, DASH_LENGTH_TOL));
      const periodic = uniform(lengths) || (uniform(even) && uniform(odd));
      if (evenGaps && periodic) {
        if (process.env.ROOMS_DEBUG_DASH) console.log("[dash]", run.length, "w", first.strokeWidth.toFixed(2), run.map((s) => `${(s.x1*2200).toFixed(0)},${(s.y1*1650).toFixed(0)}-${(s.x2*2200).toFixed(0)},${(s.y2*1650).toFixed(0)}`).join(" "));
        for (const seg of run) seg.dashed = true;
      }
    }
    run = [];
  };
  // Measured along the run's first piece so pieces drawn in either direction chain.
  const collinear = (first: WallSegment, prev: WallSegment, next: WallSegment) => {
    const len = segmentLength(first);
    const ux = (first.x2 - first.x1) / len;
    const uy = (first.y2 - first.y1) / len;
    const offset = (x: number, y: number) => Math.abs((x - first.x1) * -uy + (y - first.y1) * ux);
    if (offset(next.x1, next.y1) > DASH_OFFSET_TOL || offset(next.x2, next.y2) > DASH_OFFSET_TOL) return false;
    const along = (x: number, y: number) => (x - first.x1) * ux + (y - first.y1) * uy;
    const prevEnd = Math.max(along(prev.x1, prev.y1), along(prev.x2, prev.y2));
    const gap = Math.min(along(next.x1, next.y1), along(next.x2, next.y2)) - prevEnd;
    return gap > 0 && gap <= DASH_GAP_MAX;
  };
  for (const seg of raw) {
    const len = segmentLength(seg);
    if (seg.curve || seg.filled || len < 1e-6 || len > DASH_PIECE_MAX) {
      flush();
      continue;
    }
    const prev = run[run.length - 1];
    if (
      prev &&
      !(
        (seg.order ?? 0) - (prev.order ?? 0) <= 1 &&
        similar(seg.strokeWidth, prev.strokeWidth, 0.1) &&
        collinear(run[0]!, prev, seg)
      )
    ) {
      flush();
    }
    run.push(seg);
  }
  flush();
}

function segmentLength(seg: WallSegment) {
  return Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
}

export async function extractPdfWalls(
  pdfBuffer: Buffer,
  pageNumber: number,
): Promise<WallSegment[]> {
  return (await extractPdfLinework(pdfBuffer, pageNumber)).segments;
}

export async function extractPdfLinework(
  pdfBuffer: Buffer,
  pageNumber: number,
): Promise<FloorLinework> {
  const document = await getDocument({
    data: new Uint8Array(pdfBuffer),
    useSystemFonts: true,
  }).promise;
  const optionalContent = await document
    .getOptionalContentConfig()
    .catch(() => null);
  const layerName = (props: unknown) => {
    if (!props || typeof props !== "object") return undefined;
    const id = (props as { id?: unknown }).id;
    if (typeof id !== "string") return undefined;
    return optionalContent?.getGroup(id)?.name ?? undefined;
  };
  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvasW = Math.max(1, Math.ceil(viewport.width));
  const canvasH = Math.max(1, Math.ceil(viewport.height));
  const opList = await page.getOperatorList();

  const toNorm = (x: number, y: number) => {
    const [vx, vy] = viewport.convertToViewportPoint(x, y);
    return {
      x: clamp01(vx / canvasW),
      y: clamp01(vy / canvasH),
    };
  };

  const stateStack: GraphicsState[] = [];
  let ctm = IDENTITY;
  let lineWidth = 1;
  let dashPattern: number[] = [];
  let path: Array<{ x: number; y: number }> = [];
  let start: { x: number; y: number } | null = null;
  let opIndex = 0;
  const raw: WallSegment[] = [];
  let pending: WallSegment[] | null = null;
  const layerStack: Array<string | undefined> = [];

  const addSeg = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    curve = false,
  ) => {
    if (a.x === b.x && a.y === b.y) return;
    const p1 = toNorm(a.x, a.y);
    const p2 = toNorm(b.x, b.y);
    let layer: string | undefined;
    for (let i = layerStack.length - 1; i >= 0 && !layer; i -= 1) {
      layer = layerStack[i];
    }
    (pending ?? raw).push({
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      strokeWidth: lineWidth,
      dashed: dashPattern.some((value) => value > 0),
      order: opIndex,
      ...(curve ? { curve } : {}),
      ...(layer ? { layer } : {}),
    });
  };

  const moveTo = (x: number, y: number) => {
    const p = apply(ctm, x, y);
    start = p;
    path = [p];
  };
  const lineTo = (x: number, y: number, curve = false) => {
    const p = apply(ctm, x, y);
    const prev = path[path.length - 1];
    if (prev) addSeg(prev, p, curve);
    path.push(p);
  };
  const closePath = () => {
    if (start && path.length) addSeg(path[path.length - 1]!, start);
  };
  const rectangle = (x: number, y: number, w: number, h: number) => {
    const a = apply(ctm, x, y);
    const b = apply(ctm, x + w, y);
    const c = apply(ctm, x + w, y + h);
    const d = apply(ctm, x, y + h);
    addSeg(a, b);
    addSeg(b, c);
    addSeg(c, d);
    addSeg(d, a);
  };
  const handleConstructPath = (args: unknown[]) => {
    const term = Number(args[0]);
    const isStroke =
      term === OPS.stroke ||
      term === OPS.closeStroke ||
      term === OPS.fillStroke ||
      term === OPS.eoFillStroke ||
      term === OPS.closeFillStroke ||
      term === OPS.closeEOFillStroke;
    const isFill = term === OPS.fill || term === OPS.eoFill;
    if (!isStroke && !isFill) return;
    // Solid fills are how poché walls, columns and door jambs get drawn; keep
    // the outline of small solids as heavy linework. Big fills are backgrounds.
    pending = isFill ? [] : null;

    const buffers = Array.isArray(args[1]) ? args[1] : [args[1]];
    for (const buf of buffers) {
      const pts = toNumbers(buf);
      let i = 0;
      while (i < pts.length) {
        const op = pts[i]!;
        if (op === DRAW.moveTo) {
          moveTo(pts[i + 1] ?? 0, pts[i + 2] ?? 0);
          i += 3;
        } else if (op === DRAW.lineTo) {
          lineTo(pts[i + 1] ?? 0, pts[i + 2] ?? 0);
          i += 3;
        } else if (op === DRAW.curveTo) {
          lineTo(pts[i + 5] ?? 0, pts[i + 6] ?? 0, true);
          i += 7;
        } else if (op === DRAW.quadraticCurveTo) {
          lineTo(pts[i + 3] ?? 0, pts[i + 4] ?? 0, true);
          i += 5;
        } else if (op === DRAW.closePath) {
          closePath();
          i += 1;
        } else {
          i += 1;
        }
      }
    }
    if (pending) {
      const solid = pending;
      pending = null;
      if (solid.length >= 3 && solid.length <= 12) {
        const xs = solid.flatMap((seg) => [seg.x1, seg.x2]);
        const ys = solid.flatMap((seg) => [seg.y1, seg.y2]);
        const width = Math.max(...xs) - Math.min(...xs);
        const height = Math.max(...ys) - Math.min(...ys);
        if (
          Math.max(width, height) <= FILL_MAX_SIDE &&
          Math.min(width, height) >= FILL_MIN_THICK
        ) {
          for (const seg of solid) raw.push({ ...seg, filled: true });
        }
      }
    }
  };

  for (let i = 0; i < opList.fnArray.length; i += 1) {
    const fn = opList.fnArray[i]!;
    const args = (opList.argsArray[i] ?? []) as unknown[];
    opIndex = i;
    switch (fn) {
      case OPS.save:
        stateStack.push({ ctm, lineWidth, dashPattern: [...dashPattern] });
        break;
      case OPS.restore:
        {
          const restored = stateStack.pop();
          ctm = restored?.ctm ?? IDENTITY;
          lineWidth = restored?.lineWidth ?? 1;
          dashPattern = restored?.dashPattern ?? [];
        }
        break;
      case OPS.setLineWidth:
        lineWidth = Math.max(0, Number(args[0]) || 0);
        break;
      case OPS.setDash:
        dashPattern = toNumbers(args[0]).filter(
          (value) => Number.isFinite(value) && value >= 0,
        );
        break;
      case OPS.transform:
        if (args.length >= 6) {
          ctm = multiply(ctm, [
            Number(args[0]),
            Number(args[1]),
            Number(args[2]),
            Number(args[3]),
            Number(args[4]),
            Number(args[5]),
          ]);
        }
        break;
      case OPS.moveTo:
        moveTo(Number(args[0]), Number(args[1]));
        break;
      case OPS.lineTo:
        lineTo(Number(args[0]), Number(args[1]));
        break;
      case OPS.curveTo:
        lineTo(Number(args[4]), Number(args[5]), true);
        break;
      case OPS.curveTo2:
      case OPS.curveTo3:
        lineTo(Number(args[2]), Number(args[3]), true);
        break;
      case OPS.beginMarkedContent:
        layerStack.push(undefined);
        break;
      case OPS.beginMarkedContentProps:
        layerStack.push(args[0] === "OC" ? layerName(args[1]) : undefined);
        break;
      case OPS.endMarkedContent:
        layerStack.pop();
        break;
      case OPS.closePath:
        closePath();
        break;
      case OPS.rectangle:
        rectangle(
          Number(args[0]),
          Number(args[1]),
          Number(args[2]),
          Number(args[3]),
        );
        break;
      case OPS.constructPath:
        handleConstructPath(args);
        break;
      case OPS.stroke:
      case OPS.closeStroke:
      case OPS.fillStroke:
      case OPS.eoFillStroke:
      case OPS.closeFillStroke:
      case OPS.closeEOFillStroke:
      case OPS.fill:
      case OPS.eoFill:
      case OPS.endPath:
        path = [];
        start = null;
        break;
      default:
        break;
    }
  }

  markDashPatterns(raw);
  const minLen = 0.008;
  const onPage = (seg: WallSegment) => {
    const midX = (seg.x1 + seg.x2) / 2;
    const midY = (seg.y1 + seg.y2) / 2;
    return midX >= 0.02 && midX <= 0.98 && midY >= 0.02 && midY <= 0.98;
  };
  // Short stubs of heavy linework (door jambs, wall returns) matter: they
  // close openings that ordinary short linework never would.
  const heavyWidth = medianStrokeWidth(raw) * HEAVY_STUB_RATIO;
  const candidates = raw.filter((seg) => {
    if (seg.dashed || seg.curve) return false;
    const len = segmentLength(seg);
    const heavy = seg.filled || (heavyWidth > 0 && seg.strokeWidth >= heavyWidth);
    if (len < (heavy ? minLen / 3 : minLen) || len > 0.55) return false;
    return onPage(seg);
  });
  const arcs = [...raw, ...recoverArcChords(raw)].filter(
    (seg) =>
      seg.curve &&
      !seg.dashed &&
      segmentLength(seg) >= minLen / 2 &&
      segmentLength(seg) <= 0.05 &&
      onPage(seg),
  );

  const unhatched = removeHatchSegments(candidates);
  // Keep every heavy stroke; fill the rest of the budget with the longest
  // plain linework (fixtures and furniture are short and plentiful).
  const isHeavy = (seg: WallSegment) =>
    Boolean(seg.filled) || (heavyWidth > 0 && seg.strokeWidth >= heavyWidth);
  const heavyWalls = unhatched.filter(isHeavy);
  const walls = [
    ...heavyWalls,
    ...unhatched
      .filter((seg) => !isHeavy(seg))
      .sort((a, b) => segmentLength(b) - segmentLength(a))
      .slice(0, Math.max(0, MAX_SEGMENTS - heavyWalls.length)),
  ];
  const layerCounts = new Map<string, number>();
  for (const seg of walls) {
    if (seg.layer)
      layerCounts.set(seg.layer, (layerCounts.get(seg.layer) ?? 0) + 1);
  }
  const layers = [...layerCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  console.log(
    "[pdf-walls] page",
    pageNumber,
    "raw",
    raw.length,
    "hatch",
    candidates.length - unhatched.length,
    "kept",
    walls.length,
    "arcs",
    arcs.length,
    "layers",
    layers.length,
  );
  return { segments: walls, arcs, layers, source: "pdf-vector" };
}

export async function extractPdfLabels(
  pdfBuffer: Buffer,
  pageNumber: number,
): Promise<PdfLabel[]> {
  const document = await getDocument({
    data: new Uint8Array(pdfBuffer),
    useSystemFonts: true,
  }).promise;
  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvasW = Math.max(1, Math.ceil(viewport.width));
  const canvasH = Math.max(1, Math.ceil(viewport.height));
  const textContent = await page.getTextContent();
  const labels: PdfLabel[] = [];
  for (const item of textContent.items) {
    if (!("str" in item) || !item.str) continue;
    const name = String(item.str).replace(/\s+/g, " ").trim();
    if (!name || name.length > 40) continue;
    if (!/[A-Za-z0-9]/.test(name)) continue;
    // Anchor the label at the middle of its text run, not the baseline origin:
    // a room name often starts on a wall or in the room next door.
    const transform = item.transform as number[];
    const [a, b, c, d, e, f] = transform.map((value) => value ?? 0) as number[];
    const run = Math.hypot(a ?? 0, b ?? 0) || 1;
    const rise = Math.hypot(c ?? 0, d ?? 0) || 1;
    const width = (item.width ?? 0) / run;
    const halfHeight = ((item.height ?? 0) / 2) / rise;
    const at = (along: number) => {
      const [vx, vy] = viewport.convertToViewportPoint(
        (e ?? 0) + (a ?? 0) * along + (c ?? 0) * halfHeight,
        (f ?? 0) + (b ?? 0) * along + (d ?? 0) * halfHeight,
      );
      return { x: clamp01(vx / canvasW), y: clamp01(vy / canvasH) };
    };
    labels.push({
      name,
      ...at(width / 2),
      anchors: [at(width * 0.1), at(width * 0.9)],
    });
  }
  console.log("[pdf-walls] labels", labels.length, "page", pageNumber);
  return labels;
}

export function extractPdfRoomSeeds(labels: PdfLabel[]): PdfRoomSeed[] {
  const seeds: PdfRoomSeed[] = [];
  for (const label of labels) {
    const name = label.name.replace(/\s+/g, " ").trim();
    if (!name || name.length > 48) continue;
    if (
      label.x < 0.025 ||
      label.x > 0.92 ||
      label.y < 0.025 ||
      label.y > 0.96
    ) {
      continue;
    }
    const nearby = labels.filter(
      (candidate) =>
        candidate !== label &&
        Math.abs(candidate.x - label.x) <= 0.025 &&
        Math.abs(candidate.y - label.y) <= 0.025,
    );
    const isUnit =
      UNIT_CODE.test(name) &&
      nearby.some((candidate) => UNIT_CONTEXT.test(candidate.name));
    const isRoom =
      ROOM_LABEL.test(name) &&
      !ROOM_ANNOTATION.test(name) &&
      !/^RS\d+$/i.test(name);
    if (!isUnit && !isRoom) continue;

    const duplicate = seeds.some(
      (seed) =>
        seed.name.toLowerCase() === name.toLowerCase() &&
        Math.hypot(seed.x - label.x, seed.y - label.y) < 0.006,
    );
    if (duplicate) continue;
    const areaLabel = nearby.find((candidate) =>
      /[\d,.]+\s*SF\b/i.test(candidate.name),
    );
    const areaMatch = areaLabel?.name.match(/([\d,.]+)\s*SF\b/i);
    const areaSqFt = areaMatch
      ? Number(areaMatch[1]!.replaceAll(",", ""))
      : undefined;
    seeds.push({
      ...label,
      name,
      kind: isUnit ? "unit" : "room",
      ...(Number.isFinite(areaSqFt) ? { areaSqFt } : {}),
    });
  }
  return seeds.slice(0, 40);
}

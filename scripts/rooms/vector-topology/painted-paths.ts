import { createHash } from "node:crypto";
import { getDocument, OPS, version } from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  ArcEvidence,
  ClipRectangle,
  GraphicsState,
  LineEvidence,
  Matrix,
  OperatorListInput,
  PaintedPath,
  ParsedPage,
  PathCommand,
  Point,
} from "./schema";
export type {
  ArcEvidence,
  LineEvidence,
  OperatorListInput,
  PaintedPath,
  ParsedPage,
  Point,
} from "./schema";

export const PDFJS_VERSION = "6.2.108";
export const LIMITS = Object.freeze({
  maxPdfBytes: 128 * 1024 * 1024,
  maxOperators: 600_000,
  maxCommands: 600_000,
  maxPaths: 200_000,
  maxCurves: 100_000,
  maxSampledPoints: 2_000_000,
  maxArgumentValues: 8_000_000,
  maxStackDepth: 256,
  maxCoordinate: 10_000_000,
  maxStringCharacters: 8_000_000,
  maxClipRectangles: 256,
  maxStateReasons: 256,
  curveTolerance: 0.15,
  maxCurveDepth: 16,
  minCurveDepth: 3,
  spatialCellSize: 32,
  maxSpatialPostings: 2_000_000,
  maxSpatialChecks: 20_000_000,
  maxCellsPerBox: 16_384,
  minFlattenedVertices: 8,
  maxFlattenedLocalTurn: Math.PI / 6,
  minFlattenedTotalTurn: Math.PI / 6,
});
// These are the *internal DrawOPS stream schema*, not public OPS numbers. PDF.js does
// not export DrawOPS. Pinned v6.2.108 src/shared/util.js DrawOPS and display/canvas.js
// makePathFromDrawOPS: https://github.com/mozilla/pdf.js/blob/v6.2.108/src/shared/util.js
// Real fabricated-PDF tests below verify its normalized constructPath representation.
const DRAW = Object.freeze({
  move: 0,
  line: 1,
  cubic: 2,
  quadratic: 3,
  close: 4,
});
const names = new Map(Object.entries(OPS).map(([name, code]) => [code, name]));
const paints = new Set([
  OPS.stroke,
  OPS.closeStroke,
  OPS.fill,
  OPS.eoFill,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
  OPS.endPath,
]);
const strokes = new Set([
  OPS.stroke,
  OPS.closeStroke,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
]);
const fills = new Set([
  OPS.fill,
  OPS.eoFill,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
]);
const closePaints = new Set([
  OPS.closeStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
]);
const identity = (): Matrix => [1, 0, 0, 1, 0, 0];
const unique = (v: string[]) => [...new Set(v)];
function fail(message: string): never {
  throw new Error(`painted-paths: ${message}`);
}
const finite = (v: unknown, label: string): number => {
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    Math.abs(v) > LIMITS.maxCoordinate
  )
    fail(`nonfinite/out-of-range ${label}`);
  return v as number;
};
function nums(v: unknown, count: number | null, label: string): number[] {
  if (!Array.isArray(v) && !ArrayBuffer.isView(v)) fail(`malformed ${label}`);
  const a = Array.from(v as ArrayLike<unknown>);
  if (count !== null && a.length !== count) fail(`wrong arity ${label}`);
  return a.map((x) => finite(x, label));
}
function mul(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ].map((n) => finite(n, "matrix product")) as Matrix;
}
function point(m: Matrix, x: number, y: number): Point {
  return {
    x: finite(m[0] * x + m[2] * y + m[4], "transformed x"),
    y: finite(m[1] * x + m[3] * y + m[5], "transformed y"),
  };
}
function isotropic(m: Matrix): boolean {
  const u = Math.hypot(m[0], m[1]),
    v = Math.hypot(m[2], m[3]);
  return (
    u > 1e-12 &&
    Math.abs(u - v) <= 1e-9 * Math.max(1, u, v) &&
    Math.abs(m[0] * m[2] + m[1] * m[3]) <= 1e-9 * Math.max(1, u * v)
  );
}
function bounds(points: Point[]): PaintedPath["bounds"] {
  if (!points.length) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}
function rectangle(
  points: Point[],
  operatorIndex: number,
): ClipRectangle | null {
  if (points.length !== 4) return null;
  const b = bounds(points)!;
  if (!(b.maxX > b.minX && b.maxY > b.minY)) return null;
  const corners = new Set(points.map((p) => `${p.x},${p.y}`));
  // Four bounding corners alone can be a self-crossing bow-tie. Each cyclic
  // edge must connect adjacent corners along exactly one nonzero axis.
  if (
    points.some((p, i) => {
      const q = points[(i + 1) % points.length]!;
      return (p.x === q.x) === (p.y === q.y);
    })
  )
    return null;
  if (
    corners.size !== 4 ||
    points.some(
      (p) =>
        !(
          (p.x === b.minX || p.x === b.maxX) &&
          (p.y === b.minY || p.y === b.maxY)
        ),
    )
  )
    return null;
  return { ...b, operatorIndex };
}
function initial(width: number, height: number): GraphicsState {
  return {
    ctm: identity(),
    lineWidth: 1,
    lineCap: 0,
    lineJoin: 0,
    miterLimit: 10,
    dash: [],
    dashPhase: 0,
    strokeColor: "#000000",
    fillColor: "#000000",
    strokeAlpha: 1,
    fillAlpha: 1,
    blendMode: "source-over",
    softMask: null,
    transfer: null,
    renderingIntent: null,
    flatness: 1,
    strokeColorSpace: "DeviceRGB",
    fillColorSpace: "DeviceRGB",
    clips: [{ minX: 0, minY: 0, maxX: width, maxY: height, operatorIndex: -1 }],
    unresolvedClip: false,
    reasons: [],
    provenance: [],
  };
}
function neutralColor(v: unknown): boolean {
  if (typeof v !== "string" || !/^#[0-9a-f]{6}$/i.test(v)) return false;
  const r = parseInt(v.slice(1, 3), 16),
    g = parseInt(v.slice(3, 5), 16),
    b = parseInt(v.slice(5, 7), 16);
  return r === g && g === b && r < 245;
}
function channelGray(v: unknown): string {
  const n = finite(v, "gray");
  if (n < 0 || n > 1) fail("gray outside [0,1]");
  const h = Math.round(n * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${h}${h}${h}`;
}
function rgb(args: unknown[]): unknown {
  // v6 normalized arguments are a single CSS hex string, not three 0..1 values.
  if (args.length === 1 && typeof args[0] === "string") return args[0];
  if (args.length === 3)
    return (
      "#" +
      args
        .map((v) => {
          const n = finite(v, "RGB");
          if (n < 0 || n > 1) fail("RGB outside [0,1]");
          return Math.round(n * 255)
            .toString(16)
            .padStart(2, "0");
        })
        .join("")
    );
  fail("malformed RGB color");
}
function distanceToChord(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    n = Math.hypot(dx, dy);
  return n === 0
    ? Math.hypot(p.x - a.x, p.y - a.y)
    : Math.abs(dx * (a.y - p.y) - (a.x - p.x) * dy) / n;
}
function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function sampleCurve(ps: Point[], account: () => void): Point[] {
  const out: Point[] = [{ ...ps[0]! }];
  account();
  if (ps.every((p) => p.x === ps[0]!.x && p.y === ps[0]!.y)) {
    account();
    return [...out, { ...ps[0]! }];
  }
  function subdivide(p: Point[], depth: number): void {
    const a = p[0]!,
      b = p[p.length - 1]!;
    const flat = p
      .slice(1, -1)
      .every((q) => distanceToChord(q, a, b) <= LIMITS.curveTolerance);
    // Control projection also excludes collinear backtracking/loops that chord-only
    // flatness would erase. Excess recursion is an explicit failure, not a shortcut.
    const dx = b.x - a.x,
      dy = b.y - a.y,
      dd = dx * dx + dy * dy;
    const monotone =
      dd > 0 &&
      p.slice(1, -1).every((q) => {
        const t = ((q.x - a.x) * dx + (q.y - a.y) * dy) / dd;
        return t >= 0 && t <= 1;
      });
    if (depth >= LIMITS.minCurveDepth && flat && monotone) {
      account();
      out.push({ ...b });
      return;
    }
    if (depth >= LIMITS.maxCurveDepth) fail("curve subdivision budget");
    let level = p;
    const left = [a],
      right = [b];
    while (level.length > 1) {
      level = level.slice(0, -1).map((q, i) => midpoint(q, level[i + 1]!));
      left.push(level[0]!);
      right.unshift(level[level.length - 1]!);
    }
    subdivide(left, depth + 1);
    subdivide(right, depth + 1);
  }
  subdivide(ps, 0);
  return out;
}

export function parseOperatorList(input: OperatorListInput): ParsedPage {
  if (
    version !== PDFJS_VERSION ||
    (input.pdfjsVersion !== undefined && input.pdfjsVersion !== PDFJS_VERSION)
  )
    fail("PDF.js version mismatch");
  if (!/^[0-9a-f]{64}$/i.test(input.sourceSha256))
    fail("invalid source SHA-256");
  if (!Number.isInteger(input.pageIndex) || input.pageIndex < 0)
    fail("invalid page index");
  const width = finite(input.width, "width"),
    height = finite(input.height, "height");
  if (width <= 0 || height <= 0) fail("empty page metric");
  const viewport = nums(input.viewportTransform, 6, "viewport") as Matrix;
  if (!isotropic(viewport)) fail("viewport is not isotropic");
  const count = input.fnArray?.length;
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > LIMITS.maxOperators ||
    input.argsArray?.length !== count
  )
    fail("operator count/parallel-array budget");
  let argumentValues = 0,
    stringCharacters = 0,
    commandCount = 0,
    curves = 0,
    sampledPointCount = 0;
  function copy(v: unknown, depth = 0): unknown {
    if (++argumentValues > LIMITS.maxArgumentValues || depth > 12)
      fail("argument/depth budget");
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") return finite(v, "operator argument");
    if (typeof v === "string") {
      stringCharacters += v.length;
      if (v.length > 65536 || stringCharacters > LIMITS.maxStringCharacters)
        fail("string budget");
      return v;
    }
    if (Array.isArray(v) || ArrayBuffer.isView(v))
      return Array.from(v as ArrayLike<unknown>, (x) => copy(x, depth + 1));
    if (
      v &&
      typeof v === "object" &&
      Object.getPrototypeOf(v) === Object.prototype
    ) {
      const out: Record<string, unknown> = {};
      const entries = Object.entries(v);
      if (entries.length > 128) fail("object budget");
      for (const [k, x] of entries) {
        if (k === "__proto__") fail("unsafe key");
        out[k] = copy(x, depth + 1);
      }
      return out;
    }
    fail("unsupported operator argument object");
  }
  let state = initial(width, height);
  const saved: { kind: string; state: GraphicsState }[] = [],
    marked: PaintedPath["markedContent"] = [],
    forms: number[] = [];
  const paths: PaintedPath[] = [],
    lines: LineEvidence[] = [],
    arcs: ArcEvidence[] = [];
  const ignoredOperatorCounts: Record<string, number> = {},
    graphicsOperations: GraphicsState["provenance"] = [];
  const occlusionOperations: ParsedPage["diagnostics"]["occlusionOperations"] =
    [];
  type Indexed = {
    evidence: LineEvidence | ArcEvidence;
    path: PaintedPath;
    box: NonNullable<PaintedPath["bounds"]>;
  };
  const grid = new Map<string, Indexed[]>(),
    active = new Set<Indexed>(),
    wide = new Set<Indexed>();
  let postings = 0,
    spatialChecks = 0;
  function expanded(box: NonNullable<PaintedPath["bounds"]>, margin: number) {
    return {
      minX: box.minX - margin,
      minY: box.minY - margin,
      maxX: box.maxX + margin,
      maxY: box.maxY + margin,
    };
  }
  function cellRange(box: NonNullable<PaintedPath["bounds"]>) {
    return [
      Math.floor(box.minX / LIMITS.spatialCellSize),
      Math.floor(box.minY / LIMITS.spatialCellSize),
      Math.floor(box.maxX / LIMITS.spatialCellSize),
      Math.floor(box.maxY / LIMITS.spatialCellSize),
    ] as const;
  }
  function overlap(
    a: NonNullable<PaintedPath["bounds"]>,
    b: NonNullable<PaintedPath["bounds"]>,
  ) {
    return (
      a.minX <= b.maxX &&
      a.maxX >= b.minX &&
      a.minY <= b.maxY &&
      a.maxY >= b.minY
    );
  }
  function indexEvidence(
    evidence: LineEvidence | ArcEvidence,
    path: PaintedPath,
    box: NonNullable<PaintedPath["bounds"]>,
  ) {
    if (!evidence.eligible) return;
    const entry = { evidence, path, box };
    active.add(entry);
    const [x0, y0, x1, y1] = cellRange(box);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > LIMITS.maxCellsPerBox) {
      wide.add(entry);
      return;
    }
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        if (++postings > LIMITS.maxSpatialPostings)
          fail("spatial posting budget");
        const key = `${x},${y}`;
        const list = grid.get(key) ?? [];
        list.push(entry);
        grid.set(key, list);
      }
  }
  function occlude(
    box: PaintedPath["bounds"],
    i: number,
    name: string,
    reason: string,
  ): void {
    let candidates: Iterable<Indexed> = active;
    if (box) {
      const [x0, y0, x1, y1] = cellRange(box);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) <= LIMITS.maxCellsPerBox) {
        const found = new Set(wide);
        for (let x = x0; x <= x1; x++)
          for (let y = y0; y <= y1; y++) {
            if (++spatialChecks > LIMITS.maxSpatialChecks)
              fail("spatial query budget");
            for (const entry of grid.get(`${x},${y}`) ?? []) {
              if (++spatialChecks > LIMITS.maxSpatialChecks)
                fail("spatial candidate budget");
              if (entry.evidence.eligible) found.add(entry);
            }
          }
        candidates = found;
      }
    }
    let affectedEvidence = 0;
    for (const entry of candidates) {
      if (++spatialChecks > LIMITS.maxSpatialChecks)
        fail("spatial overlap budget");
      if (!entry.evidence.eligible || (box && !overlap(entry.box, box)))
        continue;
      entry.evidence.eligible = false;
      entry.evidence.reasons = unique([...entry.evidence.reasons, reason]);
      entry.path.eligible = false;
      entry.path.reasons = unique([...entry.path.reasons, reason]);
      active.delete(entry);
      wide.delete(entry);
      affectedEvidence++;
    }
    occlusionOperations.push({
      operatorIndex: i,
      operator: name,
      bounds: box,
      affectedEvidence,
    });
  }
  let commands: PathCommand[] = [],
    current: Point | null = null,
    start: Point | null = null,
    pendingClip: { operatorIndex: number; evenOdd: boolean } | null = null;
  const cloneState = () => structuredClone(state);
  function addClip(rect: ClipRectangle): void {
    if (state.clips.length >= LIMITS.maxClipRectangles)
      fail("clip rectangle budget");
    state.clips.push(rect);
  }
  function stateReason(reason: string): void {
    if (!state.reasons.includes(reason)) state.reasons.push(reason);
    if (state.reasons.length > LIMITS.maxStateReasons)
      fail("state reason budget");
  }
  function record(i: number, name: string, args: unknown[]): void {
    const record = { operatorIndex: i, operator: name, args };
    graphicsOperations.push(record);
    // Preserve exact final setters without an O(paths × prior-operations) history.
    state.provenance = state.provenance.filter((x) => x.operator !== name);
    state.provenance.push(record);
  }
  function save(kind: string): void {
    if (saved.length >= LIMITS.maxStackDepth) fail("graphics stack budget");
    saved.push({ kind, state: cloneState() });
  }
  function restore(kind: string): void {
    const prior = saved.pop();
    if (!prior || prior.kind !== kind) fail(`unmatched ${kind} restore`);
    state = prior.state;
  }
  function add(
    kind: PathCommand["kind"],
    operands: number[],
    points: Point[],
    i: number,
  ): void {
    if (++commandCount > LIMITS.maxCommands) fail("command budget");
    if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
      fail("nonfinite geometry");
    commands.push({
      kind,
      operatorIndex: i,
      nativeOperands: operands,
      points,
      ctm: [...state.ctm],
    });
    if (kind === "move") {
      current = points[0]!;
      start = current;
    } else if (kind !== "close") current = points[points.length - 1]!;
    else current = start;
  }
  function move(x: number, y: number, i: number): void {
    add("move", [x, y], [point(mul(viewport, state.ctm), x, y)], i);
  }
  function line(x: number, y: number, i: number): void {
    if (!current) fail("line without current point");
    add(
      "line",
      [x, y],
      [{ ...current }, point(mul(viewport, state.ctm), x, y)],
      i,
    );
  }
  function curve(v: number[], quadratic: boolean, i: number): void {
    if (!current) fail("curve without current point");
    if (++curves > LIMITS.maxCurves) fail("curve budget");
    const m = mul(viewport, state.ctm),
      ps = [{ ...current }];
    for (let k = 0; k < v.length; k += 2) ps.push(point(m, v[k]!, v[k + 1]!));
    add(quadratic ? "quadratic" : "cubic", v, ps, i);
  }
  function close(i: number): void {
    if (!current || !start) fail("close without subpath");
    add("close", [], [{ ...current }, { ...start }], i);
  }
  function clipFromPath(): ClipRectangle | null {
    if (
      commands.length !== 5 ||
      commands[0]!.kind !== "move" ||
      commands[4]!.kind !== "close" ||
      commands.slice(1, 4).some((c) => c.kind !== "line")
    )
      return null;
    const ps = [
      commands[0]!.points[0]!,
      ...commands.slice(1, 4).map((c) => c.points[1]!),
    ];
    return rectangle(ps, pendingClip!.operatorIndex);
  }
  function flattenedRuns(path: PaintedPath): ArcEvidence[] {
    const out: ArcEvidence[] = [];
    let points: Point[] = [],
      indices: number[] = [],
      direction = 0,
      totalTurn = 0;
    function flush() {
      if (
        points.length >= LIMITS.minFlattenedVertices &&
        totalTurn >= LIMITS.minFlattenedTotalTurn
      ) {
        if (++curves > LIMITS.maxCurves) fail("flattened curve budget");
        sampledPointCount += points.length;
        if (sampledPointCount > LIMITS.maxSampledPoints)
          fail("flattened point budget");
        out.push({
          id: `${path.id}-flattened${arcs.length + out.length}`,
          pathId: path.id,
          points: points.map((p) => ({ ...p })),
          eligible: path.eligible,
          reasons: [...path.reasons],
          representation: "contiguous-line-run",
          sourceCommandIndices: [...indices],
        });
      }
      points = [];
      indices = [];
      direction = 0;
      totalTurn = 0;
    }
    for (let k = 0; k < path.commands.length; k++) {
      const c = path.commands[k]!;
      if (c.kind !== "line") {
        flush();
        continue;
      }
      const a = c.points[0]!,
        b = c.points[1]!;
      if (a.x === b.x && a.y === b.y) {
        flush();
        continue;
      }
      if (!points.length) {
        points = [a, b];
        indices = [k];
        continue;
      }
      const last = points[points.length - 1]!,
        prev = points[points.length - 2]!;
      if (last.x !== a.x || last.y !== a.y) {
        flush();
        points = [a, b];
        indices = [k];
        continue;
      }
      const dx = last.x - prev.x,
        dy = last.y - prev.y,
        ex = b.x - a.x,
        ey = b.y - a.y,
        turn = Math.atan2(dx * ey - dy * ex, dx * ex + dy * ey),
        sign = Math.abs(turn) <= 1e-12 ? 0 : Math.sign(turn);
      if (
        Math.abs(turn) > LIMITS.maxFlattenedLocalTurn ||
        (sign && direction && sign !== direction)
      ) {
        flush();
        points = [a, b];
        indices = [k];
        continue;
      }
      points.push(b);
      indices.push(k);
      if (sign) direction = sign;
      totalTurn += Math.abs(turn);
    }
    flush();
    return out;
  }
  function paint(op: number, i: number, raw: unknown[] | null = null): void {
    const name = names.get(op)!;
    if (
      closePaints.has(op) &&
      commands.length &&
      commands[commands.length - 1]!.kind !== "close"
    )
      close(i);
    const b = bounds(commands.flatMap((c) => c.points));
    const scale = Math.hypot(...mul(viewport, state.ctm).slice(0, 2));
    const margin = strokes.has(op)
      ? state.lineWidth *
        scale *
        0.5 *
        Math.max(1, state.lineJoin === 0 ? state.miterLimit : 1)
      : 0;
    // A later fill can cover an earlier door/host even when its winding/visibility
    // is unresolved. Bounding-box overlap is deliberately conservative.
    if (
      fills.has(op) &&
      b &&
      state.fillAlpha > 0 &&
      state.fillColor !== "transparent"
    )
      occlude(expanded(b, margin), i, name, "later-fill-occlusion-unresolved");
    if (
      strokes.has(op) &&
      b &&
      state.strokeAlpha > 0 &&
      !neutralColor(state.strokeColor) &&
      state.strokeColor !== "transparent"
    )
      occlude(
        expanded(b, margin),
        i,
        name,
        "later-stroke-occlusion-unresolved",
      );
    const reasons = [...state.reasons];
    if (!strokes.has(op))
      reasons.push(op === OPS.endPath ? "unpainted-path" : "fill-only-path");
    if (fills.has(op)) reasons.push("filled-stroke-path");
    if (!isotropic(state.ctm) || commands.some((c) => !isotropic(c.ctm)))
      reasons.push("nonuniform-or-sheared-ctm");
    if (state.lineWidth === 0) reasons.push("hairline-width-unresolved");
    if (state.dash.length) reasons.push("dashed-stroke");
    if (!neutralColor(state.strokeColor))
      reasons.push("unsupported-or-nonneutral-stroke-color");
    if (!["DeviceRGB", "DeviceGray"].includes(String(state.strokeColorSpace)))
      reasons.push("unsupported-stroke-color-space");
    if (strokes.has(op) && state.strokeAlpha !== 1)
      reasons.push("stroke-transparency");
    if (fills.has(op) && state.fillAlpha !== 1)
      reasons.push("fill-transparency");
    if (!["source-over", "Normal"].includes(String(state.blendMode)))
      reasons.push("unsupported-blend-mode");
    if (state.softMask !== null && state.softMask !== false)
      reasons.push("unsupported-soft-mask");
    if (state.transfer !== null) reasons.push("unsupported-transfer-function");
    if (state.unresolvedClip) reasons.push("unsupported-clip");
    if (marked.some((x) => x.tag === "OC"))
      reasons.push("optional-content-visibility-unresolved");
    if (
      b &&
      state.clips.some(
        (c) =>
          b.minX - margin <= c.minX ||
          b.minY - margin <= c.minY ||
          b.maxX + margin >= c.maxX ||
          b.maxY + margin >= c.maxY,
      )
    )
      reasons.push("clip-containment-unproved");
    if (paths.length >= LIMITS.maxPaths) fail("path budget");
    const id = `p${input.pageIndex}-path${paths.length}`;
    const path: PaintedPath = {
      id,
      sourceSha256: input.sourceSha256,
      pageIndex: input.pageIndex,
      paintOperator: name,
      paintOperatorIndex: i,
      rawConstructPath: raw,
      commands,
      graphicsState: cloneState(),
      markedContent: structuredClone(marked),
      formOperators: [...forms],
      bounds: b,
      eligible: reasons.length === 0,
      reasons: unique(reasons),
    };
    paths.push(path);
    const firstLine = lines.length,
      firstArc = arcs.length;
    if (strokes.has(op))
      for (const [commandIndex, c] of commands.entries()) {
        if (c.kind === "line" || c.kind === "close") {
          const a = c.points[0]!,
            b = c.points[1]!;
          const rr = [...path.reasons];
          if (a.x === b.x && a.y === b.y) rr.push("degenerate-line");
          lines.push({
            id: `${id}-line${lines.length}`,
            a: { ...a },
            b: { ...b },
            pathId: id,
            eligible: rr.length === 0,
            reasons: unique(rr),
          });
        } else if (c.kind === "cubic" || c.kind === "quadratic") {
          const points = sampleCurve(c.points, () => {
            if (++sampledPointCount > LIMITS.maxSampledPoints)
              fail("sampled-point budget");
          });
          const rr = [...path.reasons];
          if (
            c.points.every(
              (p) => p.x === c.points[0]!.x && p.y === c.points[0]!.y,
            )
          )
            rr.push("degenerate-curve");
          arcs.push({
            id: `${id}-curve${arcs.length}`,
            pathId: id,
            points,
            eligible: rr.length === 0,
            reasons: unique(rr),
            representation: "native-curve",
            sourceCommandIndices: [commandIndex],
          });
        }
      }
    if (strokes.has(op)) arcs.push(...flattenedRuns(path));
    for (const evidence of lines.slice(firstLine)) {
      const box = bounds([evidence.a, evidence.b])!;
      indexEvidence(evidence, path, expanded(box, margin));
    }
    for (const evidence of arcs.slice(firstArc)) {
      const controls =
        evidence.sourceCommandIndices?.flatMap((k) => commands[k]!.points) ??
        evidence.points;
      const box = bounds(controls)!;
      indexEvidence(evidence, path, expanded(box, margin));
    }
    if (pendingClip) {
      const rect = clipFromPath();
      if (rect && !pendingClip.evenOdd) addClip(rect);
      else state.unresolvedClip = true;
      pendingClip = null;
    }
    commands = [];
    current = null;
    start = null;
  }
  function packed(args: unknown[], i: number): void {
    if (args.length !== 3) fail("malformed v6 constructPath arity");
    const op = finite(args[0], "construct paint");
    if (!paints.has(op)) fail("unsupported constructPath paint operator");
    if (!Array.isArray(args[1]) || args[1].length !== 1)
      fail("malformed v6 constructPath data wrapper");
    if (commands.length) fail("mixed pending/packed path");
    const stream = args[1][0];
    if (stream === null) {
      if (args[2] !== null) fail("empty constructPath bbox");
      paint(op, i, args);
      return;
    }
    const data = nums(stream, null, "draw stream");
    if (data.length > LIMITS.maxCommands * 7) fail("draw stream budget");
    nums(args[2], 4, "construct bbox");
    for (let k = 0; k < data.length; ) {
      const draw = data[k++]!;
      const n =
        draw === DRAW.move || draw === DRAW.line
          ? 2
          : draw === DRAW.cubic
            ? 6
            : draw === DRAW.quadratic
              ? 4
              : draw === DRAW.close
                ? 0
                : -1;
      if (n < 0 || k + n > data.length) fail("malformed draw opcode/arity");
      const v = data.slice(k, k + n);
      k += n;
      if (draw === DRAW.move) move(v[0]!, v[1]!, i);
      else if (draw === DRAW.line) line(v[0]!, v[1]!, i);
      else if (draw === DRAW.close) close(i);
      else curve(v, draw === DRAW.quadratic, i);
    }
    paint(op, i, args);
  }
  for (let i = 0; i < count; i++) {
    const op = finite(input.fnArray[i], "operator");
    if (!Number.isInteger(op) || !names.has(op))
      fail(`unknown operator at ${i}`);
    const name = names.get(op)!;
    const copied = copy(input.argsArray[i]);
    const args = copied === null ? [] : copied;
    if (!Array.isArray(args)) fail(`malformed arguments for ${name}`);
    // Normalized simple images paint a transformed unit square. Group/repeat,
    // shading, raw path and glyph bounds are unresolved: prior evidence cannot
    // certify visibility in their presence. This is never relaxed after a run.
    if (
      [
        OPS.paintImageXObject,
        OPS.paintInlineImageXObject,
        OPS.paintImageMaskXObject,
        OPS.paintSolidColorImageMask,
      ].includes(op)
    ) {
      const m = mul(viewport, state.ctm),
        box = bounds([
          point(m, 0, 0),
          point(m, 1, 0),
          point(m, 1, 1),
          point(m, 0, 1),
        ]);
      occlude(box, i, name, "later-image-occlusion-unresolved");
    } else if (
      [
        OPS.paintImageXObjectRepeat,
        OPS.paintImageMaskXObjectRepeat,
        OPS.paintImageMaskXObjectGroup,
        OPS.paintInlineImageXObjectGroup,
        OPS.shadingFill,
        OPS.paintXObject,
        OPS.rawFillPath,
      ].includes(op)
    )
      occlude(null, i, name, "later-unbounded-paint-visibility-unresolved");
    else if (
      [
        OPS.showText,
        OPS.showSpacedText,
        OPS.nextLineShowText,
        OPS.nextLineSetSpacingShowText,
      ].includes(op)
    )
      occlude(null, i, name, "later-text-visibility-unresolved");
    const n = (arity: number) => nums(args, arity, name);
    if (op === OPS.constructPath) {
      packed(args, i);
      continue;
    }
    if (paints.has(op)) {
      n(0);
      paint(op, i);
      continue;
    }
    if (op === OPS.moveTo) {
      const v = n(2);
      move(v[0]!, v[1]!, i);
      continue;
    }
    if (op === OPS.lineTo) {
      const v = n(2);
      line(v[0]!, v[1]!, i);
      continue;
    }
    if (op === OPS.curveTo) {
      curve(n(6), false, i);
      continue;
    }
    if (op === OPS.curveTo2 || op === OPS.curveTo3) {
      const v = n(4);
      const cp = current as Point | null;
      if (!cp) fail("short cubic without current point");
      const m = mul(viewport, state.ctm);
      const invdet = m[0] * m[3] - m[1] * m[2];
      if (!invdet) fail("singular short cubic");
      const dx = cp.x - m[4],
        dy = cp.y - m[5];
      const x = (m[3] * dx - m[2] * dy) / invdet,
        y = (-m[1] * dx + m[0] * dy) / invdet;
      curve(
        op === OPS.curveTo2
          ? [x, y, ...v]
          : [v[0]!, v[1]!, v[2]!, v[3]!, v[2]!, v[3]!],
        false,
        i,
      );
      continue;
    }
    if (op === OPS.closePath) {
      n(0);
      close(i);
      continue;
    }
    if (op === OPS.rectangle) {
      const [x, y, w, h] = n(4);
      move(x!, y!, i);
      line(x! + w!, y!, i);
      line(x! + w!, y! + h!, i);
      line(x!, y! + h!, i);
      close(i);
      continue;
    }
    if (op === OPS.save) {
      n(0);
      save("save");
      continue;
    }
    if (op === OPS.restore) {
      n(0);
      restore("save");
      continue;
    }
    if (op === OPS.transform) {
      state.ctm = mul(state.ctm, n(6) as Matrix);
      record(i, name, args);
      continue;
    }
    if (op === OPS.clip || op === OPS.eoClip) {
      n(0);
      if (pendingClip) fail("multiple pending clips");
      pendingClip = { operatorIndex: i, evenOdd: op === OPS.eoClip };
      record(i, name, args);
      continue;
    }
    if (op === OPS.paintFormXObjectBegin) {
      if (args.length !== 2) fail("form begin arity");
      save("form");
      forms.push(i);
      if (args[0] !== null)
        state.ctm = mul(state.ctm, nums(args[0], 6, "form matrix") as Matrix);
      if (args[1] !== null) {
        if (commands.length) paint(OPS.endPath, i);
        const [x0, y0, x1, y1] = nums(args[1], 4, "form bbox");
        if (x1! <= x0! || y1! <= y0!) fail("empty form bbox");
        const m = mul(viewport, state.ctm);
        const r = rectangle(
          [
            point(m, x0!, y0!),
            point(m, x1!, y0!),
            point(m, x1!, y1!),
            point(m, x0!, y1!),
          ],
          i,
        );
        if (r) addClip(r);
        else state.unresolvedClip = true;
      }
      record(i, name, args);
      continue;
    }
    if (op === OPS.paintFormXObjectEnd) {
      n(0);
      restore("form");
      if (forms.pop() === undefined) fail("unmatched form");
      continue;
    }
    if (op === OPS.beginMarkedContent || op === OPS.beginMarkedContentProps) {
      if (
        args.length !== (op === OPS.beginMarkedContent ? 1 : 2) ||
        typeof args[0] !== "string"
      )
        fail("marked-content arity/tag");
      if (marked.length >= LIMITS.maxStackDepth) fail("marked-content budget");
      marked.push({
        tag: args[0],
        properties: args[1] ?? null,
        operatorIndex: i,
      });
      continue;
    }
    if (op === OPS.endMarkedContent) {
      n(0);
      if (!marked.pop()) fail("unmatched marked content");
      continue;
    }
    if (op === OPS.beginGroup || op === OPS.beginAnnotation) {
      save(name);
      stateReason("unsupported-group-or-annotation");
      if (op === OPS.beginGroup && args[0] && typeof args[0] === "object") {
        const matrix = (args[0] as Record<string, unknown>).matrix;
        if (matrix)
          state.ctm = mul(state.ctm, nums(matrix, 6, "group matrix") as Matrix);
      }
      record(i, name, args);
      continue;
    }
    if (op === OPS.endGroup || op === OPS.endAnnotation) {
      restore(op === OPS.endGroup ? "beginGroup" : "beginAnnotation");
      continue;
    }
    if (op === OPS.setGState) {
      if (args.length !== 1 || !Array.isArray(args[0])) fail("gstate arity");
      for (const row of args[0]) {
        if (
          !Array.isArray(row) ||
          row.length !== 2 ||
          typeof row[0] !== "string"
        )
          fail("gstate entry");
        const [k, v] = row;
        if (k === "LW") {
          state.lineWidth = finite(v, "LW");
          if (state.lineWidth < 0) fail("negative width");
        } else if (k === "LC" || k === "LJ") {
          const value = finite(v, k);
          if (![0, 1, 2].includes(value)) fail("invalid cap/join");
          if (k === "LC") state.lineCap = value;
          else state.lineJoin = value;
        } else if (k === "ML") {
          state.miterLimit = finite(v, "ML");
          if (state.miterLimit < 1) fail("miter limit");
        } else if (k === "CA" || k === "ca") {
          const value = finite(v, k);
          if (value < 0 || value > 1) fail("alpha range");
          if (k === "CA") state.strokeAlpha = value;
          else state.fillAlpha = value;
        } else if (k === "D") {
          if (!Array.isArray(v) || v.length !== 2) fail("dash state");
          state.dash = nums(v[0], null, "dash");
          state.dashPhase = finite(v[1], "dash phase");
          if (
            state.dash.some((x) => x < 0) ||
            (state.dash.length && state.dash.every((x) => x === 0))
          )
            fail("dash range");
        } else if (k === "BM") state.blendMode = v;
        else if (k === "SMask") state.softMask = v;
        else if (k === "TR") state.transfer = v;
        else if (k === "RI") state.renderingIntent = v;
        else if (k === "FL") state.flatness = finite(v, "FL");
        else if (k !== "Font") stateReason(`unsupported-gstate-${k}`);
      }
      record(i, name, args);
      continue;
    }
    if (op === OPS.setLineWidth) {
      state.lineWidth = n(1)[0]!;
      if (state.lineWidth < 0) fail("negative width");
    } else if (op === OPS.setLineCap || op === OPS.setLineJoin) {
      const v = n(1)[0]!;
      if (![0, 1, 2].includes(v)) fail("invalid cap/join");
      if (op === OPS.setLineCap) state.lineCap = v;
      else state.lineJoin = v;
    } else if (op === OPS.setMiterLimit) {
      state.miterLimit = n(1)[0]!;
      if (state.miterLimit < 1) fail("miter limit");
    } else if (op === OPS.setDash) {
      if (args.length !== 2) fail("dash arity");
      state.dash = nums(args[0], null, "dash");
      state.dashPhase = finite(args[1], "dash phase");
      if (
        state.dash.some((x) => x < 0) ||
        (state.dash.length && state.dash.every((x) => x === 0))
      )
        fail("dash range");
    } else if (op === OPS.setStrokeRGBColor) {
      state.strokeColor = rgb(args);
      state.strokeColorSpace = "DeviceRGB";
    } else if (op === OPS.setFillRGBColor) {
      state.fillColor = rgb(args);
      state.fillColorSpace = "DeviceRGB";
    } else if (op === OPS.setStrokeGray) {
      state.strokeColor = channelGray(n(1)[0]);
      state.strokeColorSpace = "DeviceGray";
    } else if (op === OPS.setFillGray) {
      state.fillColor = channelGray(n(1)[0]);
      state.fillColorSpace = "DeviceGray";
    } else if (op === OPS.setStrokeTransparent) {
      n(0);
      state.strokeColor = "transparent";
    } else if (op === OPS.setFillTransparent) {
      n(0);
      state.fillColor = "transparent";
    } else if (
      [
        OPS.setStrokeColor,
        OPS.setStrokeColorN,
        OPS.setStrokeCMYKColor,
      ].includes(op)
    )
      state.strokeColor = { unsupportedOperator: name, args };
    else if (
      [OPS.setFillColor, OPS.setFillColorN, OPS.setFillCMYKColor].includes(op)
    )
      state.fillColor = { unsupportedOperator: name, args };
    else if (op === OPS.setStrokeColorSpace) state.strokeColorSpace = args;
    else if (op === OPS.setFillColorSpace) state.fillColorSpace = args;
    else if (op === OPS.setRenderingIntent) state.renderingIntent = args;
    else if (op === OPS.setFlatness) state.flatness = n(1)[0]!;
    else if (op === OPS.setTextRenderingMode) {
      const v = n(1)[0]!;
      if (!Number.isInteger(v) || v < 0 || v > 7) fail("text rendering mode");
      if (v >= 4) state.unresolvedClip = true;
    } else if (op === OPS.rawFillPath) {
      stateReason("unsupported-raw-fill-path");
    } else {
      ignoredOperatorCounts[name] = (ignoredOperatorCounts[name] ?? 0) + 1;
      continue;
    }
    record(i, name, args);
  }
  if (saved.length || marked.length || forms.length)
    fail("unbalanced graphics/content stack");
  if (commands.length || pendingClip) fail("unconsumed path or clip");
  const reasonCounts: Record<string, number> = {};
  for (const p of paths)
    for (const r of p.reasons) reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
  return {
    schemaVersion: "painted-page-evidence-v1",
    sourceSha256: input.sourceSha256,
    pageIndex: input.pageIndex,
    width,
    height,
    paths,
    lines,
    arcs,
    diagnostics: {
      pdfjsVersion: version,
      operatorCount: count,
      commandCount,
      sampledPointCount,
      eligibleLines: lines.filter((x) => x.eligible).length,
      eligibleArcs: arcs.filter((x) => x.eligible).length,
      reasonCounts,
      ignoredOperatorCounts,
      viewportTransform: viewport,
      coordinateSystem: "scale-1-viewport-page-points",
      limits: LIMITS,
      graphicsOperations,
      occlusionOperations,
      visibilityLimitations: [
        "Fill overlap uses conservative full-control bounds, not winding or exact coverage.",
        "Unknown later glyph/shading/group-image bounds invalidate all earlier candidate evidence.",
        "Eligibility certifies supported vector paint evidence only; it is not a room or portal label.",
      ],
    },
  };
}

/** Decode exactly one supplied PDF page. No files, service calls, rasterization or GT. */
export async function extractPaintedPage(
  pdfBytes: Uint8Array,
  pageIndex: number,
): Promise<ParsedPage> {
  if (
    !(pdfBytes instanceof Uint8Array) ||
    pdfBytes.byteLength === 0 ||
    pdfBytes.byteLength > LIMITS.maxPdfBytes
  )
    fail("PDF byte budget");
  if (!Number.isInteger(pageIndex) || pageIndex < 0) fail("page index");
  const sourceSha256 = createHash("sha256").update(pdfBytes).digest("hex");
  // PDF.js transfers its data; an owned copy preserves caller bytes exactly.
  const task = getDocument({
    data: Uint8Array.from(pdfBytes),
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: true,
  });
  try {
    const pdf = await task.promise;
    if (pageIndex >= pdf.numPages) fail("page index outside document");
    const page = await pdf.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1 });
    const ops = await page.getOperatorList();
    return parseOperatorList({
      sourceSha256,
      pageIndex,
      width: viewport.width,
      height: viewport.height,
      viewportTransform: Array.from(viewport.transform) as Matrix,
      fnArray: ops.fnArray,
      argsArray: ops.argsArray,
      pdfjsVersion: version,
    });
  } finally {
    await task.destroy();
  }
}

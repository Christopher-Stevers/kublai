"use client";

import { loadPdfDocument, loadPdfJs } from "./pdf-client";
import type { PipeLabel, PipeLinework, PipeSegment } from "./pipe-system";

/** PDF.js 6 operator numbers; constructPath contains serialized DrawOPS. */
export const PIPE_OPS = {
  setLineWidth: 2,
  setDash: 6,
  setGState: 9,
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
  clip: 29,
  eoClip: 30,
  setStrokeColorN: 53,
  setStrokeGray: 56,
  setStrokeRGBColor: 58,
  setStrokeCMYKColor: 60,
  beginMarkedContent: 69,
  beginMarkedContentProps: 70,
  endMarkedContent: 71,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  beginGroup: 76,
  endGroup: 77,
  constructPath: 91,
  setStrokeTransparent: 92,
} as const;

type Point = { x: number; y: number };
type Matrix = [number, number, number, number, number, number];
type Box = { left: number; top: number; right: number; bottom: number };
type GraphicsState = {
  ctm: Matrix;
  width: number;
  stroke: string;
  dash: number[];
  alpha: number;
  clip: Box;
  unsupportedClip: boolean;
};
type Subpath = {
  points: Point[];
  curved: boolean;
  closed: boolean;
  invalid: boolean;
  curveFailed: boolean;
  limited: boolean;
};
type OptionalLayer = { name?: string; visible: boolean };
export type PipeExtractionOptions = {
  /** Height / width of the same rotated PDF viewport used for toSheet. */
  aspect?: number;
  maxSegments?: number;
  maxOperators?: number;
  resolveOptionalContent?: (properties: unknown) => OptionalLayer;
};

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const SHEET: Box = { left: 0, top: 0, right: 1, bottom: 1 };
// Large CAD sheets routinely contain 100k paths. Preserve late-painted pipe
// overlays instead of letting the first background strokes exhaust the cap.
const MAX_SEGMENTS = 200_000;
const MAX_OPERATORS = 1_000_000;
const MAX_DRAW_VALUES = 4_000_000;
const MAX_TEXT_ITEMS = 30_000;
const MAX_LABELS = 5_000;
// In page-width units. This bounds a rounded elbow's approximation error,
// rather than replacing its arc with one length-understating chord.
export const PIPE_CURVE_FLATNESS = 1e-6;
const MAX_CURVE_DEPTH = 12;
const MAX_CURVE_SEGMENTS = 512;
const STROKED = new Set<number>([
  PIPE_OPS.stroke,
  PIPE_OPS.closeStroke,
  PIPE_OPS.fillStroke,
  PIPE_OPS.eoFillStroke,
  PIPE_OPS.closeFillStroke,
  PIPE_OPS.closeEOFillStroke,
]);
const CLOSES = new Set<number>([
  PIPE_OPS.closeStroke,
  PIPE_OPS.closeFillStroke,
  PIPE_OPS.closeEOFillStroke,
]);

function boundedLimit(value: number | undefined, maximum: number) {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(maximum, Math.floor(value!)))
    : maximum;
}
function validAspect(value: number | undefined) {
  return Number.isFinite(value) && value! > 0 ? value! : 1;
}

function numbers(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number);
  if (ArrayBuffer.isView(value) && "length" in value)
    return Array.from(value as unknown as ArrayLike<number>, Number);
  return [];
}
function argsOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function matrix(value: unknown): Matrix | null {
  const n = numbers(value);
  return n.length >= 6 && n.slice(0, 6).every(Number.isFinite)
    ? [n[0]!, n[1]!, n[2]!, n[3]!, n[4]!, n[5]!]
    : null;
}
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
function apply(m: Matrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}
function distance(a: Point, b: Point, aspect: number) {
  return Math.hypot(a.x - b.x, (a.y - b.y) * aspect);
}
function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function intersect(a: Box, b: Box): Box {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}
/** Clip to the cropped sheet/form: off-page line portions cannot add distance. */
function clipSegment(a: Point, b: Point, box: Box): [Point, Point] | null {
  if (box.left > box.right || box.top > box.bottom) return null;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  let low = 0,
    high = 1;
  for (const [p, q] of [
    [-dx, a.x - box.left],
    [dx, box.right - a.x],
    [-dy, a.y - box.top],
    [dy, box.bottom - a.y],
  ]) {
    if (p === 0) {
      if (q! < 0) return null;
    } else {
      const t = q! / p!;
      if (p! < 0) low = Math.max(low, t);
      else high = Math.min(high, t);
      if (low > high) return null;
    }
  }
  return [
    { x: a.x + low * dx, y: a.y + low * dy },
    { x: a.x + high * dx, y: a.y + high * dy },
  ];
}
function rectangularBox(points: Point[]): Box | null {
  const unique = points.slice();
  if (unique.length > 1 && distance(unique[0]!, unique.at(-1)!, 1) < 1e-9)
    unique.pop();
  if (unique.length !== 4) return null;
  for (let i = 0; i < 4; i++) {
    const a = unique[i]!,
      b = unique[(i + 1) % 4]!;
    if (Math.abs(a.x - b.x) > 1e-9 && Math.abs(a.y - b.y) > 1e-9) return null;
  }
  return {
    left: Math.min(...unique.map((p) => p.x)),
    top: Math.min(...unique.map((p) => p.y)),
    right: Math.max(...unique.map((p) => p.x)),
    bottom: Math.max(...unique.map((p) => p.y)),
  };
}

/** Adaptive subdivision includes collinear backtracking, not just flatness. */
function flattenCubic(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  aspect: number,
): Point[] | null {
  const points: Point[] = [];
  const visit = (
    a: Point,
    b: Point,
    c: Point,
    d: Point,
    depth: number,
  ): boolean => {
    const chord = distance(a, d, aspect);
    const polygon =
      distance(a, b, aspect) + distance(b, c, aspect) + distance(c, d, aspect);
    const crossDistance = (p: Point) =>
      chord > 0
        ? Math.abs(
            (d.x - a.x) * (p.y - a.y) * aspect -
              (d.y - a.y) * aspect * (p.x - a.x),
          ) / chord
        : distance(a, p, aspect);
    if (
      polygon - chord <= PIPE_CURVE_FLATNESS &&
      Math.max(crossDistance(b), crossDistance(c)) <= PIPE_CURVE_FLATNESS
    ) {
      if (points.length >= MAX_CURVE_SEGMENTS) return false;
      points.push(d);
      return true;
    }
    if (depth >= MAX_CURVE_DEPTH) return false;
    const ab = midpoint(a, b),
      bc = midpoint(b, c),
      cd = midpoint(c, d),
      abc = midpoint(ab, bc),
      bcd = midpoint(bc, cd),
      center = midpoint(abc, bcd);
    return (
      visit(a, ab, abc, center, depth + 1) &&
      visit(center, bcd, cd, d, depth + 1)
    );
  };
  return visit(p0, p1, p2, p3, 0) ? points : null;
}

function rgb(values: number[]) {
  const channels = values
    .slice(0, 3)
    .map((v) => Math.max(0, Math.min(255, Math.round(v * 255))));
  return channels.length === 3 && channels.every(Number.isFinite)
    ? `#${channels.map((v) => v.toString(16).padStart(2, "0")).join("")}`
    : "unsupported";
}
function safeLayer(name: unknown) {
  return typeof name === "string"
    ? name
        .replace(/[\x00-\x1f\x7f]/g, "")
        .trim()
        .slice(0, 255) || undefined
    : undefined;
}

/**
 * Deterministic PDF strokes in the drawing image's normalized coordinates.
 * Filled-only text outlines are excluded. Closed straight paths are flagged so
 * the topology engine can distinguish a labeled pipe loop from a room box.
 * Closed curved symbols are excluded. Open curves use bounded subdivision.
 */
export function pipeLineworkFromOperators(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<unknown>,
  toSheet: (x: number, y: number) => Point,
  options: PipeExtractionOptions = {},
): PipeLinework {
  const aspect = validAspect(options.aspect);
  const maxSegments = boundedLimit(options.maxSegments, MAX_SEGMENTS);
  const maxOperators = boundedLimit(options.maxOperators, MAX_OPERATORS);
  const segments: PipeSegment[] = [];
  const warnings = new Set<string>();
  const stack: GraphicsState[] = [];
  const marked: OptionalLayer[] = [];
  let state: GraphicsState = {
    ctm: IDENTITY,
    width: 1,
    stroke: "#000000",
    dash: [],
    alpha: 1,
    clip: SHEET,
    unsupportedClip: false,
  };
  let paths: Subpath[] = [];
  let active: Subpath | null = null;
  let pendingClip = false;
  let staged = 0;
  let drawValues = 0;
  let truncated = fnArray.length > maxOperators;
  const point = (x: number, y: number) => {
    const p = apply(state.ctm, x, y);
    return toSheet(p.x, p.y);
  };
  const push = (p: Point) => {
    if (!active) return;
    if (![p.x, p.y].every(Number.isFinite)) active.invalid = true;
    if (staged >= MAX_SEGMENTS) {
      active.invalid = true;
      active.limited = true;
    } else {
      active.points.push(p);
      staged++;
    }
  };
  const move = (x: number, y: number) => {
    active = {
      points: [],
      curved: false,
      closed: false,
      invalid: false,
      curveFailed: false,
      limited: false,
    };
    if (paths.length < MAX_SEGMENTS) paths.push(active);
    else {
      active.invalid = true;
      truncated = true;
    }
    push(point(x, y));
  };
  const line = (x: number, y: number) => push(point(x, y));
  const close = () => {
    if (!active?.points.length || active.closed) return;
    push(active.points[0]!);
    active.closed = true;
  };
  const curve = (control1: Point, control2: Point, end: Point) => {
    if (!active?.points.length) return;
    active.curved = true;
    const flattened = flattenCubic(
      active.points.at(-1)!,
      control1,
      control2,
      end,
      aspect,
    );
    if (flattened) flattened.forEach(push);
    else {
      active.invalid = true;
      active.curveFailed = true;
      push(end);
    }
  };
  const rectangle = (x: number, y: number, width: number, height: number) => {
    move(x, y);
    line(x + width, y);
    line(x + width, y + height);
    line(x, y + height);
    close();
  };
  const clipBox = (box: number[], transform = state.ctm) => {
    if (box.length < 4 || !box.slice(0, 4).every(Number.isFinite)) return;
    const [x1, y1, x2, y2] = box as [number, number, number, number];
    const points = [
      [x1, y1],
      [x2, y1],
      [x2, y2],
      [x1, y2],
    ].map(([x, y]) => {
      const p = apply(transform, x!, y!);
      return toSheet(p.x, p.y);
    });
    const rect = rectangularBox(points);
    if (rect) state = { ...state, clip: intersect(state.clip, rect) };
    else state = { ...state, unsupportedClip: true };
  };
  const paint = (term: number, operator: number) => {
    if (CLOSES.has(term)) close();
    const visible = !marked.some((layer) => !layer.visible);
    if (
      STROKED.has(term) &&
      visible &&
      state.alpha > 0 &&
      state.stroke !== "transparent" &&
      state.stroke !== "#ffffff"
    ) {
      if (state.unsupportedClip || state.stroke === "unsupported") {
        // These were visible stroked candidates, so a surviving connected
        // trace may omit their continuation. Never present it as a full total.
        truncated = true;
        warnings.add(
          "Some patterned or nonrectangular clipped strokes were excluded.",
        );
      } else {
        const origin = point(0, 0);
        const scale = Math.max(
          distance(origin, point(1, 0), aspect),
          distance(origin, point(0, 1), aspect),
        );
        const width = state.width * scale;
        const dash = state.dash.map((v) => v * scale);
        const layer = [...marked].reverse().find((entry) => entry.name)?.name;
        for (let sub = 0; sub < paths.length; sub++) {
          const pathId = `path-${operator}-${sub}`;
          const path = paths[sub]!;
          // CAD often draws circles/boxes back to their starting point without
          // an explicit PDF closePath. They are still closed symbol paths.
          const closed =
            path.closed ||
            (path.points.length > 2 &&
              distance(path.points[0]!, path.points.at(-1)!, aspect) < 1e-9);
          if (closed && path.curved) continue;
          if (path.curveFailed || path.limited) {
            truncated = true;
            warnings.add(
              "Some paths exceeded the measurement accuracy or size limit and were excluded.",
            );
          }
          if (path.invalid) continue;
          for (let n = 1; n < path.points.length; n++) {
            const clipped = clipSegment(
              path.points[n - 1]!,
              path.points[n]!,
              state.clip,
            );
            if (!clipped || distance(clipped[0], clipped[1], aspect) < 1e-10)
              continue;
            if (segments.length >= maxSegments) {
              truncated = true;
              break;
            }
            segments.push({
              id: `${pathId}-${sub}-${n}`,
              pathId,
              x1: clipped[0].x,
              y1: clipped[0].y,
              x2: clipped[1].x,
              y2: clipped[1].y,
              stroke: state.stroke,
              width,
              dash,
              ...(layer ? { layer } : {}),
              ...(closed ? { closed: true } : {}),
            });
          }
        }
      }
    }
    if (pendingClip) {
      const rect =
        paths.length === 1 && !paths[0]!.curved
          ? rectangularBox(paths[0]!.points)
          : null;
      state = rect
        ? { ...state, clip: intersect(state.clip, rect) }
        : { ...state, unsupportedClip: true };
    }
    paths = [];
    active = null;
    staged = 0;
    pendingClip = false;
  };
  const draw = (buffer: unknown) => {
    const pts = numbers(buffer);
    for (let i = 0; i < pts.length; ) {
      if (drawValues++ >= MAX_DRAW_VALUES) {
        truncated = true;
        paths.forEach((path) => {
          path.invalid = true;
        });
        break;
      }
      const op = pts[i++];
      if (op === 0 || op === 1) {
        if (i + 2 > pts.length) {
          if (active) active.invalid = true;
          break;
        }
        (op === 0 ? move : line)(pts[i++]!, pts[i++]!);
      } else if (op === 2) {
        if (i + 6 > pts.length) {
          if (active) active.invalid = true;
          break;
        }
        const a = point(pts[i++]!, pts[i++]!),
          b = point(pts[i++]!, pts[i++]!),
          c = point(pts[i++]!, pts[i++]!);
        curve(a, b, c);
      } else if (op === 3) {
        if (i + 4 > pts.length) {
          if (active) active.invalid = true;
          break;
        }
        const control = point(pts[i++]!, pts[i++]!),
          end = point(pts[i++]!, pts[i++]!),
          start = active?.points.at(-1);
        if (start)
          curve(
            {
              x: start.x + ((control.x - start.x) * 2) / 3,
              y: start.y + ((control.y - start.y) * 2) / 3,
            },
            {
              x: end.x + ((control.x - end.x) * 2) / 3,
              y: end.y + ((control.y - end.y) * 2) / 3,
            },
            end,
          );
      } else if (op === 4) close();
      else {
        if (active) active.invalid = true;
        break;
      }
    }
  };

  for (let i = 0; i < Math.min(fnArray.length, maxOperators); i++) {
    const fn = fnArray[i]!,
      args = argsOf(argsArray[i]);
    switch (fn) {
      case PIPE_OPS.save:
        stack.push(state);
        break;
      case PIPE_OPS.restore:
        state = stack.pop() ?? state;
        break;
      case PIPE_OPS.transform: {
        const m = matrix(args);
        if (m) state = { ...state, ctm: multiply(state.ctm, m) };
        break;
      }
      case PIPE_OPS.paintFormXObjectBegin: {
        stack.push(state);
        const m = matrix(args[0]);
        if (m) state = { ...state, ctm: multiply(state.ctm, m) };
        clipBox(numbers(args[1]));
        break;
      }
      case PIPE_OPS.paintFormXObjectEnd:
      case PIPE_OPS.endGroup:
        state = stack.pop() ?? state;
        break;
      case PIPE_OPS.beginGroup: {
        stack.push(state);
        const group = args[0] as
          | { bbox?: unknown; matrix?: unknown }
          | undefined;
        if (group?.bbox)
          clipBox(
            numbers(group.bbox),
            multiply(state.ctm, matrix(group.matrix) ?? IDENTITY),
          );
        break;
      }
      case PIPE_OPS.setLineWidth: {
        const width = Number(args[0]);
        if (Number.isFinite(width) && width >= 0) state = { ...state, width };
        break;
      }
      case PIPE_OPS.setDash:
        state = {
          ...state,
          dash: numbers(args[0])
            .filter((v) => Number.isFinite(v) && v >= 0)
            .slice(0, 64),
        };
        break;
      case PIPE_OPS.setStrokeRGBColor:
        state = {
          ...state,
          stroke:
            typeof args[0] === "string" && /^#[\da-f]{6}$/i.test(args[0])
              ? args[0].toLowerCase()
              : rgb(args.map(Number)),
        };
        break;
      case PIPE_OPS.setStrokeGray:
        state = {
          ...state,
          stroke: rgb([Number(args[0]), Number(args[0]), Number(args[0])]),
        };
        break;
      case PIPE_OPS.setStrokeCMYKColor: {
        const [c, m, y, k] = args.map(Number);
        state = {
          ...state,
          stroke: rgb([
            1 - Math.min(1, c! + k!),
            1 - Math.min(1, m! + k!),
            1 - Math.min(1, y! + k!),
          ]),
        };
        break;
      }
      case PIPE_OPS.setStrokeColorN:
        state = { ...state, stroke: "unsupported" };
        break;
      case PIPE_OPS.setStrokeTransparent:
        state = { ...state, stroke: "transparent" };
        break;
      case PIPE_OPS.setGState:
        for (const entry of argsOf(args[0])) {
          const [key, value] = argsOf(entry);
          if (key === "LW" && Number.isFinite(Number(value)))
            state = { ...state, width: Math.abs(Number(value)) };
          if (key === "D")
            state = {
              ...state,
              dash: numbers(argsOf(value)[0])
                .filter((v) => Number.isFinite(v) && v >= 0)
                .slice(0, 64),
            };
          if (key === "CA" && Number.isFinite(Number(value)))
            state = { ...state, alpha: Number(value) };
        }
        break;
      case PIPE_OPS.beginMarkedContent:
        marked.push({ visible: true });
        break;
      case PIPE_OPS.beginMarkedContentProps: {
        const properties = args[1];
        const layer =
          args[0] === "OC"
            ? options.resolveOptionalContent?.(properties)
            : undefined;
        const fallback = properties as { id?: unknown } | null;
        marked.push({
          visible: layer?.visible ?? true,
          name: safeLayer(layer?.name ?? fallback?.id),
        });
        break;
      }
      case PIPE_OPS.endMarkedContent:
        marked.pop();
        break;
      case PIPE_OPS.moveTo:
        move(Number(args[0]), Number(args[1]));
        break;
      case PIPE_OPS.lineTo:
        line(Number(args[0]), Number(args[1]));
        break;
      case PIPE_OPS.curveTo:
        curve(
          point(Number(args[0]), Number(args[1])),
          point(Number(args[2]), Number(args[3])),
          point(Number(args[4]), Number(args[5])),
        );
        break;
      case PIPE_OPS.curveTo2: {
        const start = (active as Subpath | null)?.points.at(-1);
        if (start)
          curve(
            start,
            point(Number(args[0]), Number(args[1])),
            point(Number(args[2]), Number(args[3])),
          );
        break;
      }
      case PIPE_OPS.curveTo3: {
        const end = point(Number(args[2]), Number(args[3]));
        curve(point(Number(args[0]), Number(args[1])), end, end);
        break;
      }
      case PIPE_OPS.closePath:
        close();
        break;
      case PIPE_OPS.rectangle:
        rectangle(
          Number(args[0]),
          Number(args[1]),
          Number(args[2]),
          Number(args[3]),
        );
        break;
      case PIPE_OPS.clip:
      case PIPE_OPS.eoClip:
        pendingClip = true;
        break;
      case PIPE_OPS.constructPath: {
        paths = [];
        active = null;
        staged = 0;
        // CAD lettering is usually many filled outline paths. It contributes
        // no pipe distance and must not consume the vector/curve budget.
        const term = Number(args[0]);
        if (
          (!STROKED.has(term) ||
            state.stroke === "#ffffff" ||
            state.stroke === "transparent" ||
            state.alpha <= 0) &&
          !pendingClip
        ) {
          paint(term, i);
          break;
        }
        const buffers = Array.isArray(args[1]) ? args[1] : [args[1]];
        // A numeric array is one serialized buffer; PDF.js normally wraps a
        // Float32Array in an array. Neither representation is an old OPS list.
        if (buffers.length && typeof buffers[0] === "number") draw(buffers);
        else buffers.forEach(draw);
        paint(term, i);
        break;
      }
      case PIPE_OPS.stroke:
      case PIPE_OPS.closeStroke:
      case PIPE_OPS.fill:
      case PIPE_OPS.eoFill:
      case PIPE_OPS.fillStroke:
      case PIPE_OPS.eoFillStroke:
      case PIPE_OPS.closeFillStroke:
      case PIPE_OPS.closeEOFillStroke:
      case PIPE_OPS.endPath:
        paint(fn, i);
        break;
    }
  }
  return {
    segments,
    labels: [],
    aspect,
    truncated,
    ...(warnings.size ? { warnings: [...warnings] } : {}),
  };
}

const SYSTEM_TOKEN =
  /(?:^|[^A-Z0-9])(?:STORM|ST|SAN|SANITARY|CW|HW|HWR|DCW|DHW|DHWR|RW|RWL|SW|FW|CHWS|CHWR|HWS|MWS|MWR|NG|LPG|GAS|CD|COND|SD|PD|VENT)(?=$|[^A-Z0-9])/g;
const SYSTEM_ALIASES: Record<string, string> = { STORM: "ST", SANITARY: "SAN" };
export function pipeSystemTokens(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.toUpperCase().matchAll(SYSTEM_TOKEN)) {
    const token = match[0].replace(/^[^A-Z0-9]+/, "");
    found.add(SYSTEM_ALIASES[token] ?? token);
  }
  return [...found];
}

export function pipeLabelsFromTextItems(
  items: ArrayLike<unknown>,
  toSheet: (x: number, y: number) => Point,
  options: { aspect?: number; maxItems?: number; maxLabels?: number } = {},
): { labels: PipeLabel[]; truncated: boolean } {
  const aspect = validAspect(options.aspect);
  const maxItems = boundedLimit(options.maxItems, MAX_TEXT_ITEMS);
  const maxLabels = boundedLimit(options.maxLabels, MAX_LABELS);
  const labels: PipeLabel[] = [];
  const letters: {
    text: string;
    start: Point;
    end: Point;
    height: number;
    box: Box;
  }[] = [];
  let truncated = items.length > maxItems;
  const add = (text: string, box: Box) => {
    for (const system of pipeSystemTokens(text)) {
      if (labels.length >= maxLabels) {
        truncated = true;
        return;
      }
      labels.push({ text: text.slice(0, 255), system, ...box });
    }
  };
  for (let i = 0; i < Math.min(items.length, maxItems); i++) {
    const item = items[i] as {
      str?: unknown;
      transform?: unknown;
      width?: unknown;
      height?: unknown;
    } | null;
    if (typeof item?.str !== "string" || !item.str.trim()) continue;
    const m = matrix(item.transform),
      width = Number(item.width),
      height = Number(item.height);
    if (
      !m ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < 0 ||
      height < 0
    )
      continue;
    const length = Math.hypot(m[0], m[1]) || 1,
      up = Math.hypot(m[2], m[3]) || 1;
    const dx = (m[0] / length) * width,
      dy = (m[1] / length) * width;
    const hx = (m[2] / up) * height,
      hy = (m[3] / up) * height;
    const points = [
      toSheet(m[4], m[5]),
      toSheet(m[4] + dx, m[5] + dy),
      toSheet(m[4] + hx, m[5] + hy),
      toSheet(m[4] + dx + hx, m[5] + dy + hy),
    ];
    if (!points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
      continue;
    const box = intersect(SHEET, {
      left: Math.min(...points.map((p) => p.x)),
      top: Math.min(...points.map((p) => p.y)),
      right: Math.max(...points.map((p) => p.x)),
      bottom: Math.max(...points.map((p) => p.y)),
    });
    if (box.left > box.right || box.top > box.bottom) continue;
    add(item.str, box);
    if (/^[A-Z]$/i.test(item.str.trim()))
      letters.push({
        text: item.str.trim(),
        start: points[0]!,
        end: points[1]!,
        height: distance(points[0]!, points[2]!, aspect),
        box,
      });
  }
  // CAD exports can split a two-letter system into individual text objects.
  // Only adjacent, aligned glyphs are joined; arbitrary sheet words are not.
  for (let i = 0; i < letters.length; i++) {
    const first = letters[i]!;
    const direction = {
      x: first.end.x - first.start.x,
      y: (first.end.y - first.start.y) * aspect,
    };
    const length = Math.hypot(direction.x, direction.y);
    if (length === 0 || first.height === 0) continue;
    let text = first.text,
      end = first.end,
      box = first.box;
    for (let n = i + 1; n < Math.min(letters.length, i + 6); n++) {
      const next = letters[n]!;
      const gap = {
        x: next.start.x - end.x,
        y: (next.start.y - end.y) * aspect,
      };
      const along = (gap.x * direction.x + gap.y * direction.y) / length;
      const across =
        Math.abs(gap.x * direction.y - gap.y * direction.x) / length;
      const nextDirection = {
        x: next.end.x - next.start.x,
        y: (next.end.y - next.start.y) * aspect,
      };
      const nextLength = Math.hypot(nextDirection.x, nextDirection.y);
      const aligned =
        nextLength > 0 &&
        (nextDirection.x * direction.x + nextDirection.y * direction.y) /
          (nextLength * length) >
          0.99;
      if (
        !aligned ||
        along < -first.height * 0.2 ||
        along > first.height * 0.5 ||
        across > first.height * 0.2
      )
        break;
      text += next.text;
      end = next.end;
      box = {
        left: Math.min(box.left, next.box.left),
        top: Math.min(box.top, next.box.top),
        right: Math.max(box.right, next.box.right),
        bottom: Math.max(box.bottom, next.box.bottom),
      };
      add(text, box);
    }
  }
  return { labels, truncated };
}

/** No additional parsed-page cache: pdf-client owns logout/identity eviction. */
export async function loadPipeLinework(source: {
  url: string;
  page: number;
  signal?: AbortSignal;
}): Promise<PipeLinework> {
  const checkAbort = () => {
    if (source.signal?.aborted)
      throw new DOMException(
        "The pipe drawing request was cancelled.",
        "AbortError",
      );
  };
  checkAbort();
  const pdfjs = await loadPdfJs();
  if (
    pdfjs.OPS.constructPath !== PIPE_OPS.constructPath ||
    pdfjs.OPS.setStrokeRGBColor !== PIPE_OPS.setStrokeRGBColor
  )
    throw new Error(
      "This PDF viewer uses operator numbers the pipe tool does not know.",
    );
  const document = await loadPdfDocument(source.url);
  checkAbort();
  const page = await document.getPage(source.page);
  const viewport = page.getViewport({ scale: 1 });
  const width = viewport.width || 1,
    height = viewport.height || 1;
  const toSheet = (x: number, y: number) => {
    const converted = viewport.convertToViewportPoint(x, y) as [number, number];
    return { x: converted[0] / width, y: converted[1] / height };
  };
  const [operators, text, optional] = await Promise.all([
    page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE }),
    page.getTextContent(),
    document.getOptionalContentConfig({ intent: "display" }),
  ]);
  checkAbort();
  const aspect = height / width;
  const linework = pipeLineworkFromOperators(
    operators.fnArray,
    operators.argsArray,
    toSheet,
    {
      aspect,
      resolveOptionalContent: (properties) => {
        const raw = properties as { id?: unknown; type?: unknown } | null;
        const group =
          raw?.type === "OCG" && typeof raw.id === "string"
            ? (optional.getGroup(raw.id) as { name?: unknown } | null)
            : null;
        return {
          name: safeLayer(group?.name),
          visible: Boolean(optional.isVisible(properties)),
        };
      },
    },
  );
  const labels = pipeLabelsFromTextItems(text.items, toSheet, { aspect });
  checkAbort();
  return {
    ...linework,
    labels: labels.labels,
    truncated: linework.truncated || labels.truncated,
  };
}

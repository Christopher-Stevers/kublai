"use client";

import { loadPdfDocument, loadPdfJs } from "./pdf-client";
import type { SnapSegment } from "./sheet-snap";

/**
 * Operator numbers from pdf.js (legacy build). constructPath carries the path
 * as draw opcodes: move 0, line 1, curve 2, quadratic 3, close 4.
 */
export const SNAP_OPS = {
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
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  constructPath: 91,
} as const;

const DRAW = {
  moveTo: 0,
  lineTo: 1,
  curveTo: 2,
  quadraticCurveTo: 3,
  closePath: 4,
} as const;

const STROKE = new Set<number>([
  SNAP_OPS.stroke,
  SNAP_OPS.closeStroke,
  SNAP_OPS.fillStroke,
  SNAP_OPS.eoFillStroke,
  SNAP_OPS.closeFillStroke,
  SNAP_OPS.closeEOFillStroke,
]);
const FILL = new Set<number>([
  SNAP_OPS.fill,
  SNAP_OPS.eoFill,
  SNAP_OPS.fillStroke,
  SNAP_OPS.eoFillStroke,
  SNAP_OPS.closeFillStroke,
  SNAP_OPS.closeEOFillStroke,
]);
const CLOSES = new Set<number>([
  SNAP_OPS.closeStroke,
  SNAP_OPS.closeFillStroke,
  SNAP_OPS.closeEOFillStroke,
]);

type Matrix = [number, number, number, number, number, number];
type Point = { x: number; y: number };

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const MAX_RAW = 100_000;

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

function toNumbers(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number);
  if (ArrayBuffer.isView(value) && "length" in value)
    return Array.from(value as unknown as ArrayLike<number>, Number);
  return [];
}

function asArgs(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Straight lines from a PDF operator list, in sheet fractions.
 * Dashed strokes and lines that cross the sheet are kept: those are the grids.
 * Curves are skipped so a door swing is not a snap target.
 */
export function segmentsFromOperators(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<unknown>,
  toSheet: (x: number, y: number) => Point,
): SnapSegment[] {
  const stack: Matrix[] = [];
  let ctm = IDENTITY;
  let path: Point[] = [];
  let start: Point | null = null;
  let subStraight = false;
  let subCurved = false;
  let pending: SnapSegment[] = [];
  const raw: SnapSegment[] = [];

  const addSeg = (a: Point, b: Point) => {
    if (a.x === b.x && a.y === b.y) return;
    const p = toSheet(a.x, a.y);
    const q = toSheet(b.x, b.y);
    if (![p.x, p.y, q.x, q.y].every(Number.isFinite)) return;
    if (p.x === q.x && p.y === q.y) return;
    pending.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y });
  };
  const moveTo = (x: number, y: number) => {
    const p = apply(ctm, x, y);
    start = p;
    path = [p];
    subStraight = false;
    subCurved = false;
  };
  const lineTo = (x: number, y: number) => {
    const p = apply(ctm, x, y);
    const prev = path[path.length - 1];
    if (prev) addSeg(prev, p);
    path.push(p);
    subStraight = true;
  };
  const curveTo = (x: number, y: number) => {
    path.push(apply(ctm, x, y));
    subCurved = true;
  };
  const closePath = () => {
    if (!start || path.length === 0) return;
    const prev = path[path.length - 1]!;
    if (subStraight || !subCurved) addSeg(prev, start);
    path = [start];
    subStraight = false;
    subCurved = false;
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
    start = a;
    path = [a];
    subStraight = true;
    subCurved = false;
  };
  const paint = (term: number) => {
    if (CLOSES.has(term)) closePath();
    if ((STROKE.has(term) || FILL.has(term)) && raw.length < MAX_RAW) {
      const room = MAX_RAW - raw.length;
      raw.push(...pending.slice(0, room));
    }
    pending = [];
    path = [];
    start = null;
    subStraight = false;
    subCurved = false;
  };
  const drawOps = (pts: number[]) => {
    let i = 0;
    while (i < pts.length) {
      const op = pts[i];
      if (op === DRAW.moveTo) {
        moveTo(pts[i + 1] ?? 0, pts[i + 2] ?? 0);
        i += 3;
      } else if (op === DRAW.lineTo) {
        lineTo(pts[i + 1] ?? 0, pts[i + 2] ?? 0);
        i += 3;
      } else if (op === DRAW.curveTo) {
        curveTo(pts[i + 5] ?? 0, pts[i + 6] ?? 0);
        i += 7;
      } else if (op === DRAW.quadraticCurveTo) {
        curveTo(pts[i + 3] ?? 0, pts[i + 4] ?? 0);
        i += 5;
      } else if (op === DRAW.closePath) {
        closePath();
        i += 1;
      } else i += 1;
    }
  };

  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i]!;
    const args = asArgs(argsArray[i]);
    switch (fn) {
      case SNAP_OPS.save:
        stack.push(ctm);
        break;
      case SNAP_OPS.restore: {
        const restored = stack.pop();
        if (restored) ctm = restored;
        break;
      }
      case SNAP_OPS.paintFormXObjectBegin:
        stack.push(ctm);
        if (args[0]) {
          const m = toNumbers(args[0]);
          if (m.length >= 6)
            ctm = multiply(ctm, [m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!]);
        }
        break;
      case SNAP_OPS.paintFormXObjectEnd: {
        const restored = stack.pop();
        if (restored) ctm = restored;
        break;
      }
      case SNAP_OPS.transform:
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
      case SNAP_OPS.moveTo:
        moveTo(Number(args[0]), Number(args[1]));
        break;
      case SNAP_OPS.lineTo:
        lineTo(Number(args[0]), Number(args[1]));
        break;
      case SNAP_OPS.curveTo:
        curveTo(Number(args[4]), Number(args[5]));
        break;
      case SNAP_OPS.curveTo2:
      case SNAP_OPS.curveTo3:
        curveTo(Number(args[2]), Number(args[3]));
        break;
      case SNAP_OPS.closePath:
        closePath();
        break;
      case SNAP_OPS.rectangle:
        rectangle(
          Number(args[0]),
          Number(args[1]),
          Number(args[2]),
          Number(args[3]),
        );
        break;
      case SNAP_OPS.constructPath: {
        pending = [];
        const buffers = Array.isArray(args[1]) ? args[1] : [args[1]];
        for (const buffer of buffers) drawOps(toNumbers(buffer));
        paint(Number(args[0]));
        break;
      }
      case SNAP_OPS.stroke:
      case SNAP_OPS.closeStroke:
      case SNAP_OPS.fillStroke:
      case SNAP_OPS.eoFillStroke:
      case SNAP_OPS.closeFillStroke:
      case SNAP_OPS.closeEOFillStroke:
      case SNAP_OPS.fill:
      case SNAP_OPS.eoFill:
      case SNAP_OPS.endPath:
        paint(fn);
        break;
      default:
        break;
    }
  }
  return raw;
}

/** Straight lines on one PDF page, normalized the same way as the sheet image. */
export async function loadSnapLines(source: { url: string; page: number }) {
  const pdfjs = await loadPdfJs();
  if (
    pdfjs.OPS.constructPath !== SNAP_OPS.constructPath ||
    pdfjs.OPS.lineTo !== SNAP_OPS.lineTo
  ) {
    throw new Error(
      "This PDF viewer uses operator numbers the snap tool does not know.",
    );
  }
  const doc = await loadPdfDocument(source.url);
  const page = await doc.getPage(source.page);
  const viewport = page.getViewport({ scale: 1 });
  const width = viewport.width || 1;
  const height = viewport.height || 1;
  const opList = await page.getOperatorList();
  return segmentsFromOperators(opList.fnArray, opList.argsArray, (x, y) => {
    const converted = viewport.convertToViewportPoint(x, y) as [number, number];
    return { x: converted[0] / width, y: converted[1] / height };
  });
}

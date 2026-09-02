import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export type WallSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** PDF stroke width in page user-space units. */
  strokeWidth: number;
};

export type PdfLabel = {
  name: string;
  x: number;
  y: number;
};

export type PdfRoomSeed = PdfLabel & {
  kind: "unit" | "room";
  areaSqFt?: number;
};

const UNIT_CODE = /^[A-Z]{1,3}\d{2,4}[A-Z]?$/i;
const UNIT_CONTEXT =
  /\b(?:\d[\d,.]*\s*SF|\d+(?:\.\d+)?\s*m²|MICRO|NANO|STUDIO|\d+\s*BD)\b/i;
const ROOM_LABEL =
  /\b(?:kitchen|bath(?:room)?|powder(?:\s*room)?|ensuite|bed(?:room)?|living(?:\s*room)?|family(?:\s*room)?|great\s*room|dining(?:\s*room)?|closet|corridor|hall(?:way)?|foyer|lobby|entry|mudroom|laundry|utility|pantry|storage|mechanical|electrical|elec(?:\.|trical)?\s*closet|stair(?:\s+[A-Z])?|elevator|garbage|office|den|amenity|vest(?:ibule)?|janitor|washroom|locker)\b/i;
const ROOM_ANNOTATION =
  /\b(?:refer|detail|section|typ(?:ical)?|window|wall|door|note|drawing)\b/i;

const RENDER_SCALE = 2;

const OPS = {
  setLineWidth: 2,
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

function segmentLength(seg: WallSegment) {
  return Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
}

export async function extractPdfWalls(
  pdfBuffer: Buffer,
  pageNumber: number,
): Promise<WallSegment[]> {
  const document = await getDocument({
    data: new Uint8Array(pdfBuffer),
    useSystemFonts: true,
  }).promise;
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
  let path: Array<{ x: number; y: number }> = [];
  let start: { x: number; y: number } | null = null;
  const raw: WallSegment[] = [];

  const addSeg = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    if (a.x === b.x && a.y === b.y) return;
    const p1 = toNorm(a.x, a.y);
    const p2 = toNorm(b.x, b.y);
    raw.push({
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      strokeWidth: lineWidth,
    });
  };

  const moveTo = (x: number, y: number) => {
    const p = apply(ctm, x, y);
    start = p;
    path = [p];
  };
  const lineTo = (x: number, y: number) => {
    const p = apply(ctm, x, y);
    const prev = path[path.length - 1];
    if (prev) addSeg(prev, p);
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
    if (!isStroke) return;

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
          lineTo(pts[i + 5] ?? 0, pts[i + 6] ?? 0);
          i += 7;
        } else if (op === DRAW.quadraticCurveTo) {
          lineTo(pts[i + 3] ?? 0, pts[i + 4] ?? 0);
          i += 5;
        } else if (op === DRAW.closePath) {
          closePath();
          i += 1;
        } else {
          i += 1;
        }
      }
    }
  };

  for (let i = 0; i < opList.fnArray.length; i += 1) {
    const fn = opList.fnArray[i]!;
    const args = (opList.argsArray[i] ?? []) as unknown[];
    switch (fn) {
      case OPS.save:
        stateStack.push({ ctm, lineWidth });
        break;
      case OPS.restore:
        {
          const restored = stateStack.pop();
          ctm = restored?.ctm ?? IDENTITY;
          lineWidth = restored?.lineWidth ?? 1;
        }
        break;
      case OPS.setLineWidth:
        lineWidth = Math.max(0, Number(args[0]) || 0);
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
        lineTo(Number(args[4]), Number(args[5]));
        break;
      case OPS.curveTo2:
      case OPS.curveTo3:
        lineTo(Number(args[2]), Number(args[3]));
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

  const minLen = 0.008;
  const axis = raw.filter((seg) => {
    const len = segmentLength(seg);
    if (len < minLen || len > 0.55) return false;
    const midX = (seg.x1 + seg.x2) / 2;
    const midY = (seg.y1 + seg.y2) / 2;
    if (midX < 0.02 || midX > 0.98 || midY < 0.02 || midY > 0.98) return false;
    const dx = Math.abs(seg.x2 - seg.x1);
    const dy = Math.abs(seg.y2 - seg.y1);
    return dy < dx * 0.18 || dx < dy * 0.18;
  });

  const walls = axis
    .sort((a, b) => segmentLength(b) - segmentLength(a))
    .slice(0, 4000);

  console.log(
    "[pdf-walls] page",
    pageNumber,
    "raw",
    raw.length,
    "kept",
    walls.length,
  );
  return walls;
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
    const transform = item.transform as number[];
    const [vx, vy] = viewport.convertToViewportPoint(
      transform[4] ?? 0,
      transform[5] ?? 0,
    );
    labels.push({
      name,
      x: clamp01(vx / canvasW),
      y: clamp01(vy / canvasH),
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

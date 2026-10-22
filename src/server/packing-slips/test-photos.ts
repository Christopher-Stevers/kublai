/** Synthetic phone photos of packing slips, for the end-to-end benchmark
 * (scripts/benchmark-slip-photos.ts). Deterministic per seed.
 *
 * Print: laser; pre-printed forms filled in by an impact printer, slightly
 * out of register; dot matrix, often a carbon copy on tinted paper.
 * Pen: big ticks across the shipped numbers, short counts circled or struck
 * out with the real count written beside them, pick tickets whose shipped
 * column is filled in by hand, signatures, dates, stamps and highlighter.
 * Camera: folds and curl, perspective, surface, shadow, light colour, focus
 * and noise. */
import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import sharp from "sharp";
import type { Pixels, Point, Quad } from "~/lib/scanning/page";
import {
  makeSlip,
  type SlipPage,
  type SlipText,
  type SlipTruth,
  type TestSlip,
} from "./test-slips";

export const PAGE_WIDTH = 1700;
export const PAGE_HEIGHT = 2200;

export type PrintStyle = "laser" | "form" | "dotmatrix";
export type PenMarks = "clean" | "ticks" | "corrections" | "handwritten";
export type PhotoTruth = SlipTruth & {
  /** Shipped as printed, in the order item's unit; null when the column was
   * left blank for a count written by hand. */
  printed: number | null;
  /** Count written by hand, which is what arrived. */
  written?: number;
};
export type PhotoSlip = Omit<TestSlip, "truth"> & {
  style: PrintStyle;
  marks: PenMarks;
  truth: PhotoTruth[];
  /** Each page as printed and marked, before the camera. */
  images: Pixels[];
  /** Tri-fold creases, as fractions of the page height. */
  folds: number[];
};

type Rnd = () => number;
function random(seed: number): Rnd {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (rnd: Rnd, a: number, b: number) => a + rnd() * (b - a);
const pickOf = <T>(rnd: Rnd, list: readonly T[]) =>
  list[Math.floor(rnd() * list.length)]!;
function hash(x: number, y: number, s: number) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise in roughly [0, 1]. */
function smoothNoise(x: number, y: number, s: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx),
    uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s),
    b = hash(ix + 1, iy, s),
    c = hash(ix, iy + 1, s),
    d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

// ---------- Pen ----------

type Pen = { color: string; width: number };
type Stroke = Array<[number, number]>;
/** Single-stroke handwritten glyphs in a box 0.6 wide and 1 tall, y down. */
const GLYPHS: Record<string, Stroke[]> = {
  "0": [
    [
      [0.32, 0.02],
      [0.1, 0.18],
      [0.03, 0.5],
      [0.12, 0.86],
      [0.32, 1],
      [0.52, 0.84],
      [0.58, 0.48],
      [0.5, 0.14],
      [0.3, 0.01],
      [0.2, 0.08],
    ],
  ],
  "1": [
    [
      [0.1, 0.22],
      [0.32, 0],
      [0.3, 1],
    ],
  ],
  "2": [
    [
      [0.04, 0.22],
      [0.18, 0.03],
      [0.36, 0],
      [0.52, 0.12],
      [0.5, 0.34],
      [0.28, 0.62],
      [0.03, 0.98],
      [0.32, 0.97],
      [0.6, 0.99],
    ],
  ],
  "3": [
    [
      [0.05, 0.1],
      [0.28, 0],
      [0.5, 0.08],
      [0.5, 0.28],
      [0.24, 0.46],
      [0.5, 0.56],
      [0.58, 0.78],
      [0.42, 0.97],
      [0.2, 1],
      [0.02, 0.9],
    ],
  ],
  "4": [
    [
      [0.44, 1],
      [0.45, 0.02],
      [0.02, 0.68],
      [0.6, 0.66],
    ],
  ],
  "5": [
    [
      [0.56, 0.02],
      [0.14, 0.02],
      [0.08, 0.44],
      [0.32, 0.38],
      [0.54, 0.5],
      [0.58, 0.75],
      [0.42, 0.96],
      [0.2, 1],
      [0.02, 0.9],
    ],
  ],
  "6": [
    [
      [0.5, 0.02],
      [0.24, 0.24],
      [0.07, 0.6],
      [0.12, 0.9],
      [0.32, 1],
      [0.52, 0.88],
      [0.55, 0.66],
      [0.36, 0.52],
      [0.14, 0.58],
      [0.07, 0.72],
    ],
  ],
  "7": [
    [
      [0.02, 0.03],
      [0.58, 0.01],
      [0.38, 0.45],
      [0.22, 1],
    ],
  ],
  "8": [
    [
      [0.48, 0.14],
      [0.3, 0.01],
      [0.1, 0.1],
      [0.13, 0.34],
      [0.46, 0.6],
      [0.56, 0.82],
      [0.32, 1],
      [0.06, 0.84],
      [0.12, 0.62],
      [0.46, 0.38],
      [0.5, 0.16],
    ],
  ],
  "9": [
    [
      [0.52, 0.28],
      [0.34, 0.46],
      [0.1, 0.42],
      [0.05, 0.2],
      [0.24, 0.01],
      [0.48, 0.06],
      [0.54, 0.3],
      [0.5, 0.66],
      [0.44, 1],
    ],
  ],
  "-": [
    [
      [0.08, 0.56],
      [0.5, 0.54],
    ],
  ],
  "/": [
    [
      [0.56, 0],
      [0.06, 1],
    ],
  ],
};

/** A smooth stroke through the points (Catmull-Rom). */
function stroke(ctx: SKRSContext2D, pts: Point[]) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  if (pts.length === 2) ctx.lineTo(pts[1]!.x, pts[1]!.y);
  else
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)]!,
        p1 = pts[i]!,
        p2 = pts[i + 1]!,
        p3 = pts[Math.min(pts.length - 1, i + 2)]!;
      ctx.bezierCurveTo(
        p1.x + (p2.x - p0.x) / 6,
        p1.y + (p2.y - p0.y) / 6,
        p2.x - (p3.x - p1.x) / 6,
        p2.y - (p3.y - p1.y) / 6,
        p2.x,
        p2.y,
      );
    }
  ctx.stroke();
}
function takePen(ctx: SKRSContext2D, pen: Pen) {
  ctx.strokeStyle = pen.color;
  ctx.lineWidth = pen.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Ink darkens what is under it, like a real pen over print.
  ctx.globalCompositeOperation = "multiply";
}
const advance = (ch: string) => (ch === "1" ? 0.42 : 0.66);
const writtenWidth = (text: string, height: number) =>
  [...text].reduce((s, ch) => s + advance(ch) + 0.07, 0) * height;

/** Writes digits by hand; returns the width used. */
function write(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  baseline: number,
  height: number,
  pen: Pen,
  rnd: Rnd,
) {
  takePen(ctx, pen);
  const slant = between(rnd, -0.05, 0.25),
    drift = between(rnd, -0.06, 0.06);
  let cx = x;
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    const size = height * between(rnd, 0.92, 1.08);
    if (glyph)
      for (const s of glyph)
        stroke(
          ctx,
          s.map(([gx, gy]) => {
            const jx = gx + (rnd() - 0.5) * 0.07,
              jy = gy + (rnd() - 0.5) * 0.07;
            return {
              x: cx + jx * size + (1 - jy) * size * slant,
              y: baseline - size + jy * size + (cx - x) * drift,
            };
          }),
        );
    cx += size * advance(ch) + height * between(rnd, 0.03, 0.11);
  }
  ctx.globalCompositeOperation = "source-over";
  return cx - x;
}
function tick(
  ctx: SKRSContext2D,
  cx: number,
  cy: number,
  size: number,
  pen: Pen,
  rnd: Rnd,
) {
  takePen(ctx, pen);
  const angle = between(rnd, -0.25, 0.2),
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  const shape: Array<[number, number]> = [
    [-0.45, -0.05],
    [-0.3, 0.12],
    [-0.16, 0.32],
    [0.04, 0.02],
    [0.25, -0.3],
    [0.52, -0.62],
  ];
  stroke(
    ctx,
    shape.map(([x, y]) => {
      const jx = x + (rnd() - 0.5) * 0.06,
        jy = y + (rnd() - 0.5) * 0.06;
      return {
        x: cx + (jx * cos - jy * sin) * size,
        y: cy + (jx * sin + jy * cos) * size,
      };
    }),
  );
  ctx.globalCompositeOperation = "source-over";
}
type Box = { left: number; top: number; right: number; bottom: number };
function circle(ctx: SKRSContext2D, box: Box, pen: Pen, rnd: Rnd) {
  takePen(ctx, pen);
  const pad = (box.bottom - box.top) * 0.45;
  const cx = (box.left + box.right) / 2,
    cy = (box.top + box.bottom) / 2,
    rx = (box.right - box.left) / 2 + pad,
    ry = (box.bottom - box.top) / 2 + pad;
  const start = between(rnd, -2.6, -1.4),
    sweep = 2 * Math.PI + between(rnd, 0.2, 0.6);
  const pts: Point[] = [];
  for (let k = 0; k <= 28; k++) {
    const a = start + (sweep * k) / 28,
      r = 1 + (rnd() - 0.5) * 0.08 + (k / 28) * 0.08;
    pts.push({ x: cx + rx * r * Math.cos(a), y: cy + ry * r * Math.sin(a) });
  }
  stroke(ctx, pts);
  ctx.globalCompositeOperation = "source-over";
}
function strike(ctx: SKRSContext2D, box: Box, pen: Pen, rnd: Rnd) {
  takePen(ctx, pen);
  const h = box.bottom - box.top;
  for (let k = rnd() < 0.4 ? 2 : 1; k > 0; k--) {
    const y = (box.top + box.bottom) / 2 + (rnd() - 0.5) * h * 0.3;
    stroke(ctx, [
      { x: box.left - h * 0.3, y: y + h * between(rnd, -0.25, 0.25) },
      { x: box.right + h * 0.3, y: y + h * between(rnd, -0.25, 0.25) },
    ]);
  }
  ctx.globalCompositeOperation = "source-over";
}
function signature(
  ctx: SKRSContext2D,
  x: number,
  baseline: number,
  width: number,
  height: number,
  pen: Pen,
  rnd: Rnd,
) {
  takePen(ctx, pen);
  const pts: Point[] = [];
  for (let px = x; px < x + width; px += height * between(rnd, 0.12, 0.4))
    pts.push({
      x: px + (rnd() - 0.5) * height * 0.5,
      y: baseline - rnd() * height * (rnd() < 0.2 ? 1.6 : 0.8),
    });
  stroke(ctx, pts);
  stroke(ctx, [
    { x: x + width * 0.1, y: baseline + height * 0.25 },
    { x: x + width * 0.6, y: baseline + height * between(rnd, 0, 0.4) },
    { x: x + width * 1.05, y: baseline + height * between(rnd, -0.3, 0.2) },
  ]);
  ctx.globalCompositeOperation = "source-over";
}
function roundedRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function stamp(ctx: SKRSContext2D, x: number, y: number, rnd: Rnd) {
  const color = pickOf(rnd, ["#b3262e", "#2b3f9e", "#5b2a8c"]);
  const w = 440,
    h = 180,
    s = createCanvas(w, h),
    c = s.getContext("2d");
  c.strokeStyle = c.fillStyle = color;
  c.lineWidth = 7;
  roundedRect(c, 6, 6, w - 12, h - 12, 18);
  c.stroke();
  c.lineWidth = 3;
  roundedRect(c, 20, 20, w - 40, h - 40, 10);
  c.stroke();
  c.textAlign = "center";
  c.font = 'bold 62px "Liberation Sans"';
  c.fillText(pickOf(rnd, ["RECEIVED", "CHECKED", "ENTERED"]), w / 2, 96);
  c.font = 'bold 34px "Liberation Mono"';
  c.fillText(`OCT ${10 + Math.floor(rnd() * 18)} 2026`, w / 2, 142);
  // Rubber stamps print patchily.
  const image = c.getImageData(0, 0, w, h),
    seed = Math.floor(rnd() * 1e6);
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4 + 3;
      image.data[i] =
        image.data[i]! *
        Math.min(
          1,
          0.35 +
            0.8 * smoothNoise(px / 23, py / 17, seed) +
            0.2 * hash(px, py, seed),
        );
    }
  c.putImageData(image, 0, 0);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(between(rnd, -0.25, 0.25));
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = between(rnd, 0.6, 0.9);
  ctx.drawImage(s, -w / 2, -h / 2);
  ctx.restore();
}

// ---------- Print ----------

type Plan = {
  style: PrintStyle;
  marks: PenMarks;
  paper: [number, number, number];
  ink: string;
  /** Ribbon or toner: 1 is full strength. */
  strength: number;
  carbon: boolean;
  /** Pre-printed form colour, when the slip is printed onto a form. */
  form: string | null;
  /** Printer misregistration against the form, in page fractions. */
  shift: { x: number; y: number };
  zebra: boolean;
  dots: number;
  pen: Pen;
  ticks: Set<number>;
  corrections: Map<number, { written: number; how: "circle" | "strike" }>;
  highlight: Set<number>;
  signature: boolean;
  date: boolean;
  stamp: { x: number; y: number } | null;
  folds: number[];
};

const QUANTITY_FIELDS = new Set(["shipped", "qty"]);
/** Pixel box of printed text. */
function textBox(t: SlipText, mono: boolean): Box {
  const px = t.size * PAGE_HEIGHT,
    width = t.text.length * px * (mono ? 0.6 : 0.54);
  const x = t.x * PAGE_WIDTH,
    left = t.align === "right" ? x - width : x;
  return {
    left,
    right: left + width,
    top: t.y * PAGE_HEIGHT - px * 0.74,
    bottom: t.y * PAGE_HEIGHT,
  };
}
const printedByForm = (t: SlipText) =>
  t.role === "heading" ||
  t.text === "PACKING SLIP" ||
  t.text === "SHIP TO:" ||
  t.text === "SOLD TO:";

function paintPage(
  slip: TestSlip,
  index: number,
  plan: Plan,
  rnd: Rnd,
): Pixels {
  const page = slip.pages[index]!;
  const W = PAGE_WIDTH,
    H = PAGE_HEIGHT;
  const canvas = createCanvas(W, H),
    ctx = canvas.getContext("2d");
  const [pr, pg, pb] = plan.paper;
  ctx.fillStyle = `rgb(${pr},${pg},${pb})`;
  ctx.fillRect(0, 0, W, H);
  const texts = page.texts.filter(
    (t) =>
      !(
        plan.marks === "handwritten" &&
        (t.role === "total" ||
          (t.line !== undefined &&
            (QUANTITY_FIELDS.has(t.field ?? "") ||
              t.field === "backordered" ||
              t.field === "amount")))
      ),
  );
  const table = page.table;
  const lineBands = new Map<number, Box>();
  for (const t of page.texts)
    if (t.line !== undefined) {
      const b = textBox(t, slip.mono),
        old = lineBands.get(t.line);
      lineBands.set(
        t.line,
        old
          ? {
              left: Math.min(old.left, b.left),
              right: Math.max(old.right, b.right),
              top: Math.min(old.top, b.top),
              bottom: Math.max(old.bottom, b.bottom),
            }
          : b,
      );
    }
  if (plan.zebra && table)
    [...lineBands.entries()].forEach(([line, b]) => {
      if (line % 2) return;
      ctx.fillStyle = "rgba(0,0,0,0.07)";
      const pad = (b.bottom - b.top) * 0.45;
      ctx.fillRect(
        table.columns[0]!.left * W,
        b.top - pad,
        (table.columns.at(-1)!.right - table.columns[0]!.left) * W,
        b.bottom - b.top + pad * 2,
      );
    });

  // The pre-printed form: shaded heading band, table box, column lines.
  if (plan.form && table) {
    const headings = page.texts.filter((t) => t.role === "heading");
    const bandBottom = headings.length
      ? Math.max(...headings.map((t) => t.y)) + headings[0]!.size * 0.55
      : table.top;
    const left = table.columns[0]!.left * W - 6,
      right = table.columns.at(-1)!.right * W + 6,
      top = table.top * H,
      bottom = Math.max(table.bottom, 0.8) * H;
    ctx.fillStyle = plan.form;
    ctx.globalAlpha = 0.22;
    ctx.fillRect(left, top, right - left, bandBottom * H - top);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = plan.form;
    ctx.lineWidth = 3;
    ctx.strokeRect(left, top, right - left, bottom - top);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, bandBottom * H);
    ctx.lineTo(right, bandBottom * H);
    // Column lines sit in the gaps the form was designed with; columns that
    // run into each other share a box.
    const extent = (field: string) =>
      page.texts.filter((t) => t.field === field).map((t) => textBox(t, true));
    table.columns.slice(1).forEach((c, i) => {
      const before = extent(table.columns[i]!.field),
        after = extent(c.field);
      const end = Math.max(c.left * W - 10, ...before.map((b) => b.right)),
        start = Math.min(c.left * W, ...after.map((b) => b.left));
      if (start - end < 8) return;
      const x = (end + start) / 2;
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
    });
    ctx.stroke();
    ctx.fillStyle = plan.form;
    for (const t of page.texts.filter(printedByForm)) {
      const px = Math.round(t.size * H * (t.role === "heading" ? 0.9 : 1));
      ctx.font = `bold ${px}px "Liberation Sans"`;
      ctx.textAlign = t.align;
      ctx.fillText(t.text, t.x * W, t.y * H);
    }
  }

  // The printer's own output.
  const ink = createCanvas(W, H),
    ic = ink.getContext("2d");
  const variable = plan.form ? texts.filter((t) => !printedByForm(t)) : texts;
  const dx = plan.shift.x * W,
    dy = plan.shift.y * H;
  if (plan.style === "dotmatrix") paintDots(ic, variable, page, plan, rnd);
  else {
    ic.fillStyle = ic.strokeStyle = plan.ink;
    const family =
      plan.style === "form"
        ? "Nimbus Mono PS"
        : slip.mono
          ? "Liberation Mono"
          : "Liberation Sans";
    for (const t of variable) {
      const px = Math.round(t.size * H);
      ic.font = `${t.bold ? "bold " : ""}${px}px "${family}"`;
      if (plan.style === "laser") {
        ic.textAlign = t.align;
        ic.fillText(t.text, t.x * W + dx, t.y * H + dy);
        continue;
      }
      // Impact printer: each character struck separately, unevenly.
      const step = px * 0.6,
        start =
          (t.align === "right" ? t.x * W - t.text.length * step : t.x * W) + dx;
      ic.textAlign = "left";
      [...t.text].forEach((ch, k) => {
        ic.globalAlpha = Math.min(1, plan.strength * between(rnd, 0.72, 1.05));
        ic.fillText(ch, start + k * step, t.y * H + dy + (rnd() - 0.5) * 1.2);
      });
      ic.globalAlpha = 1;
    }
    if (!plan.form) {
      ic.lineWidth = 2;
      for (const r of page.rules) {
        ic.beginPath();
        ic.moveTo(r.x1 * W, r.y1 * H);
        ic.lineTo(r.x2 * W, r.y2 * H);
        ic.stroke();
      }
    }
  }
  if (plan.carbon || plan.style === "laser") {
    // Carbon spreads; toner is crisp but slightly soft once photocopied.
    const soft = createCanvas(W, H),
      sc = soft.getContext("2d");
    sc.filter = `blur(${plan.carbon ? 0.9 : 0.35}px)`;
    sc.drawImage(ink, 0, 0);
    ctx.globalAlpha = plan.strength;
    ctx.drawImage(soft, 0, 0);
  } else ctx.drawImage(ink, 0, 0);
  ctx.globalAlpha = 1;

  // Highlighter under the pen marks.
  for (const line of plan.highlight) {
    const b = lineBands.get(line);
    if (!b) continue;
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "rgba(255,236,60,0.55)";
    const h = (b.bottom - b.top) * 1.6;
    ctx.beginPath();
    ctx.moveTo(b.left - 10, b.bottom + h * 0.2);
    ctx.lineTo(b.right + 10, b.bottom + h * 0.2 + between(rnd, -6, 6));
    ctx.lineTo(b.right + 10, b.bottom - h + between(rnd, -6, 6));
    ctx.lineTo(b.left - 10, b.bottom - h);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }

  // Pen marks on the quantities.
  for (const t of page.texts) {
    if (t.line === undefined || !QUANTITY_FIELDS.has(t.field ?? "")) continue;
    const box = textBox(t, slip.mono);
    const h = box.bottom - box.top,
      px = t.size * H;
    const shift = { x: dx, y: dy };
    box.left += shift.x;
    box.right += shift.x;
    box.top += shift.y;
    box.bottom += shift.y;
    if (plan.marks === "handwritten") {
      const size = px * between(rnd, 1.05, 1.5),
        width = writtenWidth(t.text, size);
      const right = t.align === "right" ? box.right : box.left + width;
      write(
        ctx,
        t.text,
        right - width + between(rnd, -0.4, 0.2) * px,
        box.bottom + between(rnd, -0.15, 0.25) * px,
        size,
        plan.pen,
        rnd,
      );
      if (plan.ticks.has(t.line))
        tick(
          ctx,
          right + px * 0.9,
          box.bottom - h * 0.5,
          px * 1.4,
          plan.pen,
          rnd,
        );
      continue;
    }
    const fix = plan.corrections.get(t.line);
    if (fix) {
      const size = px * between(rnd, 1.1, 1.45),
        width = writtenWidth(String(fix.written), size);
      if (fix.how === "circle") {
        circle(ctx, box, plan.pen, rnd);
        write(
          ctx,
          String(fix.written),
          box.left - h * 0.9 - width,
          box.bottom + px * 0.1,
          size,
          plan.pen,
          rnd,
        );
      } else {
        strike(ctx, box, plan.pen, rnd);
        write(
          ctx,
          String(fix.written),
          (box.left + box.right) / 2 - width / 2,
          box.top - px * 0.25,
          size,
          plan.pen,
          rnd,
        );
      }
      continue;
    }
    if (plan.ticks.has(t.line)) {
      // Mostly beside the number; sometimes right across it.
      const size = px * between(rnd, 1.1, 2),
        where = rnd();
      tick(
        ctx,
        where < 0.25
          ? (box.left + box.right) / 2 + between(rnd, -0.3, 0.3) * px
          : where < 0.75
            ? box.right + size * 0.55
            : box.left - size * 0.6,
        (box.top + box.bottom) / 2 + between(rnd, -0.3, 0.1) * px,
        size,
        plan.pen,
        rnd,
      );
    }
  }
  for (const t of page.texts) {
    if (plan.signature && t.text.startsWith("Received by")) {
      const px = t.size * H;
      signature(
        ctx,
        t.x * W + px * 8,
        t.y * H - px * 0.2,
        px * between(rnd, 9, 13),
        px * 1.3,
        plan.pen,
        rnd,
      );
      if (plan.date)
        write(
          ctx,
          `10/${10 + Math.floor(rnd() * 18)}`,
          t.x * W + px * 34,
          t.y * H - px * 0.15,
          px * 1.3,
          plan.pen,
          rnd,
        );
    }
  }
  if (plan.stamp) stamp(ctx, plan.stamp.x * W, plan.stamp.y * H, rnd);

  // Paper grain, mottling and the creases of a tri-fold.
  const image = ctx.getImageData(0, 0, W, H),
    d = image.data,
    seed = Math.floor(rnd() * 1e6);
  const creases = plan.folds.map((f) => f * H);
  for (let y = 0; y < H; y++) {
    let crease = 1;
    for (const c of creases) {
      const dist = Math.abs(y - c);
      if (dist < 3) crease = Math.min(crease, 0.9 + dist * 0.03);
    }
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const k =
        crease *
        (1 + (smoothNoise(x / 90, y / 90, seed) - 0.5) * 0.05) *
        (1 + (hash(x, y, seed) - 0.5) * 0.035);
      d[i] = d[i]! * k;
      d[i + 1] = d[i + 1]! * k;
      d[i + 2] = d[i + 2]! * k;
    }
  }
  return { data: d, width: W, height: H };
}

/** Dot matrix: text and rules rasterised to the print head's dot grid. */
function paintDots(
  ctx: SKRSContext2D,
  texts: SlipText[],
  page: SlipPage,
  plan: Plan,
  rnd: Rnd,
) {
  const W = PAGE_WIDTH,
    H = PAGE_HEIGHT,
    k = plan.dots;
  const mw = Math.round(W * k),
    mh = Math.round(H * k);
  const mask = createCanvas(mw, mh),
    m = mask.getContext("2d");
  m.fillStyle = m.strokeStyle = "#000";
  const strength = new Map<number, number>();
  for (const t of texts) {
    const px = Math.max(6, Math.round(t.size * H * k));
    m.font = `${t.bold ? "bold " : ""}${px}px "Liberation Mono"`;
    m.textAlign = t.align;
    // Pins are round, so every stroke is at least a dot wide.
    m.lineWidth = 0.7;
    const x = (t.x * W + plan.shift.x * W) * k,
      y = (t.y * H + plan.shift.y * H) * k;
    m.fillText(t.text, x, y);
    m.strokeText(t.text, x, y);
    strength.set(Math.round(t.y * H * k), between(rnd, 0.75, 1.05));
  }
  if (!plan.form) {
    m.setLineDash([2, 2]);
    m.lineWidth = 1;
    for (const r of page.rules) {
      m.beginPath();
      m.moveTo(r.x1 * W * k, r.y1 * H * k);
      m.lineTo(r.x2 * W * k, r.y2 * H * k);
      m.stroke();
    }
  }
  const md = m.getImageData(0, 0, mw, mh).data;
  const radius = (0.62 / k) * between(rnd, 0.9, 1.1);
  const rows = [...strength.keys()].sort((a, b) => a - b);
  ctx.fillStyle = plan.ink;
  for (let y = 0; y < mh; y++) {
    // Ribbon wear: each printed line strikes a little differently.
    const near = rows.find((r) => r >= y) ?? rows.at(-1);
    const lineStrength = (near !== undefined ? strength.get(near) : 1) ?? 1;
    for (let x = 0; x < mw; x++) {
      if (md[(y * mw + x) * 4 + 3]! < 90) continue;
      ctx.globalAlpha = Math.min(
        1,
        plan.strength * lineStrength * between(rnd, 0.75, 1.1),
      );
      ctx.beginPath();
      ctx.arc((x + 0.5) / k, (y + 0.5) / k, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function plan(slip: TestSlip, rnd: Rnd, style: PrintStyle, marks: PenMarks) {
  const tints: Array<[number, number, number]> = [
    [246, 238, 172],
    [245, 214, 222],
    [214, 238, 214],
    [214, 228, 246],
  ];
  const carbon = style === "dotmatrix" ? rnd() < 0.6 : false;
  const paper: [number, number, number] =
    carbon || (style !== "laser" && rnd() < 0.3)
      ? pickOf(rnd, tints)
      : [247, 247, 243];
  const penKind = pickOf(rnd, [
    "blue",
    "blue",
    "black",
    "marker",
    "red",
    "pencil",
  ] as const);
  const pen: Pen = {
    blue: { color: "rgba(28,48,150,0.9)", width: between(rnd, 3.2, 4.5) },
    black: { color: "rgba(22,22,28,0.9)", width: between(rnd, 3.2, 4.5) },
    marker: { color: "rgba(20,20,26,0.95)", width: between(rnd, 6.5, 9) },
    red: { color: "rgba(185,30,40,0.9)", width: between(rnd, 3.2, 4.5) },
    pencil: { color: "rgba(80,80,86,0.75)", width: between(rnd, 2.5, 3.4) },
  }[penKind];
  // Quantity texts per truth line.
  const quantity = new Map<number, SlipText>();
  for (const page of slip.pages)
    for (const t of page.texts)
      if (t.line !== undefined && QUANTITY_FIELDS.has(t.field ?? ""))
        quantity.set(t.line, t);
  const lines = [...quantity.keys()];
  const ticks = new Set<number>();
  if (marks === "ticks" || marks === "corrections" || marks === "handwritten")
    for (const line of lines)
      if (rnd() < (marks === "handwritten" ? 0.3 : 0.9)) ticks.add(line);
  const corrections = new Map<
    number,
    { written: number; how: "circle" | "strike" }
  >();
  if (marks === "corrections") {
    // Short counts on lines printed in the order's own unit.
    const candidates = lines.filter((line) => {
      const truth = slip.truth[line]!;
      return (
        truth.itemId !== null &&
        truth.shipped >= 1 &&
        quantity.get(line)!.text === String(truth.shipped)
      );
    });
    for (let n = rnd() < 0.3 ? 2 : 1; n > 0 && candidates.length; n--) {
      const line = candidates.splice(
        Math.floor(rnd() * candidates.length),
        1,
      )[0]!;
      const shipped = slip.truth[line]!.shipped;
      const written =
        shipped < 2 || rnd() < 0.15
          ? 0
          : shipped -
            (1 +
              Math.floor(
                rnd() *
                  Math.max(1, Math.min(shipped - 1, Math.ceil(shipped / 4))),
              ));
      corrections.set(line, {
        written,
        how: rnd() < 0.55 ? "circle" : "strike",
      });
    }
  }
  const highlight = new Set<number>();
  if (rnd() < 0.12)
    for (let n = 1 + Math.floor(rnd() * 3); n > 0; n--)
      highlight.add(pickOf(rnd, lines));
  const form =
    style === "form" || (style === "dotmatrix" && rnd() < 0.5)
      ? pickOf(rnd, ["#1d3b78", "#1f5e3b", "#7a1f2b", "#3a3a3a"])
      : null;
  const stampAt =
    rnd() < 0.25
      ? rnd() < 0.6
        ? { x: between(rnd, 0.6, 0.82), y: between(rnd, 0.08, 0.16) }
        : { x: between(rnd, 0.5, 0.8), y: between(rnd, 0.35, 0.7) }
      : null;
  const result: Plan = {
    style,
    marks,
    paper,
    ink: carbon
      ? pickOf(rnd, ["#2c2f5a", "#3a2c5c", "#30304a"])
      : style === "laser"
        ? "#141418"
        : "#202024",
    strength:
      style === "laser" ? between(rnd, 0.85, 1) : between(rnd, 0.62, 0.95),
    carbon,
    form,
    shift: form
      ? { x: between(rnd, -0.003, 0.003), y: between(rnd, -0.003, 0.003) }
      : { x: 0, y: 0 },
    zebra: style === "laser" && rnd() < 0.25,
    dots: between(rnd, 0.46, 0.54),
    pen,
    ticks,
    corrections,
    highlight,
    signature: marks !== "clean" ? rnd() < 0.7 : rnd() < 0.3,
    date: rnd() < 0.5,
    stamp: stampAt,
    folds:
      rnd() < 0.5 ? [between(rnd, 0.32, 0.35), between(rnd, 0.65, 0.68)] : [],
  };
  return result;
}

/** A slip printed in one of the real-world styles, marked up by the receiver. */
export function makePhotoSlip(
  seed: number,
  overrides: {
    style?: PrintStyle;
    marks?: PenMarks;
    layout?: string;
    items?: number;
  } = {},
): PhotoSlip {
  const rnd = random(seed * 4241 + 7);
  const style =
    overrides.style ??
    pickOf(rnd, ["laser", "laser", "form", "dotmatrix"] as const);
  const marks =
    overrides.marks ??
    pickOf(rnd, [
      "clean",
      "ticks",
      "ticks",
      "corrections",
      "handwritten",
    ] as const);
  const slip = makeSlip(seed, {
    layout: overrides.layout,
    items: overrides.items,
    // Forms and dot matrix print in a fixed pitch.
    ...(style === "laser" ? {} : { mono: true }),
  });
  const p = plan(slip, rnd, style, marks);
  const truth: PhotoTruth[] = slip.truth.map((t, line) => {
    const fix = p.corrections.get(line);
    if (fix)
      return {
        ...t,
        printed: t.shipped,
        shipped: fix.written,
        written: fix.written,
      };
    if (marks === "handwritten")
      return { ...t, printed: null, written: t.shipped };
    return { ...t, printed: t.shipped };
  });
  return {
    ...slip,
    style,
    marks,
    truth,
    images: slip.pages.map((_, i) => paintPage(slip, i, p, rnd)),
    folds: p.folds,
  };
}

// ---------- Camera ----------

export type CameraOptions = {
  width: number;
  height: number;
  /** Page area over frame area. */
  coverage: number;
  rotation: number;
  /** Corner displacement for perspective, as a fraction of the page size. */
  tilt: number;
  surface: (typeof SURFACES)[number];
  exposure: number;
  /** Light falloff across the frame. */
  gradient: { x: number; y: number };
  /** Phone or hand shadow: 1 is none. */
  shadow: number;
  cast: [number, number, number];
  /** Paper bowing, as a fraction of the page height. */
  curl: number;
  blur: number;
  noise: number;
  folds: number[];
  /** Harder conditions, only when asked for so plain photos stay the same. */
  hazards: Hazards | null;
};
/** Positions are in page units: 0–1 across and down the page. */
export type Hazards = {
  /** Another sheet under or beside the page, from its centre. */
  sheet: {
    dx: number;
    dy: number;
    angle: number;
    scale: number;
    tint: [number, number, number];
  } | null;
  /** A thumb holding the page at one edge: 0 top, 1 right, 2 bottom, 3 left. */
  thumb: { edge: number; at: number; size: number } | null;
  /** A bright reflection: extra light at its centre. */
  glare: { x: number; y: number; radius: number; strength: number } | null;
};
export const SURFACES = [
  "wood",
  "concrete",
  "seat",
  "steel",
  "cardboard",
  "counter",
] as const;

export function cameraOptions(
  seed: number,
  {
    hard = false,
    ...overrides
  }: Partial<CameraOptions> & { hard?: boolean } = {},
): CameraOptions {
  const rnd = random(seed * 977 + 31);
  const [width, height] = pickOf(rnd, [
    [1080, 1920],
    [1463, 2600],
    [1950, 2600],
  ] as const);
  const focus = rnd();
  const options: CameraOptions = {
    width,
    height,
    coverage: between(rnd, 0.45, 0.78),
    rotation: (rnd() - 0.5) * (rnd() < 0.8 ? 0.12 : 0.35),
    tilt: between(rnd, 0, 0.09),
    surface: pickOf(rnd, SURFACES),
    exposure: between(rnd, 0.82, 1.06),
    gradient: { x: between(rnd, -0.18, 0.18), y: between(rnd, -0.18, 0.18) },
    shadow: rnd() < 0.4 ? between(rnd, 0.5, 0.85) : 1,
    cast: pickOf(rnd, [
      [1, 1, 1],
      [1.05, 1, 0.88],
      [0.95, 0.99, 1.06],
    ] as const) as [number, number, number],
    curl: between(rnd, -0.006, 0.006),
    blur:
      focus < 0.7
        ? between(rnd, 0.5, 1.1)
        : focus < 0.9
          ? between(rnd, 1.1, 1.8)
          : between(rnd, 1.8, 2.6),
    noise: between(rnd, 2, 7),
    folds: [],
    hazards: null,
  };
  if (hard) {
    // A separate stream, so the plain options above stay the same.
    const hz = random(seed * 7919 + 3);
    if (hz() < 0.35) options.tilt = between(hz, 0.09, 0.22);
    if (hz() < 0.25) {
      options.exposure = between(hz, 0.55, 0.8);
      options.noise = between(hz, 7, 14);
    }
    const beside = hz() < 0.3;
    options.hazards = {
      sheet:
        hz() < 0.45
          ? {
              dx: beside
                ? (hz() < 0.5 ? -1 : 1) * between(hz, 0.95, 1.15)
                : between(hz, -0.3, 0.3),
              dy: between(hz, -0.25, 0.25),
              angle: between(hz, -0.45, 0.45),
              scale: between(hz, 0.8, 1.1),
              tint: pickOf(hz, [
                [248, 248, 245],
                [252, 245, 200],
                [250, 226, 230],
                [234, 239, 250],
              ] as const) as [number, number, number],
            }
          : null,
      thumb:
        hz() < 0.35
          ? {
              edge: Math.floor(hz() * 4),
              at: between(hz, 0.15, 0.85),
              size: between(hz, 0.07, 0.12),
            }
          : null,
      glare:
        hz() < 0.3
          ? {
              x: between(hz, 0.2, 0.8),
              y: between(hz, 0.15, 0.85),
              radius: between(hz, 0.08, 0.25),
              strength: between(hz, 0.25, 0.8),
            }
          : null,
    };
  }
  return { ...options, ...overrides };
}

/** Homography from the unit square onto `q`, as a 3×3 matrix. */
function squareTo(q: Quad) {
  const [p0, p1, p2, p3] = q;
  const dx = p0.x - p1.x + p2.x - p3.x,
    dy = p0.y - p1.y + p2.y - p3.y;
  const den = (p1.x - p2.x) * (p3.y - p2.y) - (p3.x - p2.x) * (p1.y - p2.y);
  const g = (dx * (p3.y - p2.y) - (p3.x - p2.x) * dy) / den,
    h = ((p1.x - p2.x) * dy - dx * (p1.y - p2.y)) / den;
  return [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + h * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + h * p3.y,
    p0.y,
    g,
    h,
    1,
  ];
}
function inverse(m: number[]) {
  const [A, B, C, D, E, F, G, H, I] = m as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const det = A * (E * I - F * H) - B * (D * I - F * G) + C * (D * H - E * G);
  return [
    (E * I - F * H) / det,
    (C * H - B * I) / det,
    (B * F - C * E) / det,
    (F * G - D * I) / det,
    (A * I - C * G) / det,
    (C * D - A * F) / det,
    (D * H - E * G) / det,
    (B * G - A * H) / det,
    (A * E - B * D) / det,
  ];
}

function surfaceColor(
  kind: CameraOptions["surface"],
  x: number,
  y: number,
  seed: number,
): [number, number, number] {
  const n = hash(x, y, seed) - 0.5;
  switch (kind) {
    case "wood": {
      const grain =
        0.8 +
        0.2 * Math.sin(y * 0.05 + 4 * smoothNoise(x * 0.006, y * 0.015, seed));
      return [128 * grain + n * 10, 84 * grain + n * 8, 52 * grain + n * 6];
    }
    case "concrete": {
      const v =
        128 + 40 * (smoothNoise(x * 0.01, y * 0.01, seed) - 0.5) + n * 30;
      return [v, v, v - 4];
    }
    case "seat": {
      const weave = (Math.floor(x / 5) + Math.floor(y / 5)) % 2 ? 8 : -8;
      return [46 + weave + n * 14, 46 + weave + n * 14, 54 + weave + n * 14];
    }
    case "steel": {
      const v = 150 + 25 * smoothNoise(x * 0.0015, y * 0.06, seed) + n * 10;
      return [v - 4, v, v + 6];
    }
    case "cardboard": {
      const v = 0.9 + 0.1 * smoothNoise(x * 0.004, y * 0.004, seed);
      return [176 * v + n * 8, 138 * v + n * 7, 96 * v + n * 6];
    }
    case "counter":
      return [192 + n * 12, 190 + n * 12, 184 + n * 12];
  }
}

/** The page as the scanner's camera frame shows it. */
export async function photograph(
  page: Pixels,
  seed: number,
  overrides: Partial<CameraOptions> & { hard?: boolean } = {},
): Promise<{ frame: Pixels; corners: Quad; options: CameraOptions }> {
  const o = cameraOptions(seed, overrides);
  const rnd = random(seed * 131 + 17);
  const { width: w, height: h } = o;
  const aspect = page.height / page.width;
  let pw = Math.sqrt((w * h * o.coverage) / aspect),
    ph = pw * aspect;
  const cos = Math.cos(o.rotation),
    sin = Math.sin(o.rotation);
  const fit = Math.min(
    1,
    (w * 0.9) / (Math.abs(cos) * pw + Math.abs(sin) * ph) / (1 + o.tilt),
    (h * 0.9) / (Math.abs(sin) * pw + Math.abs(cos) * ph) / (1 + o.tilt),
  );
  pw *= fit;
  ph *= fit;
  const cx = w / 2 + (rnd() - 0.5) * w * 0.04,
    cy = h / 2 + (rnd() - 0.5) * h * 0.04;
  const corners = (
    [
      [-pw / 2, -ph / 2],
      [pw / 2, -ph / 2],
      [pw / 2, ph / 2],
      [-pw / 2, ph / 2],
    ] as const
  ).map(([x, y]) => ({
    x: cx + x * cos - y * sin + (rnd() - 0.5) * o.tilt * pw,
    y: cy + x * sin + y * cos + (rnd() - 0.5) * o.tilt * ph,
  })) as Quad;
  const toFrame = squareTo(corners),
    inv = inverse(toFrame);
  const onPage = (u: number, v: number) => {
    const z = toFrame[6]! * u + toFrame[7]! * v + 1;
    return {
      x: (toFrame[0]! * u + toFrame[1]! * v + toFrame[2]!) / z,
      y: (toFrame[3]! * u + toFrame[4]! * v + toFrame[5]!) / z,
    };
  };
  const hz = o.hazards;
  const sheet = hz?.sheet
    ? {
        ...hz.sheet,
        x: cx + hz.sheet.dx * pw * cos - hz.sheet.dy * ph * sin,
        y: cy + hz.sheet.dx * pw * sin + hz.sheet.dy * ph * cos,
        cos: Math.cos(o.rotation + hz.sheet.angle),
        sin: Math.sin(o.rotation + hz.sheet.angle),
        half: { x: (pw * hz.sheet.scale) / 2, y: (ph * hz.sheet.scale) / 2 },
      }
    : null;
  const thumb = hz?.thumb
    ? (() => {
        const { edge, at, size } = hz.thumb;
        const [u, v, nu, nv] = (
          [
            [at, 0, 0, -1],
            [1, at, 1, 0],
            [at, 1, 0, 1],
            [0, at, -1, 0],
          ] as const
        )[edge]!;
        // Centred just outside the edge, so the tip lies on the page.
        const centre = onPage(u + nu * size * 0.25, v + nv * size * 0.25),
          ahead = onPage(
            u + nu * (size * 0.25 + 0.01),
            v + nv * (size * 0.25 + 0.01),
          );
        const len = Math.hypot(ahead.x - centre.x, ahead.y - centre.y);
        return {
          ...centre,
          dx: (ahead.x - centre.x) / len,
          dy: (ahead.y - centre.y) / len,
          length: size * pw,
          width: size * pw * 0.62,
        };
      })()
    : null;
  const glare = hz?.glare
    ? {
        ...onPage(hz.glare.x, hz.glare.y),
        r: hz.glare.radius * pw,
        k: hz.glare.strength,
      }
    : null;
  const shadowAngle = rnd() * Math.PI * 2,
    shadowOffset = (rnd() - 0.5) * 0.6;
  const panels = [1, ...o.folds.map(() => between(rnd, 0.9, 1.06))];
  const src = page.data,
    sw = page.width,
    sh = page.height;
  const rgb = new Uint8ClampedArray(w * h * 3);
  const surfaceSeed = Math.floor(rnd() * 1e6);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const X = x + 0.5,
        Y = y + 0.5;
      const z = inv[6]! * X + inv[7]! * Y + inv[8]!;
      const u = (inv[0]! * X + inv[1]! * Y + inv[2]!) / z;
      let v = (inv[3]! * X + inv[4]! * Y + inv[5]!) / z;
      v -= o.curl * (1 - (2 * u - 1) ** 2);
      // Anti-aliased page edge: signed distance in frame pixels.
      const inside = Math.min(u * pw, (1 - u) * pw, v * ph, (1 - v) * ph);
      const cover = Math.min(1, Math.max(0, inside + 0.5));
      let r = 0,
        g = 0,
        b = 0;
      if (cover > 0) {
        const fx = Math.min(sw - 1.001, Math.max(0, u * sw - 0.5)),
          fy = Math.min(sh - 1.001, Math.max(0, v * sh - 0.5));
        const ix = fx | 0,
          iy = fy | 0,
          tx = fx - ix,
          ty = fy - iy;
        const i = (iy * sw + ix) * 4,
          j = i + sw * 4;
        const w00 = (1 - tx) * (1 - ty),
          w10 = tx * (1 - ty),
          w01 = (1 - tx) * ty,
          w11 = tx * ty;
        let panel = 0;
        for (const f of o.folds) if (v > f) panel++;
        const k = panels[panel]! * cover;
        r =
          (src[i]! * w00 +
            src[i + 4]! * w10 +
            src[j]! * w01 +
            src[j + 4]! * w11) *
          k;
        g =
          (src[i + 1]! * w00 +
            src[i + 5]! * w10 +
            src[j + 1]! * w01 +
            src[j + 5]! * w11) *
          k;
        b =
          (src[i + 2]! * w00 +
            src[i + 6]! * w10 +
            src[j + 2]! * w01 +
            src[j + 6]! * w11) *
          k;
      }
      if (cover < 1) {
        let s = surfaceColor(o.surface, x, y, surfaceSeed);
        if (sheet) {
          const lx = (x - sheet.x) * sheet.cos + (y - sheet.y) * sheet.sin,
            ly = (y - sheet.y) * sheet.cos - (x - sheet.x) * sheet.sin;
          const edge = Math.min(
            sheet.half.x - Math.abs(lx),
            sheet.half.y - Math.abs(ly),
          );
          if (edge > -0.5) {
            // Another printed page: rows of word-sized marks.
            const row = Math.floor(ly / (ph * 0.016)),
              inRow = ly / (ph * 0.016) - row;
            const word = Math.floor(lx / (pw * 0.035)),
              inWord = lx / (pw * 0.035) - word;
            const ink =
              edge > pw * 0.06 &&
              inRow > 0.35 &&
              inRow < 0.65 &&
              inWord < 0.8 &&
              hash(word, row, surfaceSeed) < 0.45
                ? 0.6
                : 1;
            const k = Math.min(1, edge + 0.5);
            s = s.map(
              (c, i) => c * (1 - k) + sheet.tint[i]! * ink * k,
            ) as typeof s;
          }
        }
        // The page lies on top and casts a hairline shadow.
        const shade = hz ? 1 - 0.14 * Math.exp(Math.min(0, inside) / 2.5) : 1;
        r += s[0] * shade * (1 - cover);
        g += s[1] * shade * (1 - cover);
        b += s[2] * shade * (1 - cover);
      }
      if (thumb) {
        const along = (x - thumb.x) * thumb.dx + (y - thumb.y) * thumb.dy,
          across = (y - thumb.y) * thumb.dx - (x - thumb.x) * thumb.dy;
        const e = Math.sqrt(
          (along / thumb.length) ** 2 + (across / thumb.width) ** 2,
        );
        if (e < 1.5) {
          const skin = Math.min(1, Math.max(0, (1 - e) * thumb.width * 0.5));
          const shade = 1 - 0.3 * Math.min(1, (1.5 - e) * 2) * (1 - skin);
          const tone = 0.8 + 0.2 * Math.sqrt(Math.max(0, 1 - e * e));
          r = r * shade * (1 - skin) + 214 * tone * skin;
          g = g * shade * (1 - skin) + 160 * tone * skin;
          b = b * shade * (1 - skin) + 132 * tone * skin;
        }
      }
      let light =
        o.exposure *
        (1 + o.gradient.x * (x / w - 0.5) + o.gradient.y * (y / h - 0.5));
      if (o.shadow < 1) {
        const d =
          ((x / w - 0.5) * Math.cos(shadowAngle) +
            (y / h - 0.5) * Math.sin(shadowAngle) -
            shadowOffset) *
          10;
        light *= o.shadow + (1 - o.shadow) / (1 + Math.exp(-d));
      }
      if (glare)
        light *=
          1 +
          glare.k *
            Math.exp(
              -(((x - glare.x) ** 2 + (y - glare.y) ** 2) / glare.r ** 2),
            );
      const o3 = (y * w + x) * 3;
      rgb[o3] = r * light * o.cast[0];
      rgb[o3 + 1] = g * light * o.cast[1];
      rgb[o3 + 2] = b * light * o.cast[2];
    }
  // Focus, then sensor noise.
  const blurred = await sharp(Buffer.from(rgb.buffer), {
    raw: { width: w, height: h, channels: 3 },
  })
    .blur(Math.max(0.3, o.blur))
    .raw()
    .toBuffer();
  const data = new Uint8ClampedArray(w * h * 4);
  const rn = random(seed * 13 + 1);
  for (let i = 0; i < w * h; i++) {
    const n = (rn() + rn() + rn() - 1.5) * o.noise;
    data[i * 4] = blurred[i * 3]! + n;
    data[i * 4 + 1] = blurred[i * 3 + 1]! + n;
    data[i * 4 + 2] = blurred[i * 3 + 2]! + n;
    data[i * 4 + 3] = 255;
  }
  return {
    frame: { data, width: w, height: h },
    corners: corners.map((p) => ({ x: p.x / w, y: p.y / h })) as Quad,
    options: o,
  };
}

/** A canvas-backed PNG of pixels, for looking at the synthetic pages. */
export function pixelsPng(pixels: Pixels): Buffer {
  const canvas: Canvas = createCanvas(pixels.width, pixels.height);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(pixels.width, pixels.height);
  image.data.set(pixels.data);
  ctx.putImageData(image, 0, 0);
  return canvas.toBuffer("image/png");
}

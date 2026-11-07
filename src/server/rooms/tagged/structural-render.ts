import { createCanvas } from "@napi-rs/canvas";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { SERVER_PDF_RENDER_OPTIONS } from "../pdf-render-options";
import { close, createMask } from "../raster-rooms";

const TEXT_PAINT_OPERATIONS = new Set([
  OPS.showText,
  OPS.showSpacedText,
  OPS.nextLineShowText,
  OPS.nextLineSetSpacingShowText,
]);

/**
 * True for ink that can be a wall: dark and neutral. Architectural sheets draw
 * background/existing/"refer to enlarged plan" linework screened grey and
 * revision clouds in colour; neither bounds a room on that sheet.
 */
export function isStructuralInk(r: number, g: number, b: number) {
  const lum = (r * 299 + g * 587 + b * 114) / 1000;
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  return lum < STRUCTURAL_MAX_LUMINANCE && sat < STRUCTURAL_MAX_CHROMA;
}
export const STRUCTURAL_MAX_LUMINANCE = 128;
export const STRUCTURAL_MAX_CHROMA = 64;

/**
 * Whitens every pixel that is not structural ink (in place). Grey that sits
 * between two close black lines is wall poché (hatch/fill inside a wall) and
 * is kept as wall; free-standing grey (screened background plans) and all
 * coloured ink (revision clouds, markups) are removed.
 * Returns pixels whitened.
 */
export function keepStructuralInk(rgba: Uint8ClampedArray, width = 0, height = 0) {
  const n = rgba.length / 4;
  const black = createMask(width || n, height || 1);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    black.data[i] = isStructuralInk(rgba[p]!, rgba[p + 1]!, rgba[p + 2]!) ? 1 : 0;
  }
  // Between wall faces: closing the black linework by ~wall-cavity width.
  const between = width && height
    ? close(black, Math.max(2, Math.round(Math.max(width, height) / 1250)))
    : black;
  let removed = 0;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const r = rgba[p]!, g = rgba[p + 1]!, b = rgba[p + 2]!;
    if (black.data[i]) continue;
    if (r > 250 && g > 250 && b > 250) continue;
    const lum = (r * 299 + g * 587 + b * 114) / 1000;
    const neutral = Math.max(r, g, b) - Math.min(r, g, b) < STRUCTURAL_MAX_CHROMA;
    if (neutral && lum < 235 && between.data[i]) {
      rgba[p] = rgba[p + 1] = rgba[p + 2] = 0; // poché: part of the wall
      continue;
    }
    rgba[p] = rgba[p + 1] = rgba[p + 2] = 255;
    removed++;
  }
  return removed;
}

/**
 * Renders one PDF page as walls-only evidence: no text, no dashed strokes
 * (grids, setbacks, hidden/overhead lines), and only dark neutral ink.
 */
export async function renderStructuralPage(
  pdf: Buffer | Uint8Array,
  pageNumber: number,
  longSide: number,
) {
  const loadingTask = getDocument({
    ...SERVER_PDF_RENDER_OPTIONS,
    data: new Uint8Array(pdf),
  });
  const document = await loadingTask.promise;
  try {
    const page = await document.getPage(pageNumber);
    const raw = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: longSide / Math.max(raw.width, raw.height),
    });
    const width = Math.max(1, Math.round(viewport.width));
    const height = Math.max(1, Math.round(viewport.height));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    const operators = await page.getOperatorList();
    let dashedStrokesSkipped = 0;
    const filtered = new Proxy(
      context as unknown as Record<PropertyKey, unknown>,
      {
        get(target, property) {
          if (property === "fillText" || property === "strokeText")
            return () => undefined;
          if (property === "stroke") {
            const stroke = (target.stroke as (...a: unknown[]) => unknown).bind(target);
            return (...args: unknown[]) => {
              const dash = (target.getLineDash as () => number[]).call(target);
              if (dash.some((value) => value > 0)) {
                dashedStrokesSkipped++;
                return undefined;
              }
              return stroke(...args);
            };
          }
          const value = target[property];
          return typeof value === "function"
            ? (value as (...a: unknown[]) => unknown).bind(target)
            : value;
        },
        set(target, property, value) {
          target[property] = value;
          return true;
        },
      },
    );
    try {
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: filtered as unknown as CanvasRenderingContext2D,
        viewport,
        operationsFilter: (index) =>
          !TEXT_PAINT_OPERATIONS.has(operators.fnArray[index] ?? -1),
      }).promise;
      const data = context.getImageData(0, 0, width, height).data;
      const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
      const nonStructuralRemoved = keepStructuralInk(rgba, width, height);
      return { rgba, width, height, dashedStrokesSkipped, nonStructuralRemoved };
    } finally {
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
}

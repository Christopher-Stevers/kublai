// Isolated spike only. Source-derived from pdfjs-dist 6.2.108 CanvasGraphics
// getScaleForStroking/rescaleAndStroke; no empirical line-weight adjustment.
export type StrokeTransform = {
  a: number; b: number; c: number; d: number; e: number; f: number;
};
export class StrokeStyleError extends Error {
  constructor(readonly failure: string) {
    super(failure);
    this.name = "StrokeStyleError";
  }
}
export function getScaleForStroking(
  lineWidth: number,
  { a, b, c, d, e, f }: StrokeTransform,
): [number, number] {
  if (!Number.isFinite(lineWidth) || lineWidth < 0)
    throw new StrokeStyleError("invalid-stroke-width");
  if (![a, b, c, d, e, f].every(Number.isFinite))
    throw new StrokeStyleError("invalid-stroke-transform");
  const absDet = Math.abs(a * d - b * c);
  if (!Number.isFinite(absDet))
    throw new StrokeStyleError("unsupported-stroke-compensation-range");
  if (absDet === 0)
    throw new StrokeStyleError("unsupported-singular-stroke-transform");
  let scaleX: number, scaleY: number;
  if (b === 0 && c === 0) {
    const normX = Math.abs(a), normY = Math.abs(d);
    if (normX === normY) {
      if (lineWidth === 0) scaleX = scaleY = 1 / normX;
      else {
        const scaledLineWidth = normX * lineWidth;
        scaleX = scaleY = scaledLineWidth < 1 ? 1 / scaledLineWidth : 1;
      }
    } else if (lineWidth === 0) {
      scaleX = 1 / normX;
      scaleY = 1 / normY;
    } else {
      const scaledXLineWidth = normX * lineWidth;
      const scaledYLineWidth = normY * lineWidth;
      scaleX = scaledXLineWidth < 1 ? 1 / scaledXLineWidth : 1;
      scaleY = scaledYLineWidth < 1 ? 1 / scaledYLineWidth : 1;
    }
  } else {
    const normX = Math.hypot(a, b), normY = Math.hypot(c, d);
    if (lineWidth === 0) {
      scaleX = normY / absDet;
      scaleY = normX / absDet;
    } else {
      const baseArea = lineWidth * absDet;
      scaleX = normY > baseArea ? normY / baseArea : 1;
      scaleY = normX > baseArea ? normX / baseArea : 1;
    }
  }
  if (![scaleX, scaleY, 1 / scaleX, 1 / scaleY].every(v => Number.isFinite(v) && v > 0))
    throw new StrokeStyleError("unsupported-stroke-compensation-range");
  return [scaleX, scaleY];
}
export type StrokeContext = {
  lineWidth: number;
  lineDashOffset: number;
  getTransform: () => StrokeTransform;
  getLineDash: () => number[];
  setLineDash: (dash: number[]) => void;
  save: () => void;
  restore: () => void;
  scale: (x: number, y: number) => void;
  stroke: () => void;
};
/** rebuild applies the inverse diagonal to every packed point/control point.
 * Under ctx.scale this is the reference newPath.addPath(path,SCALE_MATRIX),
 * without introducing a native Path2D dependency. It must preserve closure.
 * The resulting current path has identical device geometry, including for the
 * deferred clip consumed after this stroke. Canvas paths are not saved state. */
export function rescaleAndStroke(
  ctx: StrokeContext,
  lineWidth: number,
  rebuild: (inverseX: number, inverseY: number) => void,
) {
  const [scaleX, scaleY] = getScaleForStroking(lineWidth, ctx.getTransform());
  if (scaleX === scaleY) {
    ctx.lineWidth = (lineWidth || 1) * scaleX;
    ctx.stroke();
    return;
  }
  const dashes = ctx.getLineDash();
  ctx.save();
  try {
    ctx.scale(scaleX, scaleY);
    rebuild(1 / scaleX, 1 / scaleY);
    if (dashes.length > 0) {
      const scale = Math.max(scaleX, scaleY);
      ctx.setLineDash(dashes.map(x => x / scale));
      ctx.lineDashOffset /= scale;
    }
    ctx.lineWidth = lineWidth || 1;
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}

/** Direct operators and matching GState keys share this setter. Logical width
 * is returned separately: Canvas ignores assignment of zero to lineWidth. */
export function setStrokeStyle(
  ctx: StrokeContext & { lineCap: string; lineJoin: string; miterLimit: number },
  key: "LW" | "LC" | "LJ" | "ML" | "D",
  value: unknown,
  lineWidth: number,
) {
  if (key === "LW") {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      throw new StrokeStyleError("invalid-stroke-width");
    ctx.lineWidth = value;
    return value;
  }
  if (key === "LC" || key === "LJ") {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 2)
      throw new StrokeStyleError(key === "LC" ? "invalid-stroke-cap" : "invalid-stroke-join");
    if (key === "LC") ctx.lineCap = ["butt", "round", "square"][value]!;
    else ctx.lineJoin = ["miter", "round", "bevel"][value]!;
  } else if (key === "ML") {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
      throw new StrokeStyleError("invalid-stroke-miter-limit");
    ctx.miterLimit = value;
  } else {
    if (!Array.isArray(value) || value.length !== 2 || !Array.isArray(value[0]) ||
        !value[0].every((v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0) ||
        (value[0].length > 0 && !value[0].some((v: number) => v > 0)) ||
        typeof value[1] !== "number" || !Number.isFinite(value[1]))
      throw new StrokeStyleError("invalid-stroke-dash");
    ctx.setLineDash([...value[0]]);
    ctx.lineDashOffset = value[1];
  }
  return lineWidth;
}

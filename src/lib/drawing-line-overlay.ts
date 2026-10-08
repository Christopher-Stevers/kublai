import {
  planDrawingPatch,
  type DrawingPatch,
  type DrawingSize,
  type DrawingView,
} from "./drawing-viewport";

export type OverlayInkStyle = { color: string; opacity: number };
export const DEFAULT_OVERLAY_STYLES: [OverlayInkStyle, OverlayInkStyle] = [
  { color: "#dc2626", opacity: 1 },
  { color: "#2563eb", opacity: 1 },
];
export const MAX_OVERLAY_PIXELS = 2 * 1024 * 1024;

export function overlayStyle(value: OverlayInkStyle): OverlayInkStyle {
  return {
    color: /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : "#000000",
    opacity: Number.isFinite(value.opacity)
      ? Math.max(0, Math.min(1, value.opacity))
      : 1,
  };
}

/** Remove the paper rather than making one opaque sheet cover the other. */
export function drawingInk(pixels: Uint8ClampedArray): Uint8Array {
  const ink = new Uint8Array(pixels.length / 4);
  for (let i = 0; i < ink.length; i++) {
    const at = i * 4;
    const darkness =
      ((255 - Math.min(pixels[at]!, pixels[at + 1]!, pixels[at + 2]!)) *
        pixels[at + 3]!) /
      255;
    ink[i] = darkness < 8 ? 0 : Math.round(darkness);
  }
  return ink;
}

/** Common ink is explicitly black, independent of the two chosen hues. */
export function compositeDrawingInk(
  output: Uint8ClampedArray,
  first: Uint8Array,
  second: Uint8Array,
  styles: [OverlayInkStyle, OverlayInkStyle],
  start = 0,
  end = first.length,
) {
  const a = overlayStyle(styles[0]),
    b = overlayStyle(styles[1]);
  const rgb = (color: string) =>
    [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16));
  const ac = rgb(a.color),
    bc = rgb(b.color);
  for (let i = start; i < end; i++) {
    const ai = a.opacity === 0 ? 0 : first[i]! / 255;
    const bi = b.opacity === 0 ? 0 : second[i]! / 255;
    const shared = Math.min(ai, bi);
    const aw = (ai - shared) * a.opacity,
      bw = (bi - shared) * b.opacity;
    const black = shared * Math.max(a.opacity, b.opacity);
    const alpha = aw + bw + black,
      at = i * 4;
    for (let channel = 0; channel < 3; channel++)
      output[at + channel] = alpha
        ? (ac[channel]! * aw + bc[channel]! * bw) / alpha
        : 0;
    output[at + 3] = alpha * 255;
  }
}

/** Placement in the primary sheet's raster coordinates, including crop origin. */
export function overlaySourceRect(
  patch: DrawingPatch,
  fit: DrawingSize,
  sourceAspect: number,
  alignment = { x: 0, y: 0, scale: 1 },
) {
  const width = patch.fullWidth * alignment.scale;
  const height =
    ((patch.fullHeight * sourceAspect) / (fit.height / fit.width)) *
    alignment.scale;
  return {
    width,
    height,
    left:
      (patch.fullWidth - width) / 2 +
      alignment.x * patch.fullWidth -
      patch.left * patch.fullWidth,
    top:
      (patch.fullHeight - height) / 2 +
      alignment.y * patch.fullHeight -
      patch.top * patch.fullHeight,
  };
}

export function boundedOverlayPatch(patch: DrawingPatch): DrawingPatch {
  const reduce = Math.min(
    1,
    Math.sqrt(MAX_OVERLAY_PIXELS / (patch.pixelWidth * patch.pixelHeight)),
  );
  const pixelWidth = Math.max(1, Math.floor(patch.pixelWidth * reduce)),
    pixelHeight = Math.max(1, Math.floor(patch.pixelHeight * reduce));
  return {
    ...patch,
    pixelWidth,
    pixelHeight,
    fullWidth: pixelWidth / patch.width,
    fullHeight: pixelHeight / patch.height,
  };
}

/** Include the second page even when it is taller or has been moved off the first. */
export function overlayBounds(
  fit: DrawingSize,
  secondAspect: number,
  alignment: { x: number; y: number; scale: number },
) {
  const ratio = secondAspect / (fit.height / fit.width);
  const left = (1 - alignment.scale) / 2 + alignment.x;
  const top = (1 - ratio * alignment.scale) / 2 + alignment.y;
  return {
    left: Math.min(0, left),
    top: Math.min(0, top),
    right: Math.max(1, left + alignment.scale),
    bottom: Math.max(1, top + ratio * alignment.scale),
  };
}
export function planOverlayPatch(
  fit: DrawingSize,
  frame: DrawingSize,
  view: DrawingView,
  dpr: number,
  bounds: ReturnType<typeof overlayBounds>,
) {
  const width = bounds.right - bounds.left,
    height = bounds.bottom - bounds.top;
  const patch = planDrawingPatch(
    { width: fit.width * width, height: fit.height * height },
    frame,
    {
      scale: view.scale,
      x: view.x + (bounds.left + (width - 1) / 2) * fit.width * view.scale,
      y: view.y + (bounds.top + (height - 1) / 2) * fit.height * view.scale,
    },
    dpr,
  );
  return (
    patch &&
    boundedOverlayPatch({
      ...patch,
      left: bounds.left + patch.left * width,
      top: bounds.top + patch.top * height,
      width: patch.width * width,
      height: patch.height * height,
      fullWidth: patch.fullWidth / width,
      fullHeight: patch.fullHeight / height,
    })
  );
}

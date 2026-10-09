import { overlayStyle, type OverlayInkStyle } from "./drawing-line-overlay";

export const OVERLAY_PALETTE = [
  "#dc2626",
  "#2563eb",
  "#16a34a",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#db2777",
  "#ca8a04",
];
export const defaultOverlayInk = (index: number): OverlayInkStyle => ({
  color: OVERLAY_PALETTE[index % OVERLAY_PALETTE.length]!,
  opacity: 1,
});
export const overlayLabel = (index: number) =>
  `Drawing ${index < 26 ? String.fromCharCode(65 + index) : index + 1}`;
export const IDENTITY_ALIGNMENT = { x: 0, y: 0, scale: 1 };

/** Only the strongest two strokes are retained, independent of layer count. */
export function createInkStack(length: number) {
  return {
    first: new Uint8Array(length),
    second: new Uint8Array(length),
    firstLayer: new Uint32Array(length),
    secondLayer: new Uint32Array(length),
    opacity: new Uint8Array(length),
  };
}
export type InkStack = ReturnType<typeof createInkStack>;
export function addStackInk(
  stack: InkStack,
  mask: Uint8Array,
  layer: number,
  opacity: number,
  start = 0,
  end = mask.length,
) {
  const visible = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
  if (!visible) return;
  for (let i = start; i < end; i++) {
    const ink = mask[i]!;
    if (!ink) continue;
    stack.opacity[i] = Math.max(stack.opacity[i]!, visible);
    if (ink > stack.first[i]!) {
      stack.second[i] = stack.first[i]!;
      stack.secondLayer[i] = stack.firstLayer[i]!;
      stack.first[i] = ink;
      stack.firstLayer[i] = layer;
    } else if (ink > stack.second[i]!) {
      stack.second[i] = ink;
      stack.secondLayer[i] = layer;
    }
  }
}

/** Shared strokes in any two visible drawings are neutral; unique strokes keep their hue. */
export function compositeInkStack(
  output: Uint8ClampedArray,
  stack: InkStack,
  styles: OverlayInkStyle[],
  start = 0,
  end = stack.first.length,
  commonColor = "#000000",
) {
  const rgb = (color: string) =>
    [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16));
  const inks = styles.map((style) => {
    const valid = overlayStyle(style);
    return { ...valid, rgb: rgb(valid.color) };
  });
  const common = rgb(commonColor);
  for (let i = start; i < end; i++) {
    const strongest = stack.first[i]! / 255,
      shared = stack.second[i]! / 255,
      at = i * 4;
    if (strongest > 0 && shared >= strongest * (2 / 3)) {
      for (let c = 0; c < 3; c++) output[at + c] = common[c]!;
      output[at + 3] = Math.min(1, strongest * 4) * stack.opacity[i]!;
      continue;
    }
    const a = inks[stack.firstLayer[i]!]!,
      b = inks[stack.secondLayer[i]!]!;
    const aw = (strongest - shared) * a.opacity,
      black = shared * Math.max(a.opacity, b.opacity);
    const alpha = aw + black;
    for (let c = 0; c < 3; c++)
      output[at + c] = alpha
        ? (a.rgb[c]! * aw + common[c]! * black) / alpha
        : 0;
    output[at + 3] = alpha * 255;
  }
}

export type DrawingAppearance = { inverted: boolean; lineColor: string | null };
export const DEFAULT_DRAWING_APPEARANCE: DrawingAppearance = {
  inverted: false,
  lineColor: null,
};
export const DRAWING_APPEARANCE_KEY = "foremanhq-drawing-appearance-v1";

export function drawingAppearance(value: unknown): DrawingAppearance {
  if (!value || typeof value !== "object") return DEFAULT_DRAWING_APPEARANCE;
  const input = value as Partial<DrawingAppearance>;
  return {
    inverted: input.inverted === true,
    lineColor:
      typeof input.lineColor === "string" &&
      /^#[0-9a-f]{6}$/i.test(input.lineColor)
        ? input.lineColor.toLowerCase()
        : null,
  };
}
export function readDrawingAppearance(): DrawingAppearance {
  try {
    return drawingAppearance(
      JSON.parse(localStorage.getItem(DRAWING_APPEARANCE_KEY) ?? "null"),
    );
  } catch {
    return DEFAULT_DRAWING_APPEARANCE;
  }
}
export function writeDrawingAppearance(value: DrawingAppearance) {
  try {
    localStorage.setItem(
      DRAWING_APPEARANCE_KEY,
      JSON.stringify(drawingAppearance(value)),
    );
  } catch {
    /* Appearance remains usable when device storage is unavailable. */
  }
}

/** Map paper and ink separately, retaining antialiasing and pixel alpha. */
export function drawingAppearanceMatrix(
  value: DrawingAppearance,
): string | null {
  const appearance = drawingAppearance(value);
  if (!appearance.inverted && !appearance.lineColor) return null;
  const color = appearance.lineColor ?? "#ffffff";
  const paper = appearance.inverted ? 0 : 1;
  const rows = [1, 3, 5].flatMap((offset) => {
    const ink = parseInt(color.slice(offset, offset + 2), 16) / 255;
    const delta = paper - ink;
    return [0.2126 * delta, 0.7152 * delta, 0.0722 * delta, 0, ink];
  });
  return [...rows, 0, 0, 0, 1, 0].join(" ");
}

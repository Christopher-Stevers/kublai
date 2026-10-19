export const MEASURE_COLOR_KEY = "foremanhq-measure-color-v1";
export const DEFAULT_MEASURE_COLOR = "#d97706";
export const MEASURE_COLORS = [
  { name: "Orange", value: DEFAULT_MEASURE_COLOR },
  { name: "Red", value: "#dc2626" },
  { name: "Blue", value: "#2563eb" },
  { name: "Black", value: "#111827" },
  { name: "White", value: "#ffffff" },
  { name: "Neon green", value: "#39ff14" },
  { name: "Neon cyan", value: "#00ffff" },
  { name: "Neon pink", value: "#ff00cc" },
  { name: "Neon yellow", value: "#ffff00" },
  { name: "Neon purple", value: "#bf00ff" },
  { name: "Green", value: "#16a34a" },
  { name: "Yellow", value: "#eab308" },
  { name: "Purple", value: "#9333ea" },
  { name: "Pink", value: "#db2777" },
  { name: "Teal", value: "#0d9488" },
  { name: "Sky", value: "#0ea5e9" },
  { name: "Navy", value: "#1e3a8a" },
  { name: "Brown", value: "#92400e" },
  { name: "Grey", value: "#6b7280" },
  { name: "Light grey", value: "#d1d5db" },
] as const;

/** Line widths offered for markups and measurements, thinnest first. */
export const LINE_WIDTHS = [1, 2, 3, 4, 6, 8, 10, 12] as const;

export function validMeasureColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

/** Personal device preference; unavailable browser storage must not block measuring. */
export function readMeasureColor(): string {
  try {
    const color = localStorage.getItem(MEASURE_COLOR_KEY);
    return validMeasureColor(color) ? color.toLowerCase() : DEFAULT_MEASURE_COLOR;
  } catch { return DEFAULT_MEASURE_COLOR; }
}

export function writeMeasureColor(color: string) {
  if (!validMeasureColor(color)) return;
  try { localStorage.setItem(MEASURE_COLOR_KEY, color.toLowerCase()); } catch { /* Private/restricted storage. */ }
}

/** Choose the more legible light/dark halo, particularly for neon on white sheets. */
export function measureColorHalo(color: string): string {
  if (!validMeasureColor(color)) return "#ffffff";
  const channel = (offset: number) => {
    const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.179 ? "#111827" : "#ffffff";
}

export const MEASURE_WIDTH_KEY = "foremanhq-measure-width-v1";
/** Measurements are drawn at their usual thickness at this width. */
export const DEFAULT_MEASURE_WIDTH = 2;

/** Personal device preference, like the measuring colour. */
export function readMeasureWidth(): number {
  try {
    const width = Number(localStorage.getItem(MEASURE_WIDTH_KEY));
    return (LINE_WIDTHS as readonly number[]).includes(width) ? width : DEFAULT_MEASURE_WIDTH;
  } catch { return DEFAULT_MEASURE_WIDTH; }
}

export function writeMeasureWidth(width: number) {
  if (!(LINE_WIDTHS as readonly number[]).includes(width)) return;
  try { localStorage.setItem(MEASURE_WIDTH_KEY, String(width)); } catch { /* Private/restricted storage. */ }
}

/** How much thicker than usual a measurement with this line width is drawn. */
export function measureLineScale(width: number | undefined): number {
  return width && width > 0 ? width / DEFAULT_MEASURE_WIDTH : 1;
}

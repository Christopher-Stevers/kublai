/** A point on a drawing, as a fraction of the sheet width (x) and height (y). */
export type SheetPoint = { x: number; y: number };

export type MeasureUnit = "ft" | "m";

export type SheetScale = {
  /** Real-world length, in `unit`, of the full width of the sheet. */
  unitsPerSheetWidth: number;
  unit: MeasureUnit;
};

/** A finger/mouse press shorter than this is a point. A longer drag pans the sheet. */
export const MEASURE_TAP_SLOP_PX = 8;

const FEET_TO_METERS = 0.3048;

/**
 * Length of a polyline in sheet-widths. The sheet's width is 1.
 * `aspect` is height ÷ width, so a vertical line is measured in the same units as a horizontal one.
 */
export function sheetWidths(points: SheetPoint[], aspect: number): number {
  if (points.length < 2 || !(aspect > 0)) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.hypot(b.x - a.x, (b.y - a.y) * aspect);
  }
  return total;
}

/** Real-world units per sheet width, from a line whose true length is known. */
export function scaleFromKnownLength(
  a: SheetPoint,
  b: SheetPoint,
  aspect: number,
  knownLength: number,
): number | null {
  const widths = sheetWidths([a, b], aspect);
  if (!(knownLength > 0) || !(widths > 0)) return null;
  return knownLength / widths;
}

export function realLength(
  points: SheetPoint[],
  aspect: number,
  unitsPerSheetWidth: number,
): number {
  if (!(unitsPerSheetWidth > 0)) return 0;
  return sheetWidths(points, aspect) * unitsPerSheetWidth;
}

export function convertScale(scale: SheetScale, unit: MeasureUnit): SheetScale {
  if (scale.unit === unit) return scale;
  const factor = scale.unit === "ft" ? FEET_TO_METERS : 1 / FEET_TO_METERS;
  return { unit, unitsPerSheetWidth: scale.unitsPerSheetWidth * factor };
}

function parseInches(text: string): number | null {
  const mixed = /^(\d+) (\d+)\/(\d+)$/.exec(text);
  if (mixed?.[1] && mixed[2] && mixed[3]) {
    const denominator = Number(mixed[3]);
    if (denominator === 0) return null;
    return Number(mixed[1]) + Number(mixed[2]) / denominator;
  }
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return null;
}

function parseFeet(raw: string): number | null {
  const inchesOnly =
    /^(\d+(?:\.\d+)?|\d+ \d+\/\d+) ?(?:"|in|inch|inches)$/.exec(raw);
  if (inchesOnly?.[1]) {
    const inches = parseInches(inchesOnly[1]);
    return inches === null ? null : inches / 12;
  }
  const dash = /^(\d+) ?- ?(\d+(?:\.\d+)?)$/.exec(raw);
  if (dash?.[1] && dash[2]) return Number(dash[1]) + Number(dash[2]) / 12;
  const feet =
    /^(\d+(?:\.\d+)?) ?(?:'|ft|feet|foot)(?: ?- ?| )?(\d+(?:\.\d+)?|\d+ \d+\/\d+)? ?(?:"|in|inch|inches)?$/.exec(
      raw,
    );
  if (feet?.[1]) {
    const whole = Number(feet[1]);
    if (!feet[2]) return whole;
    const inches = parseInches(feet[2]);
    return inches === null ? null : whole + inches / 12;
  }
  if (/^\d+(?:\.\d+)?(?: ?(?:ft|feet|foot))?$/.test(raw))
    return Number.parseFloat(raw);
  return null;
}

function parseMeters(raw: string): number | null {
  const matched = /^(\d+(?:\.\d+)?) ?(?:(mm|cm|m))?$/.exec(raw);
  if (!matched?.[1]) return null;
  const value = Number(matched[1]);
  if (matched[2] === "mm") return value / 1000;
  if (matched[2] === "cm") return value / 100;
  return value;
}

/**
 * A length typed by a person.
 * Feet: `24'6"`, `24' 6 1/2"`, `24-6`, `6"`, `24 ft 6 in`, or a plain number of feet.
 * Meters: a plain number of meters, or a number with `m`, `cm`, or `mm`.
 */
export function parseLength(text: string, unit: MeasureUnit): number | null {
  const raw = text
    .trim()
    .toLowerCase()
    .replace(/[′’]/g, "'")
    .replace(/[″“”]/g, '"')
    .replace(/\s+/g, " ");
  if (!raw) return null;
  return unit === "m" ? parseMeters(raw) : parseFeet(raw);
}

function trimMeters(meters: number): string {
  return meters.toFixed(2).replace(/\.?0+$/, "");
}

/** Feet and inches to the nearest inch, or meters to the nearest centimetre. */
export function formatLength(length: number, unit: MeasureUnit): string {
  if (!Number.isFinite(length)) return "—";
  if (unit === "m") return `${trimMeters(Math.round(length * 100) / 100)} m`;
  const sign = length < 0 ? "-" : "";
  const absolute = Math.abs(length);
  let feet = Math.floor(absolute + 1e-9);
  let inches = Math.round((absolute - feet) * 12);
  if (inches === 12) {
    feet += 1;
    inches = 0;
  }
  return `${sign}${feet}'-${inches}"`;
}

/**
 * Where a screen point lands on the fitted sheet.
 * `local` is relative to the viewer's top-left. Returns null when the point misses the sheet.
 * The view is the same one the sheet is drawn with: origin at the frame centre, y downward.
 */
export function sheetPointFromFrame(
  local: SheetPoint,
  frame: { width: number; height: number },
  fit: { width: number; height: number },
  view: { scale: number; x: number; y: number },
): SheetPoint | null {
  if (!(fit.width > 0) || !(fit.height > 0)) return null;
  const shownWidth = fit.width * view.scale;
  const shownHeight = fit.height * view.scale;
  if (!(shownWidth > 0) || !(shownHeight > 0)) return null;
  const left = frame.width / 2 + view.x - shownWidth / 2;
  const top = frame.height / 2 + view.y - shownHeight / 2;
  const x = (local.x - left) / shownWidth;
  const y = (local.y - top) / shownHeight;
  if (x < 0 || y < 0 || x > 1 || y > 1) return null;
  return { x, y };
}

const scaleKey = (sheetKey: string) => `foremanhq.sheet-scale.${sheetKey}`;

export function readSheetScale(sheetKey: string): SheetScale | null {
  try {
    const raw = window.localStorage.getItem(scaleKey(sheetKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SheetScale>;
    if (
      (parsed.unit === "ft" || parsed.unit === "m") &&
      typeof parsed.unitsPerSheetWidth === "number" &&
      parsed.unitsPerSheetWidth > 0 &&
      Number.isFinite(parsed.unitsPerSheetWidth)
    )
      return {
        unit: parsed.unit,
        unitsPerSheetWidth: parsed.unitsPerSheetWidth,
      };
  } catch {
    // Ignore a broken or blocked store and ask for the scale again.
  }
  return null;
}

export function writeSheetScale(sheetKey: string, scale: SheetScale) {
  try {
    window.localStorage.setItem(scaleKey(sheetKey), JSON.stringify(scale));
  } catch {
    // The distance still works for this visit when the browser refuses storage.
  }
}

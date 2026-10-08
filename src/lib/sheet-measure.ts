/** A point on a drawing, as a fraction of the sheet width (x) and height (y). */
export type SheetPoint = { x: number; y: number };

export type MeasureUnit = "ft" | "m";

export type SheetScale = {
  /** Real-world length, in `unit`, of the full width of the sheet. */
  unitsPerSheetWidth: number;
  unit: MeasureUnit;
  /** The scale as printed, such as `1/4" = 1'-0"`, when it was read from the drawing. */
  label?: string;
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
  const next: SheetScale = {
    unit,
    unitsPerSheetWidth: scale.unitsPerSheetWidth * factor,
  };
  if (scale.label) next.label = scale.label;
  return next;
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
    ) {
      const scale: SheetScale = {
        unit: parsed.unit,
        unitsPerSheetWidth: parsed.unitsPerSheetWidth,
      };
      const label = typeof parsed.label === "string" ? parsed.label.trim() : "";
      if (label.length > 0 && label.length <= 80) scale.label = label;
      return scale;
    }
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

/**
 * Units a person can type a known length in, or read totals in. The shared
 * sheet scale itself is stored in feet or meters (`MeasureUnit`).
 */
export type LengthUnit = "m" | "mm" | "in" | "ft";

export const LENGTH_UNITS: ReadonlyArray<{ value: LengthUnit; label: string }> = [
  { value: "m", label: "m" },
  { value: "mm", label: "mm" },
  { value: "in", label: "in" },
  { value: "ft", label: "ft" },
];

/** The stored scale unit for a length unit: meters for m/mm, feet for in/ft. */
export function scaleUnitFor(unit: LengthUnit): MeasureUnit {
  return unit === "m" || unit === "mm" ? "m" : "ft";
}

/**
 * A typed length in `unit`, returned in its stored unit (meters or feet).
 * A plain number is read in `unit` (e.g. 7500 in mm, 18 in inches); feet and
 * inches like 24'6" and metric suffixes still work.
 */
export function parseLengthAs(
  text: string,
  unit: LengthUnit,
): { length: number; unit: MeasureUnit } | null {
  const raw = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!raw) return null;
  const plain = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
  if (unit === "mm") {
    const length = plain !== null ? plain / 1000 : parseLength(raw, "m");
    return length === null ? null : { length, unit: "m" };
  }
  if (unit === "in") {
    const length = plain !== null ? plain / 12 : parseLength(raw, "ft");
    return length === null ? null : { length, unit: "ft" };
  }
  const length = parseLength(raw, unit);
  return length === null ? null : { length, unit };
}

/** A length stored in `stored` units, written in `shown` units. */
export function formatLengthAs(length: number, stored: MeasureUnit, shown: LengthUnit): string {
  if (!Number.isFinite(length)) return "—";
  const meters = stored === "m" ? length : length * FEET_TO_METERS;
  if (shown === "m") return formatLength(meters, "m");
  if (shown === "mm") return `${Math.round(meters * 1000)} mm`;
  const feet = meters / FEET_TO_METERS;
  if (shown === "ft") return formatLength(feet, "ft");
  const inches = Math.round(feet * 12 * 100) / 100;
  return `${inches.toFixed(2).replace(/\.?0+$/, "")}"`;
}

export type AngleSnap = { point: SheetPoint; angle: 45 | 90 };

/**
 * Measuring or setting a scale: when the line from `anchor` to `target` is within
 * `toleranceDeg` of square (90°) or 45° to `reference` (the attached drawing
 * line for the first segment, then the previous measurement segment), lock it
 * to that angle. A missing reference falls back to sheet horizontal. If `line`
 * (the line under the second end) is given, the end lands exactly where the
 * locked line crosses it. Angles are measured on the real sheet (y × aspect).
 */
export function snapToAngle(
  anchor: SheetPoint,
  target: SheetPoint,
  aspect: number,
  reference: { x1: number; y1: number; x2: number; y2: number } | null,
  line: { x1: number; y1: number; x2: number; y2: number } | null = null,
  toleranceDeg = 4,
): AngleSnap | null {
  if (!(aspect > 0)) return null;
  const ax = anchor.x, ay = anchor.y * aspect;
  const tx = target.x - ax, ty = target.y * aspect - ay;
  if (Math.hypot(tx, ty) < 1e-9) return null;
  const base = reference
    ? Math.atan2((reference.y2 - reference.y1) * aspect, reference.x2 - reference.x1)
    : 0;
  const heading = Math.atan2(ty, tx);
  const tolerance = (toleranceDeg * Math.PI) / 180;
  let best: { angle: 45 | 90; theta: number; off: number } | null = null;
  for (let k = -4; k <= 4; k++) {
    if (k % 2 === 0 && Math.abs(k) !== 2) continue; // 45°, 90°, 135° … only
    const theta = base + (k * Math.PI) / 4;
    const off = Math.abs(Math.atan2(Math.sin(heading - theta), Math.cos(heading - theta)));
    if (off <= tolerance && (!best || off < best.off))
      best = { angle: Math.abs(k) % 4 === 2 ? 90 : 45, theta, off };
  }
  if (!best) return null;
  const ux = Math.cos(best.theta), uy = Math.sin(best.theta);
  let t = tx * ux + ty * uy;
  if (line) {
    const lx = line.x1 - ax, ly = line.y1 * aspect - ay;
    const dx = line.x2 - line.x1, dy = (line.y2 - line.y1) * aspect;
    const denominator = ux * dy - uy * dx;
    if (Math.abs(denominator) > 1e-9) {
      const along = (lx * dy - ly * dx) / denominator;
      const onLine = (ux * along - lx) * dx + (uy * along - ly) * dy;
      const lengthSq = dx * dx + dy * dy;
      const s = lengthSq > 0 ? onLine / lengthSq : -1;
      if (along > 0 && s >= 0 && s <= 1) t = along;
    }
  }
  if (!(t > 0)) return null;
  const point = { x: ax + ux * t, y: (ay + uy * t) / aspect };
  if (line) {
    // If the locked ray misses this finite segment (or runs parallel), keep
    // the actual line snap instead of showing its guide beside an off-line end.
    const dx = line.x2 - line.x1, dy = (line.y2 - line.y1) * aspect;
    const lengthSq = dx * dx + dy * dy;
    const s = lengthSq > 0
      ? ((point.x - line.x1) * dx + (point.y - line.y1) * aspect * dy) / lengthSq : -1;
    const onSegment = Math.min(1, Math.max(0, s));
    const error = Math.hypot(point.x - line.x1 - onSegment * dx, (point.y - line.y1) * aspect - onSegment * dy);
    if (s < -1e-9 || s > 1 + 1e-9 || error > 1e-7) return null;
  }
  return { point, angle: best.angle };
}

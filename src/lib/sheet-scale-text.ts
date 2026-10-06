import {
  formatLength,
  type MeasureUnit,
  type SheetScale,
} from "./sheet-measure";

/** One PDF text run, with x/y as fractions of the page. `w` is a fraction of the page width. */
export type ScaleTextItem = { str: string; x: number; y: number; w?: number };

export type ScaleRead =
  | { ok: true; scale: SheetScale }
  | { ok: false; reason: "none" | "noted" | "several"; labels?: string[] };

const FEET_TO_METERS = 0.3048;
/** A line of text shares a baseline within this fraction of the page height. */
const LINE_Y = 0.01;
/** A wider gap than this, as a fraction of the page width, is a space between runs. */
const SPACE_GAP = 0.008;
/** Used when a run does not say how wide it is. Small, so split glyphs still join. */
const CHAR_WIDTH = 0.0022;
const NEIGHBOR_Y = 0.03;
const NEIGHBOR_X = 0.35;
const MIN_FEET_PER_INCH = 0.01;
const MAX_FEET_PER_INCH = 5000;

const FRACTIONS: Record<string, string> = {
  "¼": "1/4",
  "½": "1/2",
  "¾": "3/4",
  "⅛": "1/8",
  "⅜": "3/8",
  "⅝": "5/8",
  "⅞": "7/8",
};

const COMMON_RATIOS = new Set([
  10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 750, 1000, 1250, 2000, 2500,
  5000,
]);

const EQUALS =
  /(?:^|[^.\d/])(\d+\s+\d+\/\d+|\d+-\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*(?:"|in\b)?\s*=\s*(\d+(?:\.\d+)?)\s*(?:'|ft\b)\s*(?:-\s*(\d+(?:\.\d+)?)\s*(?:"|in\b)?)?/gi;
const SHORTHAND =
  /\bSCALE\b(?:\s*:)?\s*(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*(?:"|in\b)/i;
const METRIC = /(?:^|[^.\d])1\s*:\s*(\d{2,5})(?![\d.])/g;
const NOTED =
  /\b(?:as\s+indicated|as\s+noted|n\.?\s*t\.?\s*s\.?|not\s+to\s+scale|not\s+to\s+be\s+scaled|do\s+not\s+scale)\b/i;
const SCALE_WORD = /\bSCALE\b/gi;
const FULL_SIZE = /\bFULL\s*(?:SIZE|SCALE)\b/i;
const NOT_FULL = /\bNOT\s+FULL\s*(?:SIZE|SCALE)\b/i;

type LinePart = { index: number; x: number; y: number };
type Line = { text: string; x: number; y: number; parts: LinePart[] };
type Candidate = {
  feetPerPaperInch: number;
  unit: MeasureUnit;
  label: string;
  x: number;
  y: number;
  nearScale: boolean;
  titleBlock: boolean;
};

/** Primes, vulgar fractions, and spaces around the marks a scale is written with. */
export function normalizeScaleText(raw: string): string {
  let text = raw.replace(/[′’ˈ]/g, "'").replace(/[″“”]/g, '"');
  for (const [mark, ascii] of Object.entries(FRACTIONS))
    text = text.replaceAll(mark, ascii);
  text = text
    .replace(/\u2044/g, "/")
    .replace(/\s+/g, " ")
    .trim();
  return text
    .replace(/ ?\/ ?/g, "/")
    .replace(/ ?' ?/g, "'")
    .replace(/ ?" ?/g, '"');
}

function parsePaperInches(raw: string): number | null {
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(raw);
  if (mixed?.[1] && mixed[2] && mixed[3]) {
    const denominator = Number(mixed[3]);
    if (denominator === 0) return null;
    return Number(mixed[1]) + Number(mixed[2]) / denominator;
  }
  const dashed = /^(\d+)-(\d+)\/(\d+)$/.exec(raw);
  if (dashed?.[1] && dashed[2] && dashed[3]) {
    const denominator = Number(dashed[3]);
    if (denominator === 0) return null;
    return Number(dashed[1]) + Number(dashed[2]) / denominator;
  }
  const fraction = /^(\d+)\/(\d+)$/.exec(raw);
  if (fraction?.[1] && fraction[2]) {
    const denominator = Number(fraction[2]);
    if (denominator === 0) return null;
    return Number(fraction[1]) / denominator;
  }
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  return null;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function formatInches(inches: number): string {
  const whole = Math.floor(inches + 1e-9);
  const fraction = inches - whole;
  if (fraction < 1e-6) return `${whole}"`;
  let numerator = 0;
  let denominator = 1;
  let error = fraction;
  for (let d = 1; d <= 64; d++) {
    const n = Math.round(fraction * d);
    if (n <= 0 || n >= d) continue;
    const next = Math.abs(fraction - n / d);
    if (next < error - 1e-9) {
      numerator = n;
      denominator = d;
      error = next;
    }
  }
  if (numerator === 0 || error > 1e-4) {
    const rounded = Math.round(inches * 1000) / 1000;
    return `${String(rounded)}"`;
  }
  const divisor = gcd(numerator, denominator);
  const n = numerator / divisor;
  const d = denominator / divisor;
  return whole === 0 ? `${n}/${d}"` : `${whole} ${n}/${d}"`;
}

function formatScaleLabel(paperInches: number, realFeet: number): string {
  return `${formatInches(paperInches)} = ${formatLength(realFeet, "ft")}`;
}

function withoutDisclaimer(text: string): string {
  return text.replace(
    /\b(?:not\s+to\s+scale|not\s+to\s+be\s+scaled|do\s+not\s+scale)\b/gi,
    " ",
  );
}

/** A real "SCALE" label. "NOT TO SCALE" and "NOT TO BE SCALED" do not count. */
function hasScaleWord(text: string): boolean {
  return /\bSCALE\b/i.test(withoutDisclaimer(text));
}

function scaleAnchors(lines: Line[]): { x: number; y: number }[] {
  const anchors: { x: number; y: number }[] = [];
  for (const line of lines) {
    SCALE_WORD.lastIndex = 0;
    for (const match of line.text.matchAll(SCALE_WORD)) {
      const index = match.index ?? 0;
      const around = line.text.slice(Math.max(0, index - 24), index + 16);
      if (!hasScaleWord(around)) continue;
      const part = partAt(line, index);
      anchors.push({ x: part.x, y: part.y });
    }
  }
  return anchors;
}

function inTitleBlock(x: number, y: number): boolean {
  return x >= 0.72 || y >= 0.86 || (y <= 0.08 && x >= 0.55);
}

function itemEnd(item: ScaleTextItem, text: string): number {
  if (typeof item.w === "number" && item.w > 0) return item.x + item.w;
  return item.x + text.length * CHAR_WIDTH;
}

/** Runs that share a baseline become one line. A wide gap keeps the words apart. */
function joinLines(items: ScaleTextItem[]): Line[] {
  const ready = items
    .map((item) => ({ item, text: normalizeScaleText(item.str) }))
    .filter((entry) => entry.text.length > 0)
    .sort((a, b) => a.item.y - b.item.y || a.item.x - b.item.x);
  const groups: { y: number; entries: typeof ready }[] = [];
  for (const entry of ready) {
    const group = groups.find(
      (candidate) => Math.abs(candidate.y - entry.item.y) <= LINE_Y,
    );
    if (group) group.entries.push(entry);
    else groups.push({ y: entry.item.y, entries: [entry] });
  }
  return groups.map((group) => {
    const entries = group.entries.sort((a, b) => a.item.x - b.item.x);
    let text = "";
    let end = 0;
    const parts: LinePart[] = [];
    for (const entry of entries) {
      if (text.length > 0 && entry.item.x - end > SPACE_GAP) text += " ";
      parts.push({ index: text.length, x: entry.item.x, y: entry.item.y });
      text += entry.text;
      end = Math.max(end, itemEnd(entry.item, entry.text));
    }
    const first = parts[0]!;
    return { text, x: first.x, y: first.y, parts };
  });
}

function partAt(line: Line, index: number): LinePart {
  let chosen = line.parts[0]!;
  for (const part of line.parts) {
    if (part.index <= index) chosen = part;
    else break;
  }
  return chosen;
}

function digitAt(match: RegExpMatchArray): number {
  const offset = match[0].search(/\d/);
  return (match.index ?? 0) + (offset < 0 ? 0 : offset);
}

function consider(
  found: Candidate[],
  line: Line,
  index: number,
  feetPerPaperInch: number,
  unit: MeasureUnit,
  label: string,
) {
  if (
    !(feetPerPaperInch >= MIN_FEET_PER_INCH) ||
    feetPerPaperInch > MAX_FEET_PER_INCH
  )
    return;
  const part = partAt(line, index);
  found.push({
    feetPerPaperInch,
    unit,
    label,
    x: part.x,
    y: part.y,
    nearScale: false,
    titleBlock: false,
  });
}

function scalesOnLine(line: Line): Candidate[] {
  const found: Candidate[] = [];
  EQUALS.lastIndex = 0;
  for (const match of line.text.matchAll(EQUALS)) {
    const paper = parsePaperInches(match[1] ?? "");
    const feet = Number(match[2]);
    const inches = match[3] ? Number(match[3]) : 0;
    if (
      paper === null ||
      !(paper > 0) ||
      !Number.isFinite(feet) ||
      !Number.isFinite(inches)
    )
      continue;
    const realFeet = feet + inches / 12;
    if (!(realFeet > 0)) continue;
    consider(
      found,
      line,
      digitAt(match),
      realFeet / paper,
      "ft",
      formatScaleLabel(paper, realFeet),
    );
  }
  if (found.length > 0) return found;

  if (hasScaleWord(line.text)) {
    const match = SHORTHAND.exec(line.text);
    const paper = match?.[1] ? parsePaperInches(match[1]) : null;
    if (match && paper !== null && paper > 0 && paper < 1) {
      consider(
        found,
        line,
        digitAt(match),
        1 / paper,
        "ft",
        formatScaleLabel(paper, 1),
      );
    }
  }
  if (found.length > 0) return found;

  METRIC.lastIndex = 0;
  for (const match of line.text.matchAll(METRIC)) {
    const ratio = Number(match[1]);
    const onScale = hasScaleWord(line.text);
    const common = COMMON_RATIOS.has(ratio);
    if (
      !(
        (onScale && ratio >= 10 && ratio <= 10000) ||
        (common && line.text.length < 40)
      )
    )
      continue;
    consider(
      found,
      line,
      digitAt(match),
      (ratio * 0.0254) / FEET_TO_METERS,
      "m",
      `1:${ratio}`,
    );
  }
  if (found.length > 0) return found;

  if (FULL_SIZE.test(line.text) && !NOT_FULL.test(line.text)) {
    consider(
      found,
      line,
      line.text.search(FULL_SIZE),
      1 / 12,
      "ft",
      "Full size",
    );
  }
  return found;
}

function sameRatio(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / scale <= 0.01;
}

function groupByRatio(items: Candidate[]): Candidate[][] {
  const groups: Candidate[][] = [];
  for (const item of items) {
    const group = groups.find((candidate) =>
      sameRatio(candidate[0]!.feetPerPaperInch, item.feetPerPaperInch),
    );
    if (group) group.push(item);
    else groups.push([item]);
  }
  return groups;
}

function preference(item: Candidate): number {
  return (item.nearScale ? 5 : 0) + (item.titleBlock ? 3 : 0);
}

function best(group: Candidate[]): Candidate {
  return group.reduce((top, item) =>
    preference(item) > preference(top) ? item : top,
  );
}

function toSheetScale(item: Candidate, pageWidthPoints: number): SheetScale {
  const inches = pageWidthPoints / 72;
  if (item.unit === "m") {
    return {
      unit: "m",
      unitsPerSheetWidth: inches * FEET_TO_METERS * item.feetPerPaperInch,
      label: item.label,
    };
  }
  return {
    unit: "ft",
    unitsPerSheetWidth: inches * item.feetPerPaperInch,
    label: item.label,
  };
}

/**
 * The printed scale on a drawing, as the real length of the whole sheet.
 * One scale is used for the whole sheet. A sheet that prints more than one,
 * or that says the scale is noted somewhere else, is left unset.
 * `pageWidthPoints` is the PDF page width at scale 1 (already in 1/72 inch).
 */
export function scaleFromSheetText(
  items: ScaleTextItem[],
  pageWidthPoints: number,
): ScaleRead {
  const lines = joinLines(items);
  if (!(pageWidthPoints > 0) || !Number.isFinite(pageWidthPoints))
    return { ok: false, reason: "none" };

  const candidates = lines.flatMap(scalesOnLine);
  const anchors = scaleAnchors(lines);
  for (const candidate of candidates) {
    candidate.titleBlock = inTitleBlock(candidate.x, candidate.y);
    // The same baseline counts even when the label sits at the other end of the line.
    candidate.nearScale = anchors.some((anchor) => {
      const dy = Math.abs(anchor.y - candidate.y);
      if (dy <= LINE_Y) return true;
      return dy <= NEIGHBOR_Y && Math.abs(anchor.x - candidate.x) <= NEIGHBOR_X;
    });
  }

  if (candidates.length === 0) {
    return lines.some((line) => NOTED.test(line.text))
      ? { ok: false, reason: "noted" }
      : { ok: false, reason: "none" };
  }

  const groups = groupByRatio(candidates);
  const chosen = (() => {
    if (groups.length === 1) return best(groups[0]!);
    const preferred = groupByRatio(
      candidates.filter((item) => item.nearScale || item.titleBlock),
    );
    if (preferred.length === 1) return best(preferred[0]!);
    return null;
  })();
  if (chosen) return { ok: true, scale: toSheetScale(chosen, pageWidthPoints) };

  const conflicting = groupByRatio(
    candidates.filter((item) => item.nearScale || item.titleBlock),
  );
  const reported = conflicting.length > 1 ? conflicting : groups;
  return {
    ok: false,
    reason: "several",
    labels: reported.map((group) => best(group).label),
  };
}

export function scaleReadMessage(
  result: Extract<ScaleRead, { ok: false }>,
): string {
  if (result.reason === "noted")
    return "This drawing doesn't give one scale for the whole sheet.";
  if (result.reason === "several") {
    const labels = (result.labels ?? [])
      .map((label) => label.trim())
      .filter((label) => label.length > 0);
    if (labels.length === 0) return "This drawing shows more than one scale.";
    const last = labels[labels.length - 1]!;
    const list =
      labels.length === 1
        ? last
        : `${labels.slice(0, -1).join(", ")} and ${last}`;
    return `This drawing shows more than one scale (${list}).`;
  }
  return "Couldn't read a scale from this drawing.";
}

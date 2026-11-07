import { z } from "zod";
import { packsFromPieces } from "./pack-quantity";
import type { PipeComponentKind } from "./pipe-components-types";
import { formatPipeSize, sizeKey, type PipeSize } from "./pipe-run-sizes";
import {
  jobSystemRequirementsSchema,
  matchesAssessedComponent,
} from "./job-systems";

/**
 * A pipe system's material standard: which catalogue material and category its
 * pipe, fittings and valves come from, how long a stick is, how much waste to
 * allow, and parts someone chose by hand for particular lines.
 */
const ruleId = z.string().uuid().nullable();
const rule = z.object({ materialId: ruleId, categoryId: ruleId });
export const pipeSpecSchema = z.object({
  pipe: rule.extend({
    stickLength: z.number().positive().max(100),
    stickUnit: z.enum(["ft", "m"]),
    wastePercent: z.number().min(0).max(100),
  }),
  fittings: rule,
  valves: rule,
  requirements: jobSystemRequirementsSchema.optional(),
  parts: z
    .record(z.string().max(120), z.string().uuid())
    .refine(
      (parts) => Object.keys(parts).length <= 400,
      "Too many chosen parts",
    ),
});
export type PipeSpec = z.infer<typeof pipeSpecSchema>;
export type PipeSpecGroup = "pipe" | "fittings" | "valves";
export const pipeSystemCode = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Z0-9][A-Z0-9 -]*$/i)
  .transform((code) => code.toUpperCase());

export function defaultPipeSpec(): PipeSpec {
  return {
    pipe: {
      materialId: null,
      categoryId: null,
      stickLength: 10,
      stickUnit: "ft",
      wastePercent: 10,
    },
    fittings: { materialId: null, categoryId: null },
    valves: { materialId: null, categoryId: null },
    parts: {},
  };
}

/** What a selected system needs, read from the drawing. */
export type PipeTakeoff = {
  system: string;
  /** Metres of pipe per size; null when the sheet has no scale. */
  runs: { size: PipeSize | null; meters: number | null }[];
  components: {
    kind: PipeComponentKind;
    name: string;
    size: PipeSize | null;
    count: number;
  }[];
  /** Fitting detection has finished for this selection. */
  componentsChecked: boolean;
  /** Limited to a drawn area, or the trace hit its limit. */
  partial: boolean;
  tagCount: number;
};

/** The catalogue fields used to pick and count a part. */
export type PipeCataloguePart = {
  id: string;
  displayName: string;
  description?: string | null;
  sizeLabel?: string | null;
  sizeNominal?: string | number | null;
  sizeUnit?: string | null;
  piecesPerPack?: number | null;
  bulkUnit?: string | null;
  individualUnit?: string | null;
  imageUrl?: string | null;
  material?: string | null;
  materialId?: string | null;
  categoryId?: string | null;
  catalogId?: string | null;
};

export type PipeTakeoffLine = {
  key: string;
  group: PipeSpecGroup;
  label: string;
  size: PipeSize | null;
  kind?: PipeComponentKind;
  name?: string;
  /** Metres of pipe, or a count of fittings. */
  amount: number;
};

const LISTED_KINDS = new Set<PipeComponentKind>([
  "valve",
  "elbow",
  "tee",
  "wye",
  "reducer",
  "coupling",
  "cap",
]);

export function takeoffLines(takeoff: PipeTakeoff): PipeTakeoffLine[] {
  const lines: PipeTakeoffLine[] = [];
  for (const run of takeoff.runs) {
    if (run.meters == null || !(run.meters > 0) || !run.size) continue;
    lines.push({
      key: `pipe|${sizeKey(run.size)}`,
      group: "pipe",
      label: `${formatPipeSize(run.size)} pipe`,
      size: run.size,
      amount: run.meters,
    });
  }
  const fittings = new Map<string, PipeTakeoffLine>();
  for (const item of takeoff.components) {
    if (!LISTED_KINDS.has(item.kind) || !(item.count > 0)) continue;
    const name = item.name.trim() || item.kind;
    const key = `${item.kind}:${name.toLowerCase()}|${item.size ? sizeKey(item.size) : "?"}`;
    const line = fittings.get(key);
    if (line) line.amount += item.count;
    else
      fittings.set(key, {
        key,
        group: item.kind === "valve" ? "valves" : "fittings",
        label: item.size
          ? `${formatPipeSize(item.size)} ${name.charAt(0).toLowerCase()}${name.slice(1)}`
          : name,
        size: item.size,
        kind: item.kind,
        name,
        amount: item.count,
      });
  }
  return [
    ...lines,
    ...[...fittings.values()].sort(
      (a, b) =>
        (a.group === b.group ? 0 : a.group === "valves" ? 1 : -1) ||
        (b.size?.nominal ?? 0) - (a.size?.nominal ?? 0) ||
        a.label.localeCompare(b.label),
    ),
  ];
}

/** Common metric equivalents of North American nominal sizes. */
const DN_INCHES: [number, number][] = [
  [8, 0.25],
  [10, 0.375],
  [15, 0.5],
  [20, 0.75],
  [25, 1],
  [32, 1.25],
  [40, 1.5],
  [50, 2],
  [65, 2.5],
  [75, 3],
  [80, 3],
  [90, 3.5],
  [100, 4],
  [125, 5],
  [150, 6],
  [200, 8],
  [250, 10],
  [300, 12],
  [350, 14],
  [400, 16],
  [450, 18],
  [500, 20],
  [600, 24],
];
function inchesOf(size: PipeSize) {
  return size.unit === "in"
    ? size.nominal
    : (DN_INCHES.find(([mm]) => mm === size.nominal)?.[1] ?? size.nominal / 25);
}
export function sameSize(a: PipeSize, b: PipeSize) {
  return Math.abs(inchesOf(a) - inchesOf(b)) < 0.001;
}

const SIZE =
  /(\d+[- ]\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+)\s*(?:"|″|''|in(?:ch(?:es)?)?\b|(mm)\b)?/i;
function number(text: string) {
  const mixed = /^(\d+)[- ](\d+)\/(\d+)$/.exec(text);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\/(\d+)$/.exec(text);
  return fraction ? Number(fraction[1]) / Number(fraction[2]) : Number(text);
}

/** A part's nominal size, and whether it is a reducing size such as 4 x 3. */
export function partSize(
  part: PipeCataloguePart,
): { size: PipeSize; reducing: boolean } | null {
  const label = part.sizeLabel?.trim() ?? "";
  const reducing = /\d\s*(?:"|″|in|mm)?\s*[x×]\s*\d/i.test(
    label || part.displayName,
  );
  const nominal = Number(part.sizeNominal);
  const unit = part.sizeUnit?.toLowerCase();
  if (
    Number.isFinite(nominal) &&
    nominal > 0 &&
    (unit === "in" || unit === "mm")
  )
    return { size: { unit, nominal }, reducing };
  for (const text of [label, part.displayName]) {
    // Sizes in names are marked; a bare label like "3" is a size in inches.
    const match =
      text === label
        ? SIZE.exec(text)
        : /(\d+[- ]\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+)\s*(?:"|″|''|(mm)\b)/i.exec(
            text,
          );
    if (!match) continue;
    const value = number(match[1]!);
    if (value > 0)
      return {
        size: { unit: match[2] ? "mm" : "in", nominal: value },
        reducing,
      };
  }
  return null;
}

const KIND_WORDS: Partial<Record<PipeComponentKind, RegExp>> = {
  elbow: /\b(?:elbows?|ells?|bends?|90|45)\b|1\/[48]\s*bend/i,
  tee: /\btees?\b/i,
  wye: /\b(?:wyes?|combos?|combination|y)\b/i,
  reducer: /\b(?:reduc\w*|bushings?|increasers?)\b/i,
  coupling: /\b(?:couplings?|couplers?|no[- ]hub|bands?)\b/i,
  cap: /\b(?:caps?|plugs?)\b/i,
  valve: /\bvalves?\b/i,
};
const PIPE_WORD = /\bpipes?\b|\btubes?\b|\btubing\b|\blength\b/i;
const FITTING_WORD =
  /\b(?:elbows?|ells?|bends?|tees?|wyes?|couplings?|caps?|plugs?|valves?|adapters?|reduc\w*|bushings?|hangers?|clamps?)\b/i;

function detailScore(line: PipeTakeoffLine, text: string) {
  const name = line.name?.toLowerCase() ?? "";
  if (line.kind === "elbow") {
    if (name.includes("90"))
      return /\b90\b|1\/4\s*bend|quarter/i.test(text)
        ? 2
        : /\b45\b|1\/8|22/.test(text)
          ? -2
          : 0;
    if (name.includes("45"))
      return /\b45\b|1\/8\s*bend|eighth/i.test(text)
        ? 2
        : /\b90\b|1\/4/.test(text)
          ? -2
          : 0;
    if (name.includes("22")) return /\b22|1\/16/i.test(text) ? 2 : -1;
  }
  if (line.kind === "valve") {
    const type = /^(\w[\w ]*?)\s+valve$/i.exec(line.name ?? "")?.[1];
    if (type && type.toLowerCase() !== "valve")
      return new RegExp(`\\b${type.replace(/[^a-z ]/gi, "")}\\b`, "i").test(
        text,
      )
        ? 2
        : -1;
  }
  return 0;
}

/** Parts that fit a line, best first. A sized line only takes parts of its size. */
export function partOptions(
  line: PipeTakeoffLine,
  parts: readonly PipeCataloguePart[],
) {
  const scored: { part: PipeCataloguePart; score: number }[] = [];
  for (const part of parts) {
    const text = `${part.displayName} ${part.description ?? ""}`;
    const sized = partSize(part);
    if (line.size) {
      if (!sized || !sameSize(sized.size, line.size)) continue;
      if (sized.reducing && line.kind !== "reducer") continue;
    }
    let score = 0;
    if (line.group === "pipe") {
      if (FITTING_WORD.test(part.displayName)) continue;
      score += PIPE_WORD.test(text) ? 2 : 0;
    } else {
      const words = line.kind ? KIND_WORDS[line.kind] : undefined;
      if (words && !words.test(text)) continue;
      score += detailScore(line, text);
    }
    scored.push({ part, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((entry) => entry.part);
}

/** Assessed requirements never substitute a different fitting angle/type. */
export function assessedPartOptions(
  line: PipeTakeoffLine,
  parts: readonly PipeCataloguePart[],
) {
  if (!line.size) return [];
  return partOptions(line, parts).filter((part) => {
    const text = `${part.displayName} ${part.description ?? ""}`;
    return line.group === "pipe"
      ? PIPE_WORD.test(text)
      : matchesAssessedComponent(line, part);
  });
}

export function chosenPart(
  line: PipeTakeoffLine,
  parts: readonly PipeCataloguePart[],
  spec: PipeSpec,
) {
  const pinned = spec.parts[line.key];
  return (
    (pinned ? parts.find((part) => part.id === pinned) : undefined) ??
    partOptions(line, parts)[0] ??
    null
  );
}

const LENGTH_UNITS: Record<string, number> = {
  ft: 0.3048,
  foot: 0.3048,
  feet: 0.3048,
  lf: 0.3048,
  m: 1,
  meter: 1,
  metre: 1,
  meters: 1,
  metres: 1,
};
const lengthUnit = (unit?: string | null) =>
  LENGTH_UNITS[unit?.trim().toLowerCase() ?? ""];

/** Pipe needed with waste, in metres. */
export function pipeWithWaste(meters: number, spec: PipeSpec) {
  return meters * (1 + spec.pipe.wastePercent / 100);
}
export function stickMeters(spec: PipeSpec) {
  return spec.pipe.stickLength * (spec.pipe.stickUnit === "ft" ? 0.3048 : 1);
}

/**
 * The list quantity, in the part's selling packs. Pipe is whole sticks of the
 * spec's length with waste; a part sold by the foot or metre gets those sticks
 * as length. Fittings are counted pieces.
 */
export function lineQuantity(
  line: PipeTakeoffLine,
  part: PipeCataloguePart,
  spec: PipeSpec,
) {
  if (line.group !== "pipe")
    return packsFromPieces(Math.ceil(line.amount), part.piecesPerPack);
  const sticks = Math.ceil(
    pipeWithWaste(line.amount, spec) / stickMeters(spec) - 1e-9,
  );
  const sold = lengthUnit(part.bulkUnit);
  if (sold) return Math.ceil((sticks * stickMeters(spec)) / sold - 1e-9);
  const piece = lengthUnit(part.individualUnit);
  // A pack measured in length (a 10 ft length): count length, not sticks.
  if (piece && (part.piecesPerPack ?? 1) > 1)
    return Math.ceil(
      (sticks * stickMeters(spec)) / (piece * part.piecesPerPack!) - 1e-9,
    );
  return packsFromPieces(sticks, part.piecesPerPack);
}
export function stickCount(line: PipeTakeoffLine, spec: PipeSpec) {
  return Math.ceil(pipeWithWaste(line.amount, spec) / stickMeters(spec) - 1e-9);
}

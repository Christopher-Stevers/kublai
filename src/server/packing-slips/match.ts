/** Matches packing-slip lines to order items by supplier code and by
 * description, with sizes, supplier abbreviations and OCR misreads normalised.
 * Each line gets at most one item; an item takes a second line only on an
 * exact code (split shipments). Near-ties stay unmatched for the user. */
import type { ReceiptOrderItem } from "~/lib/packing-slip-review";

const WORDS: Record<string, string | string[]> = {
  cu: "copper",
  cop: "copper",
  copr: "copper",
  ell: "elbow",
  el: "elbow",
  elb: "elbow",
  elbows: "elbow",
  cplg: "coupling",
  cpl: "coupling",
  cplng: "coupling",
  coup: "coupling",
  adpt: "adapter",
  adapt: "adapter",
  adptr: "adapter",
  adap: "adapter",
  adaptor: "adapter",
  ftg: "fitting",
  vlv: "valve",
  valv: "valve",
  brs: "brass",
  blk: "black",
  galv: "galvanized",
  stl: "steel",
  nip: "nipple",
  hgr: "hanger",
  hngr: "hanger",
  reducing: "red",
  reducer: "red",
  redcr: "red",
  rdcr: "red",
  san: "sanitary",
  sani: "sanitary",
  "c/o": "cleanout",
  exp: "expansion",
  swt: "sweat",
  fp: ["full", "port"],
  lf: ["lead", "free"],
  mpt: "mpt",
  mip: "mpt",
  mnpt: "mpt",
  male: "mpt",
  fpt: "fpt",
  fip: "fpt",
  fnpt: "fpt",
  female: "fpt",
  pltd: "plated",
  thd: "threaded",
  thrd: "threaded",
  zn: "zinc",
  pexa: ["pex", "a"],
  tube: "pipe",
  tubing: "pipe",
  hd: "head",
  sd: ["self", "drill"],
  driller: "drill",
  drilling: "drill",
  scr: "screw",
  scrw: "screw",
  bsh: "bushing",
  bush: "bushing",
  bshg: "bushing",
  un: "union",
  sch: "schedule",
  "all-thread": ["threaded", "rod"],
};
const STOP = new Set([
  "with",
  "w",
  "and",
  "&",
  "x",
  "the",
  "of",
  "for",
  "ea",
  "each",
  "pcs",
  "pc",
  "box",
  "bx",
  "wrot",
  "wrought",
  "mfr",
  "mfr#",
  "",
]);
const fraction = (whole: string | undefined, num: string, den: string) =>
  Number(whole ?? 0) + Number(num) / Number(den);
const value = (n: number) => String(Math.round(n * 1000) / 1000);

/** Normalised tokens: `s:0.75` for sizes, `ft:12` for lengths, `n:90` for
 * other numbers, words with supplier abbreviations expanded. */
export function tokens(text: string): string[] {
  let s = text
    .toLowerCase()
    .replace(/[″“”]/g, '"')
    .replace(/[’‘′]/g, "'")
    .replace(/°/g, " ")
    .replace(/(\d|")\s*x\s*(?=[\d#])/g, "$1 x ")
    .replace(/(\d)(ft|in)\b/g, "$1 $2");
  const out: string[] = [];
  // Mixed numbers and fractions are always sizes.
  s = s.replace(
    /(?:(?<![\w.-])(\d{1,2})(?:-|\s+))?\b(\d+)\/(\d+)\s*(?:"|''|in\b|inch\b)?/g,
    (_, w: string | undefined, n: string, d: string) => {
      if (
        Number(d) > 0 &&
        Number(d) <= 64 &&
        [2, 4, 8, 16, 32, 64].includes(Number(d))
      )
        out.push(`s:${value(fraction(w, n, d))}`);
      return " ";
    },
  );
  s = s.replace(
    /\b(\d+(?:\.\d+)?)\s*(?:'|ft\b|feet\b|foot\b)/g,
    (_, n: string) => {
      out.push(`ft:${value(Number(n))}`);
      return " ";
    },
  );
  s = s.replace(
    /(?:\b|(?<=\s))(\d*\.?\d+)\s*(?:"|in\b|inch\b)/g,
    (_, n: string) => {
      out.push(`s:${value(Number(n))}`);
      return " ";
    },
  );
  for (const raw of s.split(/[\s,;()]+/)) {
    const t = raw.replace(/^[^\w#]+|[^\w#/]+$/g, "");
    if (!t) continue;
    if (/^\d+(?:\.\d+)?$/.test(t)) {
      out.push(`n:${value(Number(t))}`);
      continue;
    }
    if (/^#\d+$/.test(t)) {
      out.push(t);
      continue;
    }
    // CXC, HXHXH, CXM: connection ends.
    if (/^[a-z](?:x[a-z])+$/.test(t)) {
      for (const end of t.split("x"))
        out.push(end === "m" ? "mpt" : end === "f" ? "fpt" : end);
      continue;
    }
    const mapped = WORDS[t];
    for (let part of mapped ? [mapped].flat() : t.split(/[-/]/)) {
      if (!WORDS[t] && WORDS[part]) part = [WORDS[part]].flat().join(" ");
      for (const p of part.split(" ")) {
        const word =
          p.length > 4 && p.endsWith("s") && !p.endsWith("ss")
            ? p.slice(0, -1)
            : p;
        if (!STOP.has(word)) out.push(word);
      }
    }
  }
  return out;
}

export const normalizeSku = (s: string) =>
  s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const SHAPES: Record<string, string> = {
  O: "0",
  Q: "0",
  D: "0",
  I: "1",
  L: "1",
  S: "5",
  B: "8",
  Z: "2",
  G: "6",
};
/** Codes compared as OCR sees them: O and 0, I and 1, S and 5 alike. */
export const skuShape = (s: string) =>
  normalizeSku(s).replace(/[OQDILSBZG]/g, (c) => SHAPES[c]!);

function edits(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j]!;
      d[j] = Math.min(
        d[j]! + 1,
        d[j - 1]! + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = t;
    }
  }
  return d[b.length]!;
}

export function skuScore(item: ReceiptOrderItem, code: string, text: string) {
  if (!item.sku) return 0;
  const want = normalizeSku(item.sku);
  if (want.length < 3) return 0;
  const codes = [code, ...text.split(/\s+/)]
    .map(normalizeSku)
    .filter((c) => c.length >= 3);
  if (codes.includes(want)) return 1;
  const shape = skuShape(want);
  if (codes.some((c) => skuShape(c) === shape)) return 0.92;
  // Codes split by OCR or printed with spaces.
  if (want.length >= 5 && normalizeSku(text).includes(want)) return 0.9;
  if (want.length >= 6 && codes.some((c) => edits(skuShape(c), shape) === 1))
    return 0.5;
  return 0;
}

const sizes = (t: string[]) =>
  t
    .filter((x) => x.startsWith("s:"))
    .map((x) => x.slice(2))
    .sort();
const same = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export type Scored = { itemId: string; score: number; sku: number };
export function scoreLine(
  items: ReceiptOrderItem[],
  line: { code: string; text: string },
  weights: (t: string) => number,
  itemTokens: Map<string, string[][]>,
): Scored[] {
  const slip = tokens(line.text);
  const slipSet = new Set(slip);
  const slipSizes = sizes(slip);
  const plain = new Set(
    slip.filter((t) => t.startsWith("n:")).map((t) => t.slice(2)),
  );
  return items
    .map((item) => {
      let best = 0;
      for (const words of itemTokens.get(item.id)!) {
        if (!words.length) continue;
        const want = sizes(words);
        // A bare "2" on the slip can be the 2" size.
        const has = (t: string) =>
          slipSet.has(t) || (t.startsWith("s:") && plain.has(t.slice(2)));
        const total = words.reduce((s, t) => s + weights(t), 0);
        const shared = words.filter(has).reduce((s, t) => s + weights(t), 0);
        const slipTotal = slip.reduce(
          (s, t) => s + Math.min(1.5, weights(t)),
          0,
        );
        const slipShared = slip
          .filter(
            (t) =>
              words.includes(t) ||
              (t.startsWith("n:") && want.includes(t.slice(2))),
          )
          .reduce((s, t) => s + Math.min(1.5, weights(t)), 0);
        let score =
          0.75 * (shared / total) +
          0.25 * (slipShared / Math.max(1, slipTotal));
        const seen = [
          ...new Set([...slipSizes, ...want.filter((s) => plain.has(s))]),
        ].sort();
        if (seen.some((s) => !want.includes(s))) score *= 0.3;
        else if (want.length && !seen.length) score *= 0.7;
        else if (!same(want, seen)) score *= 0.85;
        best = Math.max(best, score);
      }
      const sku = skuScore(item, line.code, line.text);
      const score =
        sku >= 0.9 ? 0.9 + 0.1 * best : Math.min(0.89, best + (sku ? 0.1 : 0));
      return { itemId: item.id, score, sku };
    })
    .sort((a, b) => b.score - a.score);
}

export type Match = {
  itemId: string | null;
  confidence: "high" | "medium" | "low";
  candidates: string[];
  ambiguous: boolean;
};
export function matchLines(
  items: ReceiptOrderItem[],
  lines: Array<{ code: string; text: string }>,
): Match[] {
  const itemTokens = new Map(
    items.map((i) => [
      i.id,
      [i.description, ...i.aliases].map((s) => [...new Set(tokens(s))]),
    ]),
  );
  // Words on every order line (e.g. "copper") tell items apart least.
  const df = new Map<string, number>();
  for (const sets of itemTokens.values())
    for (const t of new Set(sets.flat())) df.set(t, (df.get(t) ?? 0) + 1);
  const n = Math.max(1, items.length);
  const weights = (t: string) =>
    (t.startsWith("s:")
      ? 3
      : t.startsWith("n:") || t.startsWith("ft:")
        ? 1.2
        : 1) *
    (1 + Math.log(n / (df.get(t) ?? 1)) / Math.log(n + 1));
  const scored = lines.map((l) => scoreLine(items, l, weights, itemTokens));
  const result: Match[] = scored.map((s) => ({
    itemId: null,
    confidence: "low",
    candidates: s
      .filter((x) => x.score >= 0.3)
      .slice(0, 3)
      .map((x) => x.itemId),
    ambiguous: false,
  }));
  const pairs = scored
    .flatMap((s, line) => s.map((x) => ({ ...x, line })))
    .filter((p) => p.score >= 0.45)
    .sort((a, b) => b.score - a.score);
  const taken = new Map<string, number>();
  for (const p of pairs) {
    const r = result[p.line]!;
    if (r.itemId || r.ambiguous) continue;
    const others = scored[p.line]!.filter((x) => x.itemId !== p.itemId);
    const exactCodes = scored[p.line]!.filter((x) => x.sku === 1).length;
    if (p.sku >= 0.9 && exactCodes <= 1 && !others.some((o) => o.sku >= 0.9)) {
      // A unique code decides, even for a second line of the same item.
      r.itemId = p.itemId;
      r.confidence = "high";
      taken.set(p.itemId, p.line);
      continue;
    }
    if (taken.has(p.itemId)) continue;
    const rival = Math.max(
      0,
      ...others.filter((o) => !taken.has(o.itemId)).map((o) => o.score),
    );
    const margin = p.score - rival;
    if (margin < 0.03 && rival >= 0.45) {
      r.ambiguous = true;
      continue;
    }
    const confidence =
      p.score >= 0.72 && margin >= 0.15
        ? "high"
        : p.score >= 0.58 && margin >= 0.08
          ? "medium"
          : margin >= 0.15
            ? "low"
            : null;
    if (!confidence) continue;
    r.itemId = p.itemId;
    r.confidence = confidence;
    taken.set(p.itemId, p.line);
  }
  return result;
}

/** Where each slip line Jev located on a page starts and ends. Jev counts a
 * page's lines well but places each only to about a hundredth of the page,
 * often a little high and sometimes twice in one place. The OCR places rows
 * of words exactly but misses some and reads ticks as rows, and the page's
 * ink shows every row of type, read or not. Together they place each line. */
import { type InkRow, inkRows } from "./ink-rows";
import type { SlipRow } from "./ocr-rows";

type Edges = { top: number; bottom: number; left: number; right: number };
export type QuantityColumns = Partial<
  Record<"shipped" | "ordered" | "backordered", Edges>
>;

/** A line matches a row at most this far off, in page heights. */
const NEAR = 0.03,
  /** Costs, in page heights: a located line no row matches, a row with a
   * quantity and a description no line claims, and a line starting at a row
   * with a description but no quantity read. */
  MISS = 0.02,
  SKIP = 0.015,
  WEAK = 0.015,
  /** Jev's lines tend to sit this much above where they start. */
  HIGH = 0.01,
  /** A row of ink this near an OCR row is that row. */
  PAIR = 0.01,
  /** Shares of the page's typical row's ink in the quantity columns: a row
   * with at least the first has quantities, and one with at least the second
   * looks like a line's first row rather than wrapped text or a note. */
  INKED = 0.4,
  LINE_INK = 0.7,
  /** Wrapped text and notes start at least this far right of lines' codes. */
  INDENT = 0.06;
const median = (values: number[]) => {
  const v = [...values].sort((a, b) => a - b);
  return v.length
    ? (v[(v.length - 1) >> 1]! + v[v.length >> 1]!) / 2
    : undefined;
};

/** A quantity as OCR reads it, misread or not: with a digit, or one or two
 * characters short of a word such as EA or UM. */
const quantityLike = (text: string) =>
  /\d/.test(text) ||
  [...text].length === 1 ||
  ([...text].length === 2 && !/^[a-z]+$/i.test(text));
const HEADING =
  /^(qty|quantity|shp|ship|shipped|ord|order|ordered|b\/?[o0]|back|backorder|backordered|bo|product|code|item|description|desc|unit|price|um|u\/m|uom|ext|amount|prev|total)$/i;
/** Column headings' words, for those OCR reads a letter or two off. */
const HEADING_WORDS =
  "qty quantity shp ship shipped supplied ord order ordered bo back backorder backordered balance remaining follow product code item part number description desc unit price um uom ext extended amount prev previous total line ln location bin weight sku".split(
    " ",
  );

/** Edit distance, giving up past `most`. */
function distance(a: string, b: string, most: number) {
  if (Math.abs(a.length - b.length) > most) return most + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        prev[j]! + 1,
        next[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    if (Math.min(...next) > most) return most + 1;
    prev = next;
  }
  return prev[b.length]!;
}
/** A column heading's word, as OCR reads it: long words a letter or two
 * off still count. */
const headingWord = (word: string) => {
  const w = word.toLowerCase();
  if (HEADING.test(w)) return true;
  if (w.length < 4) return false;
  const most = w.length >= 7 ? 2 : 1;
  return HEADING_WORDS.some(
    (h) => h.length >= 4 && distance(w, h, most) <= most,
  );
};

/** A row where a line might start. `top` is its highest mark, which a crop
 * must include; `y` is where its type starts, since ticks and handwriting
 * often reach above the printed line. A row with a quantity and a code or
 * description is `strong`: almost surely a line's first row. Other rows of
 * type are `weak`: a line whose quantity or code the OCR missed, or wrapped
 * text. Column headings and stray marks are neither. */
type RowStart = {
  top: number;
  y: number;
  strong: boolean;
  weak: boolean;
  /** A row of type the OCR made nothing of, with as much ink in the
   * quantity columns as a line's first row has. */
  unread?: boolean;
};

/** The cheapest in-order matching of lines to rows: each line's row index,
 * or null where no row is near enough. */
function align(lines: number[], rows: RowStart[]) {
  // cost[i][j]: the cheapest way to place the first i lines on the first j
  // rows; step says which move got there.
  const n = lines.length,
    m = rows.length;
  const cost = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(Infinity),
  );
  const step = Array.from({ length: n + 1 }, () =>
    new Array<"miss" | "skip" | "match">(m + 1).fill("miss"),
  );
  cost[0]![0] = 0;
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= m; j++) {
      const options: Array<[number, "miss" | "skip" | "match"]> = [];
      if (i) options.push([cost[i - 1]![j]! + MISS, "miss"]);
      if (j)
        options.push([
          cost[i]![j - 1]! + (rows[j - 1]!.strong ? SKIP : 0),
          "skip",
        ]);
      const row = rows[j - 1];
      if (i && row && (row.strong || row.weak)) {
        const d = Math.abs(row.y - lines[i - 1]!);
        if (d <= NEAR)
          options.push([
            cost[i - 1]![j - 1]! + d + (row.strong ? 0 : WEAK),
            "match",
          ]);
      }
      for (const [c, s] of options)
        if (c < cost[i]![j]!) {
          cost[i]![j] = c;
          step[i]![j] = s;
        }
    }
  const matched = new Array<number | null>(n).fill(null);
  for (let i = n, j = m; i || j; ) {
    const s = step[i]![j]!;
    if (s === "match") matched[--i] = --j;
    else if (s === "miss") i--;
    else j--;
  }
  return { cost: cost[n]![m]!, matched };
}

/** The quantity columns, widened for numbers printed off their heading. */
const columnSpans = (columns: QuantityColumns) =>
  Object.values(columns).map((c) => {
    const w = c.right - c.left;
    return { left: c.left - w * 0.35, right: c.right + w * 0.35 };
  });

/** The rows of type in the part of a page where Jev found lines. */
export function pageInk(png: Buffer, found: Edges[], columns: QuantityColumns) {
  const spans = columnSpans(columns);
  return inkRows(
    png,
    {
      top: found[0]!.top - 0.04,
      bottom: found.at(-1)!.bottom + 0.04,
      left: Math.min(...found.map((b) => b.left), ...spans.map((s) => s.left)),
      right: Math.max(
        ...found.map((b) => b.right),
        ...spans.map((s) => s.right),
      ),
    },
    spans,
  );
}

/** The rows, kept in order, nearest where each of `want` should start. */
function closest<T extends { y: number }>(want: number[], rows: T[]) {
  // cost[i][j]: placing the first i on the first j rows.
  const cost = want.map(() => new Array<number>(rows.length + 1).fill(0));
  const at = (i: number, j: number): number =>
    i < 0 ? 0 : j < i + 1 ? Infinity : cost[i]![j]!;
  want.forEach((w, i) => {
    for (let j = 0; j <= rows.length; j++)
      cost[i]![j] =
        j < i + 1
          ? Infinity
          : Math.min(
              at(i, j - 1),
              at(i - 1, j - 1) + Math.abs(rows[j - 1]!.y - w),
            );
  });
  const out: T[] = [];
  for (let i = want.length - 1, j = rows.length; i >= 0; j--)
    if (at(i, j) !== at(i, j - 1) || j === i + 1) {
      out.unshift(rows[j - 1]!);
      i--;
    }
  return out;
}

/** The OCR's rows and the rows of type in the ink, top to bottom, as places
 * a line might start. */
export function rowStarts(
  rows: SlipRow[],
  columns: QuantityColumns,
  ink: InkRow[] = [],
) {
  const spans = columnSpans(columns);
  const inColumns = (w: SlipRow["words"][number]) => {
    const x = w.x + w.width / 2;
    return spans.some((s) => x >= s.left && x <= s.right);
  };
  // Part of a code or description, not just a tick or a number.
  const describes = (w: SlipRow["words"][number]) =>
    w.text.replace(/[^a-z0-9]/gi, "").length >= 3 && !inColumns(w);
  // A row the OCR split in two is still one row.
  const groups: Array<SlipRow["words"]> = [];
  let groupY = -1;
  for (const r of rows
    .filter((r) => r.words.length)
    .map((r) => ({ r, y: median(r.words.map((w) => w.y))! }))
    .sort((a, b) => a.y - b.y)) {
    if (groups.length && r.y - groupY < 0.004)
      groups.at(-1)!.push(...r.r.words);
    else groups.push([...r.r.words]);
    groupY = r.y;
  }
  const read = groups.map((group) => {
    const words = group
      .map((w) => w.text.replace(/[^a-z0-9/]/gi, ""))
      .filter((w) => w.length);
    const headings = words.filter((w) => headingWord(w)).length;
    const described = group.filter(describes);
    return {
      top: Math.min(...group.map((w) => w.y)),
      y: median(group.map((w) => w.y))!,
      heading: headings >= 2 && headings * 2 >= words.length,
      quantity:
        !spans.length ||
        group.some((w) => quantityLike(w.text) && inColumns(w)),
      described: described.length > 0,
      // Where its code or description starts.
      left: Math.min(...described.map((w) => w.x)),
      numbered: group.some((w) => /\d/.test(w.text) && inColumns(w)),
    };
  });
  // The ink places rows more exactly, and shows those the OCR could not
  // read. Each row of ink is paired, in order, with the OCR's row nearest
  // it, if one is near enough.
  const n = read.length,
    m = ink.length;
  // cost[i][j]: the cheapest pairing of the first i OCR rows with the first
  // j rows of ink, where a row left unpaired costs half the reach.
  const cost = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  const step = Array.from({ length: n + 1 }, () =>
    new Array<"pair" | "read" | "ink">(m + 1).fill("ink"),
  );
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= m; j++) {
      if (!i && !j) continue;
      const options: Array<[number, "pair" | "read" | "ink"]> = [];
      if (i) options.push([cost[i - 1]![j]! + PAIR / 2, "read"]);
      if (j) options.push([cost[i]![j - 1]! + PAIR / 2, "ink"]);
      if (i && j) {
        const d = Math.abs(read[i - 1]!.y - ink[j - 1]!.y);
        if (d <= PAIR) options.push([cost[i - 1]![j - 1]! + d, "pair"]);
      }
      [cost[i]![j], step[i]![j]] = options.reduce((a, b) =>
        b[0] < a[0] ? b : a,
      );
    }
  const partner = new Array<InkRow | undefined>(n);
  const alone: InkRow[] = [];
  for (let i = n, j = m; i || j; ) {
    const s = step[i]![j]!;
    if (s === "pair") partner[--i] = ink[--j];
    else if (s === "read") i--;
    else alone.push(ink[--j]!);
  }
  // Lines' codes start about here. Wrapped descriptions and notes start
  // further right, with no number and little ink in the quantity columns.
  const lefts = read
    .filter((r) => r.numbered && r.described && !r.heading)
    .map((r) => r.left)
    .sort((a, b) => a - b);
  const lineLeft = lefts[Math.floor(lefts.length * 0.25)] ?? Infinity;
  const starts: RowStart[] = read.map((r, i) => {
    const p = partner[i];
    const wrapped =
      r.described &&
      r.left > lineLeft + INDENT &&
      !r.numbered &&
      (!p || p.quantity < LINE_INK);
    const y = p ? p.y : r.y;
    const strong =
      !r.heading &&
      r.described &&
      (r.quantity || (p?.quantity ?? 0) >= INKED) &&
      !wrapped;
    return {
      top: Math.min(r.top, y),
      y,
      strong,
      // Where the ink shows type, a row the OCR read little of is still one.
      weak: !r.heading && !strong && (r.described || !!p),
    };
  });
  // A row of type the OCR made nothing of may start a line.
  for (const r of alone)
    starts.push({
      top: r.y,
      y: r.y,
      strong: false,
      weak: true,
      unread: r.quantity >= LINE_INK,
    });
  return starts.sort((a, b) => a.y - b.y);
}

/** Where each line Jev located starts and ends. Where the rows sure to start
 * lines are as many as Jev's lines, a row apart and spanning them, those rows
 * are the lines; `extra` allows one more, as when the slip's printed line
 * count says Jev missed one. Otherwise Jev's lines are matched to the rows
 * all at once, in order, and every line Jev found keeps a band: one no row
 * matched goes where a row with a quantity was left over, or else is spaced
 * between its neighbours. */
export function locatedBands(
  found: Edges[],
  rows: SlipRow[],
  columns: QuantityColumns,
  ink: InkRow[] = [],
  extra = 0,
) {
  const starts = rowStarts(rows, columns, ink);
  const tops = found.map((b) => b.top);
  const near = starts.filter(
    (r) => r.y >= tops[0]! - 0.01 - NEAR && r.y <= tops.at(-1)! + 0.02 + NEAR,
  );
  // Jev's lines are off by about the same amount down the page; which amount
  // is found by trying each.
  let best = { cost: Infinity, shift: 0, matched: [] as Array<number | null> };
  for (let k = -10; k <= 20; k++) {
    const shift = k / 1000,
      a = align(
        tops.map((t) => t + shift),
        near,
      );
    const cost = a.cost + Math.abs(shift - HIGH) * 0.1;
    if (cost < best.cost) best = { ...a, cost, shift };
  }
  const { shift, matched } = best;
  const lines = tops.map((t) => t + shift);
  const strongRows = near.filter((r) => r.strong).map((r) => r.y);
  const gaps = (ys: number[]) =>
    ys
      .slice(1)
      .map((y, k) => y - ys[k]!)
      .filter((g) => g > 0.004);
  const pitch = Math.min(
    0.04,
    Math.max(
      0.01,
      (strongRows.length >= 3 ? median(gaps(strongRows)) : undefined) ??
        median(gaps(lines)) ??
        0.02,
    ),
  );
  const space = pitch * 0.6;
  const end = Math.max(...found.map((b) => b.bottom)) + shift;

  type Placed = { y: number; top: number; precise: boolean };
  // The page's rows of type, wrapped text and all, are this far apart.
  const rowGap =
    0.6 *
    Math.min(0.04, Math.max(0.01, median(gaps(near.map((r) => r.y))) ?? pitch));
  const fits = (count: number) =>
    count === tops.length || (count === tops.length + 1 && extra > 0);
  let sure = near.filter((r) => r.strong);
  // Rows of type with quantities the OCR could not read, between rows it
  // could, fill out the count.
  if (sure.length >= 2 && sure.length < tops.length) {
    const more = near.filter(
      (r) =>
        r.unread &&
        r.y > sure[0]!.y &&
        r.y < sure.at(-1)!.y &&
        sure.every((s) => Math.abs(s.y - r.y) >= rowGap),
    );
    const all = [...sure, ...more].sort((a, b) => a.y - b.y);
    if (fits(all.length)) sure = all;
  }
  // Jev's first and last lines sit no more than a hair below where those
  // rows start, and not far above.
  const starting = (d: number) => d >= -0.005 && d <= 0.04;
  if (
    fits(sure.length) &&
    starting(sure[0]!.y - tops[0]!) &&
    starting(sure.at(-1)!.y - tops.at(-1)!) &&
    sure.every((r, k) => !k || r.y - sure[k - 1]!.y >= rowGap)
  )
    return finish(
      sure.map(({ y, top }) => ({ y, top, precise: true })),
      pitch,
      end,
    );
  const anchors = matched.flatMap((j, k) =>
    j === null ? [] : [{ k, ...near[j]! }],
  );
  const free = near.filter((r, j) => r.strong && !matched.includes(j));
  const placed: Placed[] = anchors.map(({ y, top }) => ({
    y,
    top,
    precise: true,
  }));
  for (let g = 0; g <= anchors.length; g++) {
    const a = anchors[g - 1],
      b = anchors[g];
    // The lines Jev found between these two matched ones.
    const from = a ? a.k + 1 : 0,
      to = b ? b.k : lines.length;
    const lo = a ? a.y + space : -Infinity,
      hi = b ? b.y - space : Infinity;
    // Rows with a quantity no line claimed: lines Jev placed badly, or
    // missed; any well clear of their neighbours start lines.
    let kept: RowStart[] = [];
    for (const r of free)
      if (
        r.y >= Math.max(lo, (lines[from] ?? lines.at(-1)!) - NEAR - pitch) &&
        r.y <= Math.min(hi, end) &&
        r.y - (kept.at(-1)?.y ?? -1) >= space
      )
        kept.push(r);
    if (kept.length > to - from) kept = closest(lines.slice(from, to), kept);
    placed.push(...kept.map(({ y, top }) => ({ y, top, precise: true })));
    const rest = to - from - kept.length;
    if (rest <= 0) continue;
    if (a && b) {
      // Each of the rest into the widest space left.
      const fixed = [a.y, ...kept.map((r) => r.y), b.y],
        count = new Array<number>(fixed.length - 1).fill(0);
      const width = (s: number) =>
        (fixed[s + 1]! - fixed[s]!) / (count[s]! + 1);
      for (let n = 0; n < rest; n++)
        count[count.reduce((x, _, s) => (width(s) > width(x) ? s : x), 0)]!++;
      count.forEach((c, s) => {
        for (let t = 1; t <= c; t++) {
          const y = fixed[s]! + ((fixed[s + 1]! - fixed[s]!) * t) / (c + 1);
          placed.push({ y, top: y, precise: false });
        }
      });
    } else {
      // Before the first matched line or after the last: where Jev put the
      // rest, as far off as the nearest matched line, kept in order and
      // apart; or, with nothing matched, where Jev put them.
      const ref = a ?? b,
        off = ref ? ref.y - lines[ref.k]! : 0;
      const ys = lines.slice(from, to).map((y) => y + off);
      const taken = kept.map((r) => r.y);
      const out: number[] = [];
      if (b)
        for (let k = ys.length - 1, limit = b.y; k >= 0; k--) {
          let y = Math.min(ys[k]!, limit - space);
          while (taken.some((t) => Math.abs(t - y) < space)) y -= space;
          out.push(y);
          limit = y;
        }
      else
        for (let k = 0, limit = a ? a.y : -Infinity; k < ys.length; k++) {
          let y = Math.max(ys[k]!, limit + space);
          while (taken.some((t) => Math.abs(t - y) < space)) y += space;
          out.push(y);
          limit = y;
        }
      // Rows with a quantity already stand for some of them.
      out
        .sort((x, y) => (b ? y - x : x - y))
        .slice(0, rest)
        .forEach((y) => placed.push({ y, top: y, precise: false }));
    }
  }
  placed.sort((x, y) => x.y - y.y);
  return finish(placed, pitch, end);
}

function finish(
  placed: Array<{ y: number; top: number; precise: boolean }>,
  pitch: number,
  end: number,
) {
  // A tick reaches up into its line's crop, but not past the line before.
  const starting = placed.map(
    (p, k) =>
      Math.min(
        p.y,
        Math.max(
          p.top,
          p.y - 0.4 * pitch,
          (placed[k - 1]?.y ?? -1) + 0.6 * pitch,
        ),
      ) - 0.002,
  );
  // Jev often runs a line's box into the next line: each line ends where
  // the next starts, wrapped text included.
  return placed.map((p, k) => ({
    top: starting[k]!,
    bottom: starting[k + 1] ?? Math.min(1, Math.max(end, p.y + pitch)),
    precise: p.precise,
  }));
}

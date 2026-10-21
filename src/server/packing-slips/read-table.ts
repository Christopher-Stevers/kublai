/** Reads the item table of a packing slip from positioned text: finds the
 * column header (single- or two-line), derives column zones, splits each row
 * into cells, joins wrapped descriptions and skips addresses, notes and
 * totals. Pages without a header reuse the previous page's columns. */
import type { SlipRow, SlipWord } from "./ocr-rows";

export type SlipField =
  | "ordered"
  | "previous"
  | "shipped"
  | "backordered"
  | "qty"
  | "sku"
  | "description"
  | "unit"
  | "price"
  | "line"
  | "ignore";
export type Box = { x: number; y: number; width: number; height: number };
export type SlipColumn = {
  field: SlipField;
  label: string;
  left: number;
  right: number;
};
export type SlipLayout = { page: number; columns: SlipColumn[]; header: Box };
export type TableLine = {
  page: number;
  box: Box;
  text: string;
  cells: Partial<Record<SlipField, SlipWord[]>>;
  /** Wrapped description and note rows that belong to this line. */
  extra: string[];
  /** The item row itself, before continuation rows were attached. */
  row: SlipRow;
  /** Column zones of the layout this line was read with. */
  layout: SlipLayout;
};

const LABELS: Record<string, SlipField> = {};
for (const [field, phrases] of Object.entries({
  ordered: [
    "qty ord",
    "qty ordered",
    "quantity ordered",
    "ordered qty",
    "order qty",
    "ord qty",
    "qty order",
    "ordered",
    "ord",
    "orig ord",
    "qty req",
    "requested",
    "qty requested",
  ],
  previous: [
    "prev ship",
    "prev shipped",
    "previously shipped",
    "prev",
    "previous",
    "shipped to date",
    "prior ship",
    "prior",
    "total shipped",
  ],
  shipped: [
    "qty shp",
    "qty shipped",
    "quantity shipped",
    "shipped qty",
    "ship qty",
    "qty ship",
    "shp qty",
    "shipped",
    "ship",
    "shp",
    "delivered",
    "qty delivered",
    "del qty",
    "supplied",
    "qty supplied",
    "picked",
    "qty picked",
    "this ship",
    "qty sent",
    "sent",
  ],
  backordered: [
    "qty b/o",
    "b/o qty",
    "b/o",
    "bo",
    "qty bo",
    "bo qty",
    "b.o",
    "b/ord",
    "back order",
    "back ordered",
    "backorder",
    "backordered",
    "back ord",
    "qty backordered",
    "bal",
    "balance",
    "bal due",
    "balance due",
    "remaining",
    "to follow",
    "outstanding",
  ],
  qty: ["qty", "quantity", "qnty", "qty shipped/delivered"],
  sku: [
    "product code",
    "item code",
    "item #",
    "item no",
    "item number",
    "part #",
    "part no",
    "part number",
    "product #",
    "product no",
    "prod code",
    "prod #",
    "sku",
    "code",
    "catalog #",
    "catalogue #",
    "cat #",
    "cat no",
    "mfr #",
    "stock code",
    "stock #",
    "product",
    "item",
    "part",
    "article",
    "material",
  ],
  description: [
    "description",
    "desc",
    "product description",
    "item description",
    "details",
    "description of goods",
  ],
  unit: ["unit", "uom", "u/m", "um", "u m", "unit of measure", "units"],
  price: [
    "unit price",
    "price",
    "net price",
    "net",
    "list",
    "list price",
    "price each",
    "disc",
    "discount",
    "amount",
    "ext",
    "ext price",
    "extension",
    "ext amt",
    "total",
    "line total",
    "value",
  ],
  line: ["ln", "line", "line #", "#", "no", "seq"],
  ignore: ["weight", "wt", "loc", "location", "bin", "lot", "tax", "tag"],
}))
  for (const phrase of phrases) LABELS[phrase] = field as SlipField;

export const QUANTITY: SlipField[] = [
  "ordered",
  "previous",
  "shipped",
  "backordered",
  "qty",
];
const TEXT: SlipField[] = ["sku", "description"];
const STOP =
  /^(?:sub-?total|total\b|received by|receiver|signature|thank you|terms\b|all claims|claims\b|freight\b|carrier\b|continued on)|\b(?:sub-?total|total (?:qty|quantity|lines|items|weight|shipped|pieces|pcs)|received by|signature|thank you|page \d+ of \d+)\b/i;
const HEADER_BLOCK =
  /\b(?:ship(?:ped)? to|sold to|bill to|ship via|page \d+ of|order (?:no|#|number)|customer po|p\.?o\.? ?(?:no|#)|ship date|invoice|continued)\b/i;
const NOTE = /^\s*(?:\*|note\b|notes\b|comment)/i;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[:.]+$/, "")
    .replace(/^[(]|[)]$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    // Common OCR misreads of header words: B/O as BIO or 8/0, Qty as Oty.
    .replace(/(^| )[b8][/|il1\\]?[o0](?= |$)/g, "$1b/o")
    .replace(/(^| )[aoq0]t[yv](?= |$)/g, "$1qty")
    .replace(/(^| )[o0]?[o0]rd(?= |$)/g, "$1ord");

/** PDF text runs often hold several words; give each its own box. */
export function splitWords(row: SlipRow): SlipWord[] {
  return row.words.flatMap((w) => {
    const parts = [...w.text.matchAll(/\S+/g)];
    if (parts.length <= 1) return [{ ...w, text: w.text.trim() }];
    const per = w.width / Math.max(1, w.text.length);
    return parts.map((m) => ({
      ...w,
      text: m[0],
      x: w.x + m.index * per,
      width: m[0].length * per,
    }));
  });
}

const center = (w: { x: number; width: number }) => w.x + w.width / 2;
const bottom = (r: SlipRow) => Math.max(...r.words.map((w) => w.y + w.height));
const top = (r: SlipRow) => Math.min(...r.words.map((w) => w.y));
const lineHeight = (r: SlipRow) =>
  r.words.reduce((s, w) => s + w.height, 0) / Math.max(1, r.words.length);

type Cell = { text: string; left: number; right: number; words: SlipWord[] };
/** Header words, with a second header line stacked onto the words above it. */
function headerCells(row: SlipWord[], below?: SlipWord[]): Cell[] {
  const cells: Cell[] = row.map((w) => ({
    text: w.text,
    left: w.x,
    right: w.x + w.width,
    words: [w],
  }));
  for (const w of below ?? []) {
    const c = center(w);
    const over = cells.find(
      (cell) =>
        cell.words.length === 1 &&
        c > cell.left - 0.012 &&
        c < cell.right + 0.012,
    );
    if (over) {
      over.text += ` ${w.text}`;
      over.left = Math.min(over.left, w.x);
      over.right = Math.max(over.right, w.x + w.width);
      over.words.push(w);
    } else
      cells.push({ text: w.text, left: w.x, right: w.x + w.width, words: [w] });
  }
  return cells.sort((a, b) => a.left - b.left);
}

function labelCells(cells: Cell[]) {
  const columns: SlipColumn[] = [];
  let unknown = 0;
  for (let i = 0; i < cells.length; ) {
    let found = 0;
    for (let n = Math.min(4, cells.length - i); n >= 1 && !found; n--) {
      const group = cells.slice(i, i + n);
      if (group.some((c, k) => k && c.left - group[k - 1]!.right > 0.03))
        continue;
      const field = LABELS[norm(group.map((c) => c.text).join(" "))];
      if (field) {
        columns.push({
          field,
          label: group.map((c) => c.text).join(" "),
          left: group[0]!.left,
          right: group[n - 1]!.right,
        });
        found = n;
      }
    }
    if (!found) unknown++;
    i += found || 1;
  }
  return { columns, unknown };
}

function scoreHeader(columns: SlipColumn[], unknown: number) {
  const fields = new Set(columns.map((c) => c.field));
  const quantities = QUANTITY.filter((f) => fields.has(f)).length;
  const text = fields.has("description") || fields.has("sku");
  if (!quantities || !text) return 0;
  if (columns.length < 3 && !(fields.has("description") && unknown <= 1))
    return 0;
  if (unknown > columns.length) return 0;
  // Two columns read as the same quantity means part of a header was missed.
  const repeats =
    columns.filter((c) => QUANTITY.includes(c.field)).length - quantities;
  return columns.length * 2 - unknown - repeats * 2;
}

/** When there is both an item/product column and a description column,
 * "item" means the code; alone, it is the description. */
function settle(columns: SlipColumn[]) {
  const descriptions = columns.filter((c) => c.field === "description");
  const skus = columns.filter((c) => c.field === "sku");
  if (!descriptions.length && skus.length) {
    const widest = skus.find((c) =>
      /item|product|material|article/i.test(c.label),
    );
    if (widest) widest.field = "description";
  }
  // Shipped + generic qty: the generic column is usually shipped too, unless
  // a shipped column exists, in which case "qty" is the ordered amount.
  const has = (f: SlipField) => columns.some((c) => c.field === f);
  for (const c of columns)
    if (c.field === "qty" && has("shipped") && !has("ordered"))
      c.field = "ordered";
  return columns.sort((a, b) => a.left - b.left);
}

export function findLayout(rows: SlipRow[], page: number) {
  let best: {
    layout: SlipLayout;
    score: number;
    index: number;
    span: number;
  } | null = null;
  rows.forEach((row, index) => {
    const words = splitWords(row);
    if (words.length > 24) return;
    const next = rows[index + 1];
    const options: Array<[Cell[], number]> = [[headerCells(words), 1]];
    if (
      next &&
      top(next) - bottom(row) < lineHeight(row) * 1.5 &&
      splitWords(next).length <= 24
    )
      options.push([headerCells(words, splitWords(next)), 2]);
    for (const [cells, span] of options) {
      const { columns, unknown } = labelCells(cells);
      const base = scoreHeader(columns, unknown);
      const score = base && base + (span === 2 ? 0.5 : 0);
      if (score > (best?.score ?? 0)) {
        const all = cells.flatMap((c) => c.words);
        const x = Math.min(...all.map((w) => w.x)),
          y = Math.min(...all.map((w) => w.y));
        best = {
          score,
          index,
          span,
          layout: {
            page,
            columns: settle(columns),
            header: {
              x,
              y,
              width: Math.max(...all.map((w) => w.x + w.width)) - x,
              height: Math.max(...all.map((w) => w.y + w.height)) - y,
            },
          },
        };
      }
    }
  });
  return best as {
    layout: SlipLayout;
    score: number;
    index: number;
    span: number;
  } | null;
}

/** Quantity columns that cannot be told apart: never prefill from them. */
export function unclearColumns(layout: SlipLayout) {
  const fields = layout.columns
    .map((c) => c.field)
    .filter((f) => QUANTITY.includes(f));
  return new Set(fields).size !== fields.length;
}

/** Column zone boundaries: text columns own the gap to their right. */
export function zones(columns: SlipColumn[]) {
  return columns.map((c, i) => {
    const prev = columns[i - 1],
      next = columns[i + 1];
    const textual = (x?: SlipColumn) => !!x && TEXT.includes(x.field);
    const left = !prev
      ? -1
      : textual(prev)
        ? c.left - 0.01
        : textual(c)
          ? (prev.right + c.left) / 2
          : (prev.right + c.left) / 2;
    const right = !next
      ? 2
      : textual(c)
        ? next.left - 0.01
        : textual(next)
          ? (c.right + next.left) / 2
          : (c.right + next.left) / 2;
    return { column: c, left, right };
  });
}

export function cellsFor(words: SlipWord[], columns: SlipColumn[]) {
  const z = zones(columns);
  const cells: Partial<Record<SlipField, SlipWord[]>> = {};
  if (!z.length) return cells;
  for (const w of words) {
    const c = center(w);
    const zone =
      z.find((zone) => c >= zone.left && c < zone.right) ??
      z.reduce((a, b) =>
        Math.abs(
          center({ x: a.column.left, width: a.column.right - a.column.left }) -
            c,
        ) <
        Math.abs(
          center({ x: b.column.left, width: b.column.right - b.column.left }) -
            c,
        )
          ? a
          : b,
      );
    (cells[zone.column.field] ??= []).push(w);
  }
  return cells;
}

const NUMERIC = /^[\d.,lIO|oS-]*\d[\d.,lIO|oS]*(?:[a-z]{1,4})?$/i;
const hasQuantity = (cells: TableLine["cells"]) =>
  QUANTITY.some((f) =>
    cells[f]?.some((w) => NUMERIC.test(w.text) || /^[-–—]$/.test(w.text)),
  );

export function readSlipTable(rows: SlipRow[]) {
  const layouts: SlipLayout[] = [],
    lines: TableLine[] = [],
    unread: SlipRow[] = [];
  const pages = [...new Set(rows.map((r) => r.page))].sort((a, b) => a - b);
  let previous = null as SlipLayout | null;
  for (const page of pages) {
    const pageRows = rows
      .filter((r) => r.page === page && r.words.length)
      .sort((a, b) => top(a) - top(b));
    const found = findLayout(pageRows, page);
    let layout: SlipLayout | null = found?.layout ?? null,
      start = found ? found.index + found.span : 0;
    const before: SlipLayout | null = previous;
    if (!layout && before) {
      layout = { page, columns: before.columns, header: before.header };
      // Skip the repeated page heading (addresses, order numbers).
      start = 0;
      pageRows.forEach((r, i) => {
        if (top(r) < 0.45 && HEADER_BLOCK.test(r.text)) start = i + 1;
      });
    }
    if (!layout) {
      unread.push(...pageRows);
      continue;
    }
    layouts.push(layout);
    previous = layout;
    let current: TableLine | null = null;
    let lastBottom = layout.header.y + layout.header.height;
    for (const row of pageRows.slice(start)) {
      if (STOP.test(row.text.trim())) break;
      const again = findLayout([row], page);
      if (again && again.score >= (found?.score ?? 0) - 1) {
        layout = again.layout;
        current = null;
        continue;
      }
      const words = splitWords(row);
      const cells = cellsFor(words, layout.columns);
      const h = lineHeight(row);
      const gap = top(row) - lastBottom;
      lastBottom = bottom(row);
      // A code in the item column starts a new line even with blank quantities.
      const coded =
        layout.columns.some((c) => c.field === "sku") &&
        (cells.sku ?? []).some(
          (w) =>
            w.text.length >= 4 &&
            /\d/.test(w.text) &&
            /^[A-Z0-9][\w./-]*$/i.test(w.text),
        );
      // A number far right of the text sits in a column whose heading was
      // missed; such a row is an item, not a wrapped description.
      const stray = TEXT.some((f) =>
        (cells[f] ?? []).some(
          (w, i, all) =>
            i > 0 &&
            /^\d{1,6}$/.test(w.text) &&
            w.x - (all[i - 1]!.x + all[i - 1]!.width) > 0.12,
        ),
      );
      const textOnly = !hasQuantity(cells) && !coded && !stray;
      const x = Math.min(...words.map((w) => w.x)),
        y = top(row);
      const box = {
        x,
        y,
        width: Math.max(...words.map((w) => w.x + w.width)) - x,
        height: bottom(row) - y,
      };
      if (textOnly) {
        // Wrapped descriptions and notes under an item; anything far below
        // the table (signatures, footers) ends it.
        if (current && gap < h * 2.6) {
          if (!NOTE.test(row.text)) current.extra.push(row.text);
          const b = current.box,
            x2 = Math.max(b.x + b.width, box.x + box.width),
            y2 = Math.max(b.y + b.height, box.y + box.height);
          current.box = {
            x: Math.min(b.x, box.x),
            y: b.y,
            width: x2 - Math.min(b.x, box.x),
            height: y2 - b.y,
          };
        } else if (current && gap > h * 6) break;
        continue;
      }
      current = { page, box, text: row.text, cells, extra: [], row, layout };
      lines.push(current);
    }
  }
  return { layouts, lines, unread };
}

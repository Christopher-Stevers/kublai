/** Every reader that has produced a saved slip reading, including older ones
 * still found on stored reviews. */
export type SlipReader = "ocr" | "jev" | "terra" | "astra" | "liquid";
export const readerLabels: Record<SlipReader, string> = {
  ocr: "OCR only",
  jev: "Jev Image",
  terra: "Terra 6.1",
  astra: "Astra Max",
  liquid: "Liquid LFM3 direct",
};

export type ReceiptOrderItem = {
  jobPriceStatus?: string;
  id: string;
  description: string;
  sku: string | null;
  aliases: string[];
  ordered: number;
  originalOrdered?: number;
  returned?: number;
  credited?: number;
  received: number;
  verificationStatus: string;
  unit: string;
  piecesPerPack: number | null;
  individualUnit: string | null;
};
export type SlipLine = {
  /** Source readings kept distinct from calculated suggestions. */
  fieldEvidence?: Partial<
    Record<
      "ordered" | "shipped" | "backordered" | "unit" | "description",
      {
        kind: "printed" | "derived" | "unread" | "image";
        text?: string;
        confidence?: number;
      }
    >
  >;
  /** Uncalibrated evidence scores, retained separately from human decisions. */
  confidenceDetails?: {
    part: number;
    quantity: number;
    backordered?: number;
    basis: "provider_composite" | "model_estimate" | "ocr_and_rules";
    match?: number;
    overall?: number;
    reason?: string;
    productProbabilities?: Record<string, number>;
  };
  page: number;
  evidence: string;
  orderItemId: string | null;
  shipped: number | null;
  backordered: number | null;
  unit: string | null;
  proposed: number | null;
  /** Blocking: the quantity is not prefilled until someone checks these. */
  issues: string[];
  /** Slip line outline on its page, 0–1 of the page size. */
  box?: SlipBox;
  /** Ordered quantity as printed on the slip. */
  ordered?: number | null;
  sku?: string | null;
  description?: string;
  confidence?: "high" | "medium" | "low";
  /** Informational: backorders, assumed units, differences from the order. */
  notes?: string[];
  /** Likely order items when no unique match was made, best first. */
  candidates?: string[];
  source?: "table" | "assistant" | "vision" | "terra";
  /** Shipped was read clearly and agrees with the other columns. */
  quantityClear?: boolean;
  /** Terra was asked to check this row and read nothing anywhere near it. */
  terraFoundNothing?: boolean;
  /** Every reader that read this row, earliest first. */
  readings?: SlipReading[];
  /** Matched to an order item by the user at confirmation. */
  linked?: "user";
  /** Quantity handwritten on the line; offered to the user, never prefilled. */
  handwritten?: number;
};
export type SlipBox = { x: number; y: number; width: number; height: number };
/** One reader's view of a row, kept when a later reader replaces it. */
export type SlipReading = {
  reader: SlipReader;
  shipped: number | null;
  unit: string | null;
  orderItemId: string | null;
  /** Uncalibrated 0–1 estimates. */
  match: number | null;
  quantity: number | null;
};
export const slipReader = (l: SlipLine): SlipReading["reader"] =>
  l.source === "terra"
    ? "terra"
    : l.source === "vision" || l.source === "assistant"
      ? "jev"
      : "ocr";
export function slipReading(l: SlipLine): SlipReading {
  const c = l.confidenceDetails;
  return {
    reader: slipReader(l),
    shipped: l.shipped,
    unit: l.unit,
    orderItemId: l.orderItemId,
    match: c ? (c.match ?? c.part) : null,
    quantity: c ? c.quantity : null,
  };
}
export const lineReadings = (l: SlipLine) => l.readings ?? [slipReading(l)];
/**
 * The column headings to show above a line on `page`: that page's own, or,
 * where a table runs on without repeating them, the last page that printed
 * them.
 */
export function slipHeader(
  headers: SlipAnalysis["headers"],
  page: number,
): { page: number; box: SlipBox } | undefined {
  const h =
    headers?.find((x) => x.page === page) ??
    headers
      ?.filter((x) => x.page < page)
      .sort((a, b) => b.page - a.page)[0];
  return h && { page: h.printedOn ?? h.page, box: h.box };
}
export type SlipProgress = {
  stage: "extracting" | "matching" | "checking";
  message: string;
  completed?: number;
  total?: number;
  /** Provisional readings: never used to receive stock. */
  lines?: SlipLine[];
};
export type SlipActivity = {
  at: string;
  message: string;
  completed?: number;
  total?: number;
};
export type SlipAnalysis = {
  activity?: SlipActivity[];
  cascade?: {
    policy: string;
    status:
      | "not-needed"
      | "completed"
      | "unavailable"
      | "budget-limited"
      | "failed"
      | "interrupted";
    reasons: string[];
    lineIndexes: number[];
    model?: string;
    error?: string;
    estimatedUsd?: number | null;
    document?: {
      kind: "delivery" | "return" | "credit" | "other" | "unclear";
      supplierName: string | null;
      deliveryNumber: string | null;
      supplierOrderNumber: string | null;
      deliveryDate: string | null;
    };
  };
  orderCandidates?: string[];
  progress?: SlipProgress;
  runId: string;
  versionId: string;
  status: "processing" | "ready" | "failed" | "cleared";
  startedAt: string;
  completedAt?: string;
  error?: string;
  model?: string;
  readerVersion?: string;
  usage?: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    unknownCalls: number;
    estimatedUsd: number | null;
    pricingAsOf: string;
    pricingSource: string;
  };
  items: ReceiptOrderItem[];
  lines: SlipLine[];
  warnings: string[];
  /** Column header outline per page, shown above slip line images. */
  headers?: Array<{ page: number; box: SlipBox; printedOn?: number }>;
  /** What the slip looked like; remembered per supplier. */
  layout?: {
    footer: boolean;
    /** Where the quantity columns printed, across the page. */
    columns?: Partial<
      Record<
        "shipped" | "ordered" | "backordered",
        { left: number; right: number }
      >
    >;
  };
  /** The slip's printed line count or total shipped was read and agrees
   * with the lines read. */
  totalsAgree?: boolean;
  /** Original receipt items survive clearing or rerunning detection. */
  confirmedItems?: ReceiptOrderItem[];
  applied?: {
    at: string;
    by: string;
    quantities: Record<string, number>;
    links?: Record<string, string | null>;
  };
};
/** Issues about which order item a line is; settled once the user links it. */
export const MATCH_ISSUE =
  /^(?:Not on this order|Matches more than one order line|Check the product|Uncertain product match)/;
export function receiptUnit(unit: string | null | undefined) {
  const s = (unit ?? "").trim().toLowerCase().replace(/\.$/, "");
  const groups: Record<string, string> = {
    each: "ea",
    pcs: "ea",
    pc: "ea",
    piece: "ea",
    pieces: "ea",
    feet: "ft",
    foot: "ft",
    inches: "in",
    inch: "in",
    boxes: "box",
    bx: "box",
    packs: "pack",
    pk: "pack",
    coils: "coil",
    rolls: "roll",
    lengths: "length",
    lg: "length",
    len: "length",
    bags: "bag",
    bg: "bag",
    cl: "coil",
    rl: "roll",
    pkg: "pack",
    cs: "case",
    cases: "case",
    lf: "ft",
  };
  return groups[s] ?? s;
}
const BULK = new Set(["box", "pack", "bundle", "bdl", "bag", "case", "carton", "ctn", "coil", "roll", "length", "pail"]);
const PIECE = new Set(["ea", "ft", "in", "m"]);
const BULK_WORD =
  "box(?:es)?|bx|packs?|pkg|pk|bundles?|bdls?|bndl|bags?|bg|cases?|cs|cartons?|ctn|pails?|rolls?|rl|coils?";
const PACK_PATTERNS = [
  // 1000/BX, 100 PCS PER BOX, 250 FT/ROLL, (1000 pieces per box)
  new RegExp(String.raw`(\d[\d,]*)(?:\s*(?:pcs?|pieces?|ea|each|ft|feet))?(?:\/|\s+per\s+)(?:${BULK_WORD})\b`, "gi"),
  // BOX OF 1000, BX/100 (not "CS-150", a class)
  new RegExp(String.raw`\b(?:${BULK_WORD})\s*(?:of\s+|\/\s*)(\d[\d,]*)\b`, "gi"),
  // 100PK, 50 CT, 25-PACK
  /\b(\d[\d,]*)\s*-?\s*(?:pk|pack|ct|count)\b/gi,
];

/** Pack sizes a description states, such as "1000/BX" or "box of 100". */
export function packSizesIn(text: string | null | undefined) {
  const sizes = new Set<number>();
  for (const pattern of PACK_PATTERNS)
    for (const match of (text ?? "").matchAll(pattern)) {
      const n = Number(match[1]!.replace(/,/g, ""));
      if (Number.isInteger(n) && n >= 2 && n <= 100000) sizes.add(n);
    }
  return [...sizes];
}

/** Pieces in one pack of the order item: its catalogue pack size, or the one
 * its descriptions, or the slip line, all state. */
export function orderPack(item: ReceiptOrderItem, slipText?: string | null) {
  if (item.piecesPerPack && item.piecesPerPack > 1) return item.piecesPerPack;
  const own = new Set([item.description, ...item.aliases].flatMap(packSizesIn));
  const sizes = own.size ? own : new Set(packSizesIn(slipText));
  return sizes.size === 1 ? [...sizes][0]! : null;
}

export type SlipQuantity = {
  /** In the order's unit. */
  amount: number;
  /** How a slip count that could be packs or pieces was read. */
  note?: string;
};

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * A slip quantity in the order's unit. Where the slip could be counting packs
 * or the pieces in them (1000 EA against 1 box of 1000), the reading that fits
 * what was ordered or is still due wins; null where both or neither fit.
 */
export function readSlipQuantity(
  quantity: number,
  unit: string | null,
  item: ReceiptOrderItem,
  slipText?: string | null,
): SlipQuantity | null {
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > 999999)
    return null;
  const from = receiptUnit(unit),
    to = receiptUnit(item.unit);
  if (!from || !to) return null;
  const catalogued = !!item.piecesPerPack && item.piecesPerPack > 1;
  const pack = orderPack(item, slipText);
  const individual = receiptUnit(item.individualUnit);
  if (from === to && (catalogued || !pack || !PIECE.has(to))) return { amount: quantity };
  // EA may name the pack itself; a printed "pcs" or "ft" cannot.
  const each = ["ea", "each"].includes((unit ?? "").trim().toLowerCase().replace(/\.$/, ""));
  if (catalogued && from === individual && !each)
    return { amount: round6(quantity / pack!) };
  if (!pack) {
    // "2 EA" of a coil, roll or bag sold whole is two of them.
    if (from === "ea" && ["coil", "roll", "length", "bag", "case", "box", "pack"].includes(to))
      return { amount: quantity };
    return null;
  }
  // Counted as packs or as pieces; the order decides which.
  const asPieces = PIECE.has(from) || from === individual;
  const orderInPacks = catalogued || BULK.has(to);
  if (!asPieces && !BULK.has(from)) return null;
  const readings: Array<SlipQuantity & { pieces: boolean }> = [];
  if (orderInPacks) {
    if (asPieces) readings.push({ amount: round6(quantity / pack), pieces: true });
    // A supplier's EA, or its own name for the pack, may count whole packs.
    if (each || BULK.has(from)) readings.push({ amount: quantity, pieces: false });
  } else {
    // The order's EA may be pieces or whole packs, and so may the slip's.
    readings.push({ amount: quantity, pieces: false });
    readings.push({
      amount: asPieces ? round6(quantity / pack) : quantity * pack,
      pieces: asPieces,
    });
  }
  const due = [item.ordered, round6(item.ordered - item.received)];
  const exact = readings.filter((r) => due.some((d) => Math.abs(r.amount - d) < 1e-6));
  const near = readings.filter(
    (r) => Number.isInteger(r.amount) && r.amount > 0 && r.amount <= Math.max(item.ordered, 1) * 1.5,
  );
  const pick = exact.length === 1 ? exact[0] : !exact.length && near.length === 1 ? near[0] : undefined;
  if (!pick) return null;
  const shown = `${quantity} ${unit}`;
  if (orderInPacks)
    return {
      amount: pick.amount,
      note: pick.pieces
        ? `Slip counts pieces: ${shown} = ${pick.amount} ${item.unit} (${pack} per ${item.unit}).`
        : `Slip's ${shown} counts whole ${item.unit}, not pieces.`,
    };
  return {
    amount: pick.amount,
    note:
      pick.amount === quantity
        ? `Read ${shown} as ${pick.amount} ${item.unit}, as ordered.`
        : `Read ${shown} as ${pick.amount} ${item.unit} (${pack} per pack), as ordered.`,
  };
}

export function convertSlipQuantity(
  quantity: number,
  unit: string | null,
  item: ReceiptOrderItem,
  slipText?: string | null,
) {
  return readSlipQuantity(quantity, unit, item, slipText)?.amount ?? null;
}
export function proposedReceipts(analysis: SlipAnalysis) {
  const amounts: Record<string, number> = {};
  for (const line of analysis.lines)
    if (line.orderItemId && line.proposed !== null)
      amounts[line.orderItemId] =
        Math.round(((amounts[line.orderItemId] ?? 0) + line.proposed) * 1e6) /
        1e6;
  return amounts;
}
export function receiptIssues(
  item: ReceiptOrderItem,
  quantity: number | undefined,
) {
  if (quantity === undefined)
    return ["Not confidently identified on this slip."];
  const total = item.received + quantity;
  if (total > item.ordered + 1e-6)
    return [
      `Exceeds order by ${Math.round((total - item.ordered) * 1e6) / 1e6} ${item.unit}.`,
    ];
  if (total < item.ordered - 1e-6)
    return [
      `${Math.round((item.ordered - total) * 1e6) / 1e6} ${item.unit} would still be outstanding.`,
    ];
  return [];
}

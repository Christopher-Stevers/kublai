/** When a reviewer confirms a slip line that disagrees with its order part,
 * works out the part changes that would let the next slip match on its own:
 * a pack size where the supplier counts pieces, and the supplier's own code
 * and name for the part. */
import {
  packSizesIn,
  receiptUnit,
  type ReceiptOrderItem,
} from "./packing-slip-review";

/** The catalogue part behind an order item, and this supplier's listing. */
export type PartFacts = {
  imageUrl?: string | null;
  partId: string;
  name: string;
  bulkUnit: string | null;
  supplierSku: string | null;
  supplierName: string | null;
  /** Units the part is counted in on any order or material list. */
  units: string[];
};
/** What the receiving "line" action may change on the part. */
export type PartUpdate = {
  piecesPerPack?: number;
  individualUnit?: string;
  bulkUnit?: string;
  supplierSku?: string;
  supplierName?: string;
  alias?: string;
};
export type PartFit = {
  /** Why the slip and the order disagree. */
  reason: string;
  /** The line's quantity in the order's unit once read this way. */
  quantity: number;
  /** The quantity as read, when it is changed above. */
  read: number | null;
  rows: Array<{ label: string; before: string; after: string }>;
  update: PartUpdate;
  /** Why a pack size that would fit is left alone. */
  held?: string;
};
type Line = {
  quantity: number | null;
  /** The quantity first read from the slip, before any edit. */
  read?: number | null;
  unit: string;
  description: string;
  sku: string;
  evidence?: string;
};

const BULK = new Set([
  "box",
  "pack",
  "bundle",
  "bdl",
  "bag",
  "case",
  "carton",
  "ctn",
  "coil",
  "roll",
  "length",
  "pail",
]);
const PIECE = new Set(["ea", "ft", "in", "m"]);
const NOT_SET = "Not set";

/** Pack and length sizes a text states: "Box = 2500pcs", "1000/BX", "X 10FT". */
export function statedSizes(texts: Array<string | null | undefined>) {
  const found = new Map<number, string>();
  const add = (raw: string, unit: string) => {
    const n = Number(raw.replace(/,/g, ""));
    if (Number.isInteger(n) && n >= 2 && n <= 100000 && !found.has(n))
      found.set(n, unit);
  };
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(
      /(?<![\d/.-])(\d[\d,]*)\s*(?:pcs?|pieces?)\b/gi,
    ))
      add(m[1]!, "ea");
    for (const m of text.matchAll(
      /(?<![\d/.-])(\d+)\s*(?:ft|feet|foot|')(?![a-z])/gi,
    ))
      add(m[1]!, "ft");
    for (const n of packSizesIn(text))
      add(
        String(n),
        new RegExp(String.raw`\b${n}\s*(?:ft|feet)\b`, "i").test(text)
          ? "ft"
          : "ea",
      );
  }
  return [...found].map(([size, unit]) => ({ size, unit }));
}

const words = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const code = (s: string | null | undefined) =>
  (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** How many order units a slip count of pieces makes, by the part's stated
 * or implied pack size; null where the count is no clear multiple. */
function packReading(item: ReceiptOrderItem, line: Line, quantity: number) {
  const due = Math.max(0, round6(item.ordered - item.received)) || item.ordered;
  if (!(due > 0) || quantity <= Math.max(due, 1) * 1.5) return null;
  const orderUnit = receiptUnit(item.unit),
    slipUnit = receiptUnit(line.unit);
  const fits = (size: number) =>
    quantity % size === 0 && quantity / size <= Math.max(due, 1) * 1.5;
  const known =
    item.piecesPerPack && item.piecesPerPack > 1 ? item.piecesPerPack : null;
  if (known)
    return fits(known)
      ? {
          size: known,
          unit: item.individualUnit?.trim() ? item.individualUnit : "ea",
          known: true,
        }
      : null;
  const stated = statedSizes([
    item.description,
    ...(item.aliases ?? []),
    line.description,
    line.evidence,
  ]).filter((s) => fits(s.size));
  // A printed piece unit, such as FT against rods in EA, says it counts pieces.
  const pieces = !!slipUnit && slipUnit !== orderUnit && PIECE.has(slipUnit);
  const exact = stated.filter((s) =>
    [due, item.ordered].includes(quantity / s.size),
  );
  const pick =
    exact.length === 1
      ? exact[0]
      : !exact.length && pieces && stated.length === 1
        ? stated[0]
        : undefined;
  if (pick) return { ...pick, known: false };
  if (stated.length) return null;
  // No size written anywhere: a whole multiple of a box, or of a length
  // counted in feet, is still likely.
  const ratio = quantity / due;
  return Number.isInteger(ratio) &&
    ratio >= 2 &&
    (pieces || BULK.has(orderUnit))
    ? { size: ratio, unit: pieces ? slipUnit : "ea", known: false }
    : null;
}

/**
 * The part changes that would make a confirmed slip line match its order part
 * next time, or null where nothing needs asking. `byHand`: the reviewer chose
 * the order part, so the slip's own name and code are worth keeping too.
 */
export function partFit(
  item: ReceiptOrderItem,
  line: Line,
  facts: PartFacts | undefined,
  { byHand = false, canEdit = false } = {},
): PartFit | null {
  const quantity = line.quantity;
  if (quantity === null) return null;
  const due = Math.max(0, round6(item.ordered - item.received)) || item.ordered;
  // The count as it stands, or as first read when it was edited down to fit.
  const now = packReading(item, line, quantity);
  const before =
    !now && line.read != null && line.read !== quantity
      ? packReading(item, line, line.read)
      : null;
  // An edited count of a part that already has its pack size needs nothing.
  const earlier = before && !before.known ? before : null;
  const pack = now ?? earlier;
  const shown = now ? quantity : earlier ? line.read! : quantity;
  const rows: PartFit["rows"] = [],
    update: PartUpdate = {};
  let held: string | undefined;
  if (pack && !pack.known && canEdit && facts) {
    const other = facts.units.find(
      (u) => receiptUnit(u || "ea") !== receiptUnit(item.unit),
    );
    if (other)
      held = `Other orders or lists count this part in ${other}, so its pack size is left as it is.`;
    else {
      const piece =
        item.individualUnit &&
        receiptUnit(item.individualUnit) === receiptUnit(pack.unit)
          ? item.individualUnit
          : pack.unit;
      rows.push({
        label: "Pack size",
        before: NOT_SET,
        after: `${pack.size} ${piece} per ${item.unit}`,
      });
      update.piecesPerPack = pack.size;
      if (piece !== item.individualUnit) update.individualUnit = piece;
      if (receiptUnit(facts.bulkUnit) !== receiptUnit(item.unit)) {
        update.bulkUnit = item.unit;
        if (facts.bulkUnit)
          rows.push({
            label: "Pack unit",
            before: facts.bulkUnit,
            after: item.unit,
          });
      }
    }
  }
  if (canEdit && facts && (rows.length || byHand)) {
    const sku = line.sku.trim();
    if (
      sku &&
      !facts.supplierSku?.trim() &&
      code(sku) !== code(item.sku) &&
      code(sku).length >= 3
    ) {
      rows.push({ label: "Supplier code", before: NOT_SET, after: sku });
      update.supplierSku = sku.slice(0, 255);
    }
    const name = line.description.trim(),
      names = [
        item.description,
        facts.name,
        facts.supplierName,
        ...(item.aliases ?? []),
      ].map(words);
    if (name && words(name) && !names.includes(words(name))) {
      if (!facts.supplierName?.trim()) {
        rows.push({ label: "Supplier's name", before: NOT_SET, after: name });
        update.supplierName = name.slice(0, 700);
      } else {
        rows.push({ label: "Also called", before: "Not listed", after: name });
        update.alias = name.slice(0, 255);
      }
    }
  }
  if (!now && !rows.length) return null;
  const amount = now ? round6(quantity / pack!.size) : quantity;
  const reason = pack
    ? `The slip shows ${shown}${receiptUnit(line.unit) && receiptUnit(line.unit) !== receiptUnit(item.unit) ? ` ${line.unit}` : ""} where the order needs ${due} ${item.unit}. That is ${round6(shown / pack.size)} ${item.unit} of ${pack.size} ${pack.unit} each.`
    : "You matched this line by hand. Keeping the slip's code and name lets the next slip match on its own.";
  return {
    reason,
    quantity: amount,
    read: now ? quantity : null,
    rows,
    update,
    ...(held ? { held } : {}),
  };
}

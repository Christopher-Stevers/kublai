/** Recover source rows when a damaged heading defeats the table parser.
 * These are location/text candidates only: column meanings and quantities
 * stay unknown until an image reader or a person checks the source. */
import type { ReceiptOrderItem, SlipLine } from "~/lib/packing-slip-review";
import type { SlipRow } from "./ocr-rows";
import { splitWords } from "./read-table";
import { matchLines, skuScore } from "./match";

const NON_ITEM =
  /\b(?:tel|fax|phone|postal|invoice|order no|order #|ship to|sold to|bill to|way ?bill|total|pallet|carton|transfer from|printed|signature|customer|contact|picked by|branch number|job boxes)\b/i;
const ADDRESS =
  /^\s*\d{1,5}\s+(?:\S+\s+){0,3}(?:place|road|rd\.?|street|st\.?|drive|dr\.?|avenue|ave\.?)\b/i;
export function recoverProductRows(
  rows: SlipRow[],
  items: ReceiptOrderItem[],
): SlipLine[] {
  const candidates = rows.filter((row) => {
    if (NON_ITEM.test(row.text) || ADDRESS.test(row.text)) return false;
    const words = splitWords(row);
    if (words.length < 3 || !/[a-z]{3}/i.test(row.text)) return false;
    const exactCode = items.some(
      (i) =>
        i.sku &&
        i.sku.replace(/\W/g, "").length >= 4 &&
        skuScore(i, "", row.text) >= 0.99,
    );
    // A printed line index, product text and a separate numeric column.
    // Never promote sizes embedded in a description into a shipped count.
    const amounts = words.filter(
      (w, i) =>
        i > 1 &&
        /^-?\d+(?:[.,]\d+)?$/.test(w.text) &&
        w.x - (words[i - 1]!.x + words[i - 1]!.width) > 0.035,
    );
    const legible =
      words.filter((w) => /[a-z]{3}/i.test(w.text) && w.confidence >= 70)
        .length >= 2;
    const numbered = /^\s*[|\s]*\d{1,3}\s/.test(row.text) && amounts.length > 0;
    const coded =
      words.some((w) => /^(?=.*[a-z])(?=.*\d)[|\w./-]{5,}$/i.test(w.text)) &&
      amounts.length >= 2;
    return exactCode || (legible && (numbered || coded));
  });
  const matches = matchLines(
    items,
    candidates.map((row) => ({ code: "", text: row.text })),
  );
  return candidates.map((row, index) => {
    const x = Math.min(...row.words.map((w) => w.x)),
      y = Math.min(...row.words.map((w) => w.y));
    const match = matches[index]!;
    return {
      page: row.page,
      evidence: row.text,
      description: row.text,
      box: {
        x,
        y,
        width: Math.max(...row.words.map((w) => w.x + w.width)) - x,
        height: Math.max(...row.words.map((w) => w.y + w.height)) - y,
      },
      orderItemId: match.itemId,
      candidates: match.candidates,
      shipped: null,
      backordered: null,
      ordered: null,
      unit: null,
      proposed: null,
      quantityClear: false,
      source: "table",
      issues: [
        "Product row recovered from text; quantity columns could not be read. Check the source image.",
      ],
      confidenceDetails: {
        part: Math.min(...row.words.map((w) => w.confidence)) / 100,
        quantity: 0,
        match: match.itemId ? (match.confidence === "high" ? 0.95 : 0.5) : 0,
        basis: "ocr_and_rules",
        reason:
          "Row location and source text only. No quantity inferred from column position or the order.",
      },
    };
  });
}

import {
  convertSlipQuantity,
  orderPack,
  type ReceiptOrderItem,
  type SlipLine,
} from "~/lib/packing-slip-review";
import type { OrderMatchComparison } from "~/lib/order-match-comparison";
import { lineScorer, matchLines } from "./match";

/** Read-only alignment. Reuse saved detections; alternate orders use local matching only. */
export function comparisonRows(
  items: ReceiptOrderItem[],
  lines: SlipLine[],
): OrderMatchComparison["rows"] {
  const matches = matchLines(
    items,
    lines.map((line) => ({
      code: line.sku ?? "",
      text: `${line.description ?? ""} ${line.evidence}`,
    })),
  );
  const scoreLine = lineScorer(items);
  const seen = new Set<string>();
  const orderCell = (item: ReceiptOrderItem) => ({
    description: item.description,
    quantity: item.originalOrdered ?? item.ordered,
    unit: item.unit,
    piecesPerPack: orderPack(item),
  });
  // The slip's figure in the order's unit, where it counts something else
  // (1000 EA against 1 box of 1000).
  const inOrderUnit = (line: SlipLine, item: ReceiptOrderItem | undefined) => {
    if (!item || line.shipped === null) return null;
    const text = `${line.description ?? ""} ${line.evidence}`;
    // A bare count of a packed item may be packs or pieces; the order decides.
    const unit = line.unit ?? (orderPack(item, text) ? "ea" : item.unit);
    const amount = convertSlipQuantity(line.shipped, unit, item, text);
    return amount === null || amount === line.shipped ? null : amount;
  };
  const rows: OrderMatchComparison["rows"] = lines.map((line, index) => {
    const item =
      items.find((item) => item.id === line.orderItemId) ??
      (matches[index]?.confidence === "high"
        ? items.find((item) => item.id === matches[index]?.itemId)
        : undefined);
    if (item) seen.add(item.id);
    const score = item
      ? (scoreLine({
          code: line.sku ?? "",
          text: `${line.description ?? ""} ${line.evidence}`,
        }).find((candidate) => candidate.itemId === item.id)?.score ?? 0)
      : 0;
    return {
      matchScore: Math.round(Math.max(0, Math.min(1, score)) * 100),
      order: item ? orderCell(item) : null,
      slip: {
        description: line.description?.trim()
          ? line.description
          : line.evidence,
        quantity: line.shipped,
        unit: line.unit,
        inOrderUnit: inOrderUnit(line, item),
      },
    };
  });
  for (const item of items)
    if (!seen.has(item.id))
      rows.push({ matchScore: 0, order: orderCell(item), slip: null });
  return rows;
}

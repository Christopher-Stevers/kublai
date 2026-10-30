import type { ReceiptOrderItem, SlipLine } from "~/lib/packing-slip-review";
import type { OrderMatchComparison } from "~/lib/order-match-comparison";
import { matchLines } from "./match";

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
  const seen = new Set<string>();
  const orderCell = (item: ReceiptOrderItem) => ({
    description: item.description,
    quantity: item.originalOrdered ?? item.ordered,
    unit: item.unit,
    piecesPerPack: item.piecesPerPack,
  });
  const rows: OrderMatchComparison["rows"] = lines.map((line, index) => {
    const item =
      items.find((item) => item.id === line.orderItemId) ??
      (matches[index]?.confidence === "high"
        ? items.find((item) => item.id === matches[index]?.itemId)
        : undefined);
    if (item) seen.add(item.id);
    return {
      order: item ? orderCell(item) : null,
      slip: {
        description: line.description?.trim()
          ? line.description
          : line.evidence,
        quantity: line.shipped,
        unit: line.unit,
      },
    };
  });
  for (const item of items)
    if (!seen.has(item.id)) rows.push({ order: orderCell(item), slip: null });
  return rows;
}

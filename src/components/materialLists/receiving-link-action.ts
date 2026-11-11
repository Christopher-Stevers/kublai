import { readSlipQuantity } from "~/lib/packing-slip-review";
import { convertedOrderedQuantity } from "~/lib/receiving-review";
import type { ReceiptOrderItem } from "~/lib/packing-slip-review";
import type { ReceivingLine } from "~/lib/receiving-review";
import type { ReceivingAction } from "./ReceivingWorkspace";

export type ResolveTarget = {
  lineId?: string;
  itemId?: string;
  findOnSlip?: boolean;
};

/** Pairs a slip line with an order item, or unlinks it, counting it in the
 * item's unit. Linking approves nothing. Null when the units can't be
 * converted safely, so the reviewer confirms the count first. */
export function linkLineAction(
  l: ReceivingLine,
  orderItemId: string | null,
  items: ReceiptOrderItem[],
): ReceivingAction | null {
  const chosen = items.find((i) => i.id === orderItemId);
  const converted =
    chosen && l.quantity != null
      ? readSlipQuantity(l.quantity, l.unit, chosen)
      : null;
  if (chosen && l.quantity != null && !converted) return null;
  return {
    action: "line",
    lineId: l.id,
    kind: l.kind ?? null,
    description: l.description,
    sku: l.sku,
    quantity: converted?.amount ?? l.quantity,
    ordered: converted
      ? convertedOrderedQuantity(l.ordered, l.quantity, converted.amount)
      : l.ordered,
    unit: chosen?.unit ?? l.unit,
    unitPrice: l.unitPrice,
    orderItemId,
    checked: false,
  };
}

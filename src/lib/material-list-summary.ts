import { materialListProgress } from "./material-list-progress";
import { materialListOrderStatuses } from "./material-list-order-status";

type Item = Parameters<typeof materialListProgress>[0][number] & {
  quoteId: string | null;
  partDefinitionId: string | null;
  supplierId: string | null;
  supplierName?: string | null;
  sentOrderId: string | null;
};
type Order = Parameters<typeof materialListOrderStatuses>[1][number];
export type OrderVerification =
  Parameters<typeof materialListOrderStatuses>[2] extends ReadonlyMap<
    string,
    infer V
  >
    ? V & { verifiedItemCount: number }
    : never;

/** One summary for server responses and offline snapshots. Callers scope the data. */
export function createMaterialListSummaries(
  items: readonly Item[],
  orders: readonly Order[],
  verification: ReadonlyMap<string, OrderVerification>,
) {
  const byQuote = new Map<string, Item[]>();
  const byList = new Map<string, Order[]>();
  for (const item of items) {
    if (!item.quoteId) continue;
    const rows = byQuote.get(item.quoteId) ?? [];
    rows.push(item);
    byQuote.set(item.quoteId, rows);
  }
  for (const order of orders) {
    if (!order.materialListId) continue;
    const rows = byList.get(order.materialListId) ?? [];
    rows.push(order);
    byList.set(order.materialListId, rows);
  }
  return (list: {
    id: string;
    quoteId: string | null;
    kind?: string | null;
  }) => {
    const rows = byQuote.get(list.quoteId ?? "") ?? [];
    const listOrders = byList.get(list.id) ?? [];
    const parts = rows.filter((row) => !!row.partDefinitionId);
    const sent = new Set<string>(),
      verified = new Set<string>();
    for (const order of listOrders) {
      if (
        !order.supplierId ||
        order.status === "cancelled" ||
        !(
          order.sentAt ||
          ["sent", "confirmed", "received"].includes(order.status)
        )
      )
        continue;
      sent.add(order.supplierId);
      const counts = verification.get(order.id);
      if (
        counts &&
        counts.itemCount > 0 &&
        counts.verifiedItemCount === counts.itemCount
      )
        verified.add(order.supplierId);
    }
    return {
      overallProgress: materialListProgress(rows),
      orderStatuses: materialListOrderStatuses(
        list.id,
        listOrders,
        verification,
        parts
          .filter((row) => Number(row.quantity) > 0)
          .map((row) => ({
            sentOrderId: row.sentOrderId,
            supplierId: list.kind === "tools" ? "tool-room" : row.supplierId,
            supplierName:
              list.kind === "tools" ? "Tool Room" : row.supplierName,
          })),
      ),
      orderNumbers: [
        ...new Set(
          listOrders
            .filter((order) => order.status !== "cancelled")
            .map((order) => order.orderNumber?.trim())
            .filter((number): number is string => !!number),
        ),
      ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      totalSupplierCount:
        list.kind === "tools"
          ? Number(parts.length > 0)
          : new Set(parts.map((row) => row.supplierId).filter(Boolean)).size,
      sentSupplierCount: sent.size,
      verifiedSupplierCount: verified.size,
    };
  };
}

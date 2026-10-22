export type MaterialListOrderStatus = {
  id: string;
  number: string;
  complete: boolean;
  deliveredPercent: number;
};

export function materialListOrderStatuses(
  listId: string,
  orders: readonly {
    id: string;
    materialListId: string | null;
    orderNumber: string | null;
    status: string;
  }[],
  verification: ReadonlyMap<
    string,
    {
      itemCount: number;
      completeItemCount: number;
      orderedQuantity?: number;
      receivedQuantity?: number;
    }
  >,
): MaterialListOrderStatus[] {
  return orders
    .filter(
      (order) =>
        order.materialListId === listId &&
        order.status !== "cancelled" &&
        order.orderNumber?.trim(),
    )
    .map((order) => {
      const counts = verification.get(order.id);
      return {
        id: order.id,
        number: order.orderNumber!.trim(),
        deliveredPercent: counts?.orderedQuantity
          ? Math.min(
              100,
              Math.max(
                0,
                ((counts.receivedQuantity ?? 0) / counts.orderedQuantity) * 100,
              ),
            )
          : 0,
        complete:
          !!counts &&
          counts.itemCount > 0 &&
          counts.completeItemCount === counts.itemCount,
      };
    })
    .sort((a, b) =>
      a.number.localeCompare(b.number, undefined, { numeric: true }),
    );
}

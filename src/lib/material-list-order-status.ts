export type MaterialListOrderStatus = {
  id: string;
  number: string;
  complete: boolean;
  state?: "potential" | "sent" | "verified";
  deliveredPercent: number;
};

export function materialListOrderStatuses(
  listId: string,
  orders: readonly {
    id: string;
    materialListId: string | null;
    orderNumber: string | null;
    status: string;
    sentAt?: Date | string | null;
    supplierId?: string | null;
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
  potential: readonly {
    supplierId: string | null;
    supplierName?: string | null;
    sentOrderId?: string | null;
  }[] = [],
): MaterialListOrderStatus[] {
  const actual = orders
    .filter(
      (order) =>
        order.materialListId === listId && order.status !== "cancelled",
    )
    .map((order) => {
      const counts = verification.get(order.id);
      const sent =
        !!order.sentAt ||
        ["sent", "confirmed", "received"].includes(order.status);
      const complete =
        sent &&
        !!counts &&
        counts.itemCount > 0 &&
        counts.completeItemCount === counts.itemCount;
      return {
        id: order.id,
        state: complete
          ? ("verified" as const)
          : sent
            ? ("sent" as const)
            : ("potential" as const),
        number: order.orderNumber?.trim() ? order.orderNumber.trim() : "Order",
        deliveredPercent: counts?.orderedQuantity
          ? Math.min(
              100,
              Math.max(
                0,
                ((counts.receivedQuantity ?? 0) / counts.orderedQuantity) * 100,
              ),
            )
          : 0,
        complete,
      };
    })
    .sort((a, b) =>
      a.number.localeCompare(b.number, undefined, { numeric: true }),
    );
  const activeOrders = orders.filter(
    (order) => order.materialListId === listId && order.status !== "cancelled",
  );
  const activeIds = new Set(activeOrders.map((order) => order.id));
  const draftSuppliers = new Set(
    activeOrders
      .filter(
        (order) =>
          !order.sentAt &&
          !["sent", "confirmed", "received"].includes(order.status),
      )
      .map((order) => order.supplierId),
  );
  const pending = new Map<string, MaterialListOrderStatus>();
  for (const row of potential) {
    if (
      !row.supplierId ||
      (row.sentOrderId && activeIds.has(row.sentOrderId)) ||
      draftSuppliers.has(row.supplierId) ||
      (row.supplierId === "tool-room" && draftSuppliers.size > 0)
    )
      continue;
    pending.set(row.supplierId, {
      id: `potential:${row.supplierId}`,
      number: row.supplierName?.trim()
        ? row.supplierName.trim()
        : "Potential order",
      complete: false,
      deliveredPercent: 0,
      state: "potential",
    });
  }
  return [...pending.values(), ...actual];
}

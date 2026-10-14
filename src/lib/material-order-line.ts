/** Room assignment is part of a line's identity when matching deliveries. */
export function matchesMaterialOrderLine(
  item: {
    sentOrderItemId?: string | null;
    roomId?: string | null;
    supplierId?: string | null;
    supplierPart?: { id: string; supplierId?: string | null } | null;
    partDefinition?: { id: string } | null;
  },
  orderItem: {
    id?: string;
    roomId?: string | null;
    supplierPartId?: string | null;
    partDefinitionId?: string | null;
  },
  supplierId: string | null,
) {
  if (item.sentOrderItemId) return item.sentOrderItemId === orderItem.id;
  if ((item.roomId ?? null) !== (orderItem.roomId ?? null)) return false;
  if (
    item.supplierPart?.id &&
    item.supplierPart.id === orderItem.supplierPartId
  )
    return true;
  const itemSupplier = item.supplierId ?? item.supplierPart?.supplierId ?? null;
  return (
    !!item.partDefinition?.id &&
    item.partDefinition.id === orderItem.partDefinitionId &&
    (!supplierId || itemSupplier === supplierId)
  );
}

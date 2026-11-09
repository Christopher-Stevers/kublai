import { and, eq, inArray } from "drizzle-orm";
import { db } from "~/server/db";
import { orders, orderItems, partDefinitions, supplierParts, units } from "~/server/db/schema";
import type { DocumentAccess } from "~/server/documents/access";
import type { ReceiptOrderItem } from "~/lib/packing-slip-review";

/** One scoped query for the quantities and units used by all queue readiness checks. */
export async function receivingQueueItems(access: DocumentAccess, orderIds: string[]) {
  const result = new Map<string, ReceiptOrderItem[]>();
  if (!orderIds.length) return result;
  const rows = await db.select({ orderId: orders.id, id: orderItems.id,
    description: orderItems.descriptionSnapshot, displayName: partDefinitions.displayName,
    sku: orderItems.supplierSkuSnapshot, currentSku: supplierParts.supplierSku,
    quantity: orderItems.quantity, credited: orderItems.creditedQuantity, returned: orderItems.returnedQuantity,
    received: orderItems.receivedQuantity, verificationStatus: orderItems.verificationStatus,
    piecesPerPack: partDefinitions.piecesPerPack, bulkUnit: partDefinitions.bulkUnit,
    individualUnit: partDefinitions.individualUnit, uom: units.code,
  }).from(orderItems)
    .innerJoin(orders, and(eq(orders.id, orderItems.orderId), eq(orders.organizationId, access.job.organizationId), eq(orders.jobId, access.job.id)))
    .innerJoin(partDefinitions, and(eq(partDefinitions.id, orderItems.partDefinitionId), eq(partDefinitions.organizationId, access.job.organizationId)))
    .leftJoin(supplierParts, and(eq(supplierParts.id, orderItems.supplierPartId), eq(supplierParts.organizationId, access.job.organizationId)))
    .leftJoin(units, eq(units.id, orderItems.uomId))
    .where(inArray(orders.id, [...new Set(orderIds)]));
  for (const row of rows) {
    const items = result.get(row.orderId) ?? [];
    items.push({ id:row.id, description:row.description?.trim() ? row.description : row.displayName,
      sku:row.sku?.trim() ? row.sku : row.currentSku, aliases:[], ordered:Number(row.quantity)-Number(row.credited),
      originalOrdered:Number(row.quantity), credited:Number(row.credited), returned:Number(row.returned),
      received:Number(row.received), verificationStatus:row.verificationStatus,
      unit: row.piecesPerPack && row.piecesPerPack > 1 ? row.bulkUnit ?? "pack" : row.uom ?? "ea",
      piecesPerPack:row.piecesPerPack, individualUnit:row.individualUnit });
    result.set(row.orderId, items);
  }
  return result;
}

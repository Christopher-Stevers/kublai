import { inArray, sql } from "drizzle-orm";
import type { db } from "~/server/db";
import { orderItems } from "~/server/db/schema";

export async function loadOrderVerification(
  database: Pick<typeof db, "select">,
  orderIds: string[],
) {
  const rows = orderIds.length
    ? await database
        .select({
          orderId: orderItems.orderId,
          itemCount: sql<number>`count(*)::int`,
          orderedQuantity: sql<number>`coalesce(sum(greatest(${orderItems.quantity}, 0)), 0)::float8`,
          receivedQuantity: sql<number>`coalesce(sum(least(greatest(${orderItems.receivedQuantity}, 0), greatest(${orderItems.quantity}, 0))), 0)::float8`,
          completeItemCount: sql<number>`count(*) filter (where ${orderItems.verificationStatus} = 'complete' and ${orderItems.receivedQuantity} >= ${orderItems.quantity})::int`,
          verifiedItemCount: sql<number>`count(*) filter (where ${orderItems.verificationStatus} in ('complete', 'partial', 'problem'))::int`,
        })
        .from(orderItems)
        .where(inArray(orderItems.orderId, orderIds))
        .groupBy(orderItems.orderId)
    : [];

  return new Map(rows.map((row) => [row.orderId, row]));
}

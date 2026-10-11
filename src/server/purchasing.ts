import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { db } from "~/server/db";
import {
  quoteItems,
  quotes as quoteSchema,
  supplierParts,
} from "~/server/db/schema";
import {
  purchaseLineTotal,
  isValidOrderMultiple,
} from "~/lib/purchase-quantity";
import { publishMaterialListEvent } from "~/server/material-list-events";

import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

// The shared schema disables circular type inference; keep this boundary typed.
const quotes = quoteSchema as unknown as PgTable & {
  id: AnyPgColumn<{ data: string; notNull: true }>;
  organizationId: AnyPgColumn<{ data: string }>;
  materialListId: AnyPgColumn<{ data: string | null }>;
  markupPercent: AnyPgColumn<{ data: string | null }>;
};

export const orderMultipleInput = z
  .string()
  .trim()
  .refine(
    isValidOrderMultiple,
    "Enter a positive order multiple up to 999999, with at most six decimal places",
  );

type Database = Pick<typeof db, "select" | "update">;

export async function recalculatePurchaseTotals(
  database: Database,
  quoteId: string,
) {
  const items = await database
    .select({
      id: quoteItems.id,
      quantity: quoteItems.quantity,
      unitCost: quoteItems.unitCost,
      extendedPrice: quoteItems.extendedPrice,
      packSize: supplierParts.packSize,
    })
    .from(quoteItems)
    .leftJoin(supplierParts, eq(quoteItems.supplierPartId, supplierParts.id))
    .where(eq(quoteItems.quoteId, quoteId));
  let subtotal = 0;
  for (const item of items) {
    const price = purchaseLineTotal(
      item.quantity,
      item.unitCost,
      item.packSize,
    );
    subtotal += price;
    if (Number(item.extendedPrice ?? 0) !== price)
      await database
        .update(quoteItems)
        .set({ extendedPrice: String(price), updatedAt: new Date() })
        .where(eq(quoteItems.id, item.id));
  }
  await database
    .update(quotes)
    .set({
      subtotalMaterials: String(subtotal),
      total: sql`${subtotal} * (1 + coalesce(${quotes.markupPercent}, 0) / 100)`,
    })
    .where(eq(quotes.id, quoteId));
  return subtotal;
}

/** Refresh affected lists when a supplier's purchase rule changes. Sent orders remain snapshots. */
export async function refreshSupplierPurchaseTotals(
  database: Database,
  supplierPartIds: string[],
  organizationId: string,
) {
  if (!supplierPartIds.length) return;
  const affected = await database
    .select({ id: quotes.id, materialListId: quotes.materialListId })
    .from(quotes)
    .innerJoin(quoteItems, eq(quoteItems.quoteId, quotes.id))
    .where(
      and(
        inArray(quoteItems.supplierPartId, supplierPartIds),
        eq(quotes.organizationId, organizationId),
      ),
    );
  for (const quote of new Map(affected.map((row) => [row.id, row])).values()) {
    await recalculatePurchaseTotals(database, quote.id);
    if (quote.materialListId)
      publishMaterialListEvent(quote.materialListId, "updated", organizationId);
  }
}

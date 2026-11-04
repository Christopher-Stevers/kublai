/** The catalogue parts behind a slip's order items, and the part changes a
 * reviewer accepts so the next slip from this supplier matches on its own. */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { mutateWorkspace } from "~/server/documents/service";
import type { DocumentAccess } from "~/server/documents/access";
import {
  orderItems,
  orders,
  partDefinitions,
  partSynonyms,
  quoteItems,
  supplierParts,
  units,
} from "~/server/db/schema";
import { receiptUnit } from "~/lib/packing-slip-review";
import type { PartFacts, PartUpdate } from "~/lib/slip-part-fit";

type Tx = Parameters<Parameters<typeof mutateWorkspace>[2]>[3];
type Reader = Pick<Tx, "select">;
const fail = (
  message: string,
  code: "BAD_REQUEST" | "CONFLICT" = "BAD_REQUEST",
): never => {
  throw new TRPCError({ code, message });
};

/** Units each part is counted in on the organization's orders and lists. */
async function countedIn(db: Reader, partIds: string[]) {
  const counted = new Map<string, string[]>();
  if (!partIds.length) return counted;
  const [ordered, listed] = await Promise.all([
    db
      .select({ partId: orderItems.partDefinitionId, unit: units.code })
      .from(orderItems)
      .leftJoin(units, eq(units.id, orderItems.uomId))
      .where(inArray(orderItems.partDefinitionId, partIds))
      .groupBy(orderItems.partDefinitionId, units.code),
    db
      .select({ partId: quoteItems.partDefinitionId, unit: units.code })
      .from(quoteItems)
      .leftJoin(units, eq(units.id, quoteItems.uomId))
      .where(inArray(quoteItems.partDefinitionId, partIds))
      .groupBy(quoteItems.partDefinitionId, units.code),
  ]);
  for (const r of [...ordered, ...listed]) {
    if (!r.partId) continue;
    const unit = r.unit ?? "ea",
      seen = counted.get(r.partId) ?? [];
    if (!seen.some((u) => receiptUnit(u) === receiptUnit(unit)))
      counted.set(r.partId, [...seen, unit]);
  }
  return counted;
}

/** This supplier's listing for the part: the one the order used, or else
 * the preferred one. */
async function listingFor(
  db: Pick<Tx, "select">,
  organizationId: string,
  row: {
    partId: string;
    supplierPartId: string | null;
    supplierId: string | null;
  },
) {
  const scoped = (where: ReturnType<typeof and>) =>
    db
      .select()
      .from(supplierParts)
      .where(and(eq(supplierParts.organizationId, organizationId), where))
      .orderBy(desc(supplierParts.isPreferred))
      .limit(1);
  const [used] = row.supplierPartId
    ? await scoped(eq(supplierParts.id, row.supplierPartId))
    : [];
  if (used || !row.supplierId) return used;
  const [other] = await scoped(
    and(
      eq(supplierParts.supplierId, row.supplierId),
      eq(supplierParts.partDefinitionId, row.partId),
    ),
  );
  return other;
}

/** Each order item's part, its supplier listing and the units it is counted in. */
export async function orderPartFacts(
  db: Reader,
  access: DocumentAccess,
  orderId: string,
): Promise<Record<string, PartFacts>> {
  const organizationId = access.job.organizationId;
  const rows = await db
    .select({
      id: orderItems.id,
      partId: partDefinitions.id,
      name: partDefinitions.displayName,
      bulkUnit: partDefinitions.bulkUnit,
      supplierPartId: orderItems.supplierPartId,
      supplierId: orders.supplierId,
    })
    .from(orderItems)
    .innerJoin(
      orders,
      and(
        eq(orders.id, orderItems.orderId),
        eq(orders.organizationId, organizationId),
      ),
    )
    .innerJoin(
      partDefinitions,
      and(
        eq(partDefinitions.id, orderItems.partDefinitionId),
        eq(partDefinitions.organizationId, organizationId),
      ),
    )
    .where(eq(orderItems.orderId, orderId));
  const [counted, listings] = await Promise.all([
    countedIn(db, [...new Set(rows.map((r) => r.partId))]),
    Promise.all(rows.map((r) => listingFor(db, organizationId, r))),
  ]);
  return Object.fromEntries(
    rows.map((r, i) => [
      r.id,
      {
        partId: r.partId,
        name: r.name,
        bulkUnit: r.bulkUnit,
        supplierSku: listings[i]?.supplierSku ?? null,
        supplierName: listings[i]?.supplierName ?? null,
        units: counted.get(r.partId) ?? [],
      },
    ]),
  );
}

/** Applies the accepted changes to the order item's part and this
 * supplier's listing. Fills only what is not set, so nothing is overwritten. */
export async function applyPartFit(
  tx: Tx,
  access: DocumentAccess,
  orderId: string,
  itemId: string,
  orderUnit: string,
  update: PartUpdate,
) {
  const organizationId = access.job.organizationId;
  const [row] = await tx
    .select({
      partId: partDefinitions.id,
      piecesPerPack: partDefinitions.piecesPerPack,
      bulkUnit: partDefinitions.bulkUnit,
      supplierPartId: orderItems.supplierPartId,
      supplierId: orders.supplierId,
    })
    .from(orderItems)
    .innerJoin(
      orders,
      and(
        eq(orders.id, orderItems.orderId),
        eq(orders.organizationId, organizationId),
      ),
    )
    .innerJoin(
      partDefinitions,
      and(
        eq(partDefinitions.id, orderItems.partDefinitionId),
        eq(partDefinitions.organizationId, organizationId),
      ),
    )
    .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)))
    .limit(1);
  if (!row) return fail("This order part is unavailable.");
  const set: Partial<typeof partDefinitions.$inferInsert> = {};
  if (update.piecesPerPack !== undefined) {
    if (row.piecesPerPack && row.piecesPerPack > 1)
      fail("This part already has a pack size. Reload to see it.", "CONFLICT");
    const bulk = update.bulkUnit ?? row.bulkUnit;
    if (receiptUnit(bulk) !== receiptUnit(orderUnit))
      fail(`Count the pack in ${orderUnit}, as this order does.`);
    // Orders and lists keep their quantities; the part's pack unit names them.
    const other = (await countedIn(tx, [row.partId]))
      .get(row.partId)
      ?.find((u) => receiptUnit(u) !== receiptUnit(orderUnit));
    if (other)
      fail(
        `Other orders or lists count this part in ${other}. Change its pack size in Catalogue.`,
        "CONFLICT",
      );
    set.piecesPerPack = update.piecesPerPack;
    if (update.individualUnit)
      set.individualUnit = update.individualUnit.toLowerCase();
    if (update.bulkUnit) set.bulkUnit = update.bulkUnit.toLowerCase();
  }
  const sku = update.supplierSku?.trim(),
    name = update.supplierName?.trim();
  if (sku || name) {
    if (!row.supplierId) fail("This order has no supplier.");
    const listing = await listingFor(tx, organizationId, row);
    const [taken] = sku
      ? await tx
          .select({ partId: supplierParts.partDefinitionId })
          .from(supplierParts)
          .where(
            and(
              eq(supplierParts.organizationId, organizationId),
              eq(supplierParts.supplierId, row.supplierId!),
              eq(supplierParts.supplierSku, sku),
            ),
          )
          .limit(1)
      : [];
    if (taken && taken.partId !== row.partId)
      fail(
        `Supplier code ${sku} already belongs to another part. Confirm without changing the part, or fix it in Catalogue.`,
        "CONFLICT",
      );
    const code = taken ? undefined : sku;
    if (!listing)
      await tx.insert(supplierParts).values({
        organizationId,
        supplierId: row.supplierId!,
        partDefinitionId: row.partId,
        supplierSku: code ?? null,
        supplierName: name ?? null,
      });
    else {
      const fill = {
        ...(code && !listing.supplierSku?.trim() ? { supplierSku: code } : {}),
        ...(name && !listing.supplierName?.trim()
          ? { supplierName: name }
          : {}),
      };
      if (Object.keys(fill).length)
        await tx
          .update(supplierParts)
          .set(fill)
          .where(eq(supplierParts.id, listing.id));
    }
  }
  const alias = update.alias?.trim();
  if (alias) {
    const [same] = await tx
      .select({ id: partSynonyms.id })
      .from(partSynonyms)
      .where(
        and(
          eq(partSynonyms.partDefinitionId, row.partId),
          sql`lower(${partSynonyms.synonym})=lower(${alias})`,
        ),
      )
      .limit(1);
    if (!same)
      await tx
        .insert(partSynonyms)
        .values({ partDefinitionId: row.partId, synonym: alias });
  }
  // The part's revision trigger refreshes cached catalogues, as in Catalogue.
  await tx
    .update(partDefinitions)
    .set(
      Object.keys(set).length
        ? set
        : { displayName: sql`${partDefinitions.displayName}` },
    )
    .where(
      and(
        eq(partDefinitions.id, row.partId),
        eq(partDefinitions.organizationId, organizationId),
      ),
    );
}

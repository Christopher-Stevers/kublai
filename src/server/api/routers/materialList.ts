import { publishMaterialListEvent } from "~/server/material-list-events";
import { packContents, formatOrderedBulkQuantity } from "~/lib/pack-quantity";
import { purchaseQuantity, purchaseLineTotal, formatPurchaseQuantity } from "~/lib/purchase-quantity";
import { recalculatePurchaseTotals } from "~/server/purchasing";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { formatDeliveryDate } from "~/lib/delivery-calendar";
import {
  formatSupplierGreetingName,
  getSupplierEmailRecipients,
  normalizeSupplierContacts,
} from "~/lib/supplier-contacts";
import type { db as appDb } from "~/server/db";
import { userDeliveryDate } from "~/server/orders/delivery-calendar";
import { retiredOfflineMutation } from "../retired-offline-sync";

function formatEmailItemLine(item: {
  quantity: string | null;
  descriptionSnapshot: string | null;
  partDefinitionDisplayName?: string | null;
  partDefinitionPiecesPerPack?: number | null;
  partDefinitionBulkUnit?: string | null;
  partDefinitionIndividualUnit?: string | null;
}) {
  const rawQty = item.quantity ? item.quantity.toString().trim() : "0";
  const parsedQty = Number(rawQty);
  const qty = Number.isFinite(parsedQty) && packContents(item.partDefinitionPiecesPerPack) > 1
    ? formatOrderedBulkQuantity(parsedQty, item.partDefinitionPiecesPerPack, item.partDefinitionBulkUnit, item.partDefinitionIndividualUnit)
    : Number.isFinite(parsedQty)
    ? parsedQty.toLocaleString("en-CA", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 6,
      })
    : rawQty;
  const description =
    item.descriptionSnapshot?.trim() ||
    item.partDefinitionDisplayName?.trim() ||
    "Item";

  return `${qty} - ${description}`;
}

function formatOneLineAddress(address: {
  name?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
}) {
  return [
    address.address1,
    address.address2,
    address.city,
    address.region,
    address.postalCode,
    address.country,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
}

function firstName(name: string | null | undefined) {
  return name?.trim().split(/\s+/)[0] ?? "";
}

type OrderableQuoteItem = {
  id: string;
  supplierPartId: string | null;
  selectedSupplierId: string | null;
  partDefinitionId: string | null;
  partDefinitionDisplayName: string | null;
  quantity: string;
  uomId: string | null;
  unitCost: string | null;
  descriptionSnapshot: string | null;
  supplierPartSupplierId: string | null;
  supplierSku: string | null;
  packSize?: string | null;
  partDefinitionPiecesPerPack?: number | null;
  partDefinitionBulkUnit?: string | null;
  partDefinitionIndividualUnit?: string | null;
  requestedQuantity?: string;
  orderMultipleSnapshot?: string | null;
  roomId: string | null;
  roomName: string | null;
};

function groupOrderableItemsBySupplier(items: OrderableQuoteItem[]) {
  const itemsBySupplier = new Map<string, OrderableQuoteItem[]>();
  for (const item of items) {
    const supplierId = item.selectedSupplierId ?? item.supplierPartSupplierId;
    if (!supplierId || !item.partDefinitionId) continue;
    const bucket = itemsBySupplier.get(supplierId) ?? [];
    bucket.push({ ...item, requestedQuantity: item.quantity, quantity: String(purchaseQuantity(item.quantity, item.packSize, item.partDefinitionPiecesPerPack)), orderMultipleSnapshot: item.packSize ?? null });
    itemsBySupplier.set(supplierId, bucket);
  }
  return itemsBySupplier;
}

function buildOrderEmailContent({
  jobName,
  poNumber,
  deliveryAddress,
  deliveryDate,
  supplierContactName,
  items,
  notes,
  foremanName,
}: {
  jobName: string;
  poNumber: string;
  deliveryAddress: string;
  deliveryDate: string;
  supplierContactName: string;
  items: Array<{
    quantity: string | null;
    descriptionSnapshot: string | null;
    partDefinitionDisplayName?: string | null;
  partDefinitionPiecesPerPack?: number | null;
  partDefinitionBulkUnit?: string | null;
  partDefinitionIndividualUnit?: string | null;
  }>;
  notes?: string | null;
  foremanName: string;
}) {
  const lineItems = items.map(formatEmailItemLine).join("\n");
  const sections = [
    `Hello${supplierContactName ? ` ${supplierContactName}` : ""},`,
    "",
    `Job: ${jobName}`,
    `PO#: ${poNumber}`,
    `Address: ${deliveryAddress || ""}`,
    `Delivery Date: ${formatDeliveryDate(deliveryDate)}`,
    "",
    lineItems || "No items",
    ...(notes?.trim() ? ["", "Notes:", notes.trim()] : []),
    "",
    "Thanks,",
    foremanName,
  ];

  return {
    subject: `Material Order ${poNumber} - ${jobName}`,
    body: sections.join("\n"),
  };
}

/**
 * A tool request list can be sent more than once (e.g. tools added later).
 * Only what hasn't already been requested from this list goes in the next
 * request; closed (cancelled) requests don't count.
 */
async function withoutAlreadyRequestedTools<
  T extends {
    partDefinitionId: string | null;
    roomId: string | null;
    quantity: string | null;
  },
>(db: Pick<typeof appDb, "select">, materialListId: string, items: T[]) {
  const requested = await db
    .select({
      partDefinitionId: orderItems.partDefinitionId,
      roomId: orderItems.roomId,
      quantity: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::float`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(
      and(
        eq(orders.materialListId, materialListId),
        eq(orders.kind, "tool_request"),
        sql`coalesce(${orders.fulfillmentStatus}, 'open') <> 'cancelled'`,
      ),
    )
    .groupBy(orderItems.partDefinitionId, orderItems.roomId);
  const alreadyRequested = new Map(
    requested.map((row) => [
      JSON.stringify([row.partDefinitionId, row.roomId]),
      Number(row.quantity),
    ]),
  );
  const remaining: T[] = [];
  for (const item of items) {
    if (!item.partDefinitionId) continue;
    const key = JSON.stringify([item.partDefinitionId, item.roomId]);
    const covered = alreadyRequested.get(key) ?? 0;
    const quantity = Number(item.quantity ?? 1);
    const left = quantity - covered;
    alreadyRequested.set(key, Math.max(0, covered - quantity));
    if (left > 1e-9) remaining.push({ ...item, quantity: String(left) });
  }
  return remaining;
}

async function loadOrderableQuoteItems(
  database: typeof appDb | any,
  quoteId: string,
) {
  return database
    .select({
      id: quoteItems.id,
      roomId: quoteItems.roomId,
      roomName: jobRooms.name,
      supplierPartId: quoteItems.supplierPartId,
      selectedSupplierId: quoteItems.supplierId,
      partDefinitionId: quoteItems.partDefinitionId,
      partDefinitionDisplayName: partDefinitions.displayName,
      partDefinitionPiecesPerPack: partDefinitions.piecesPerPack,
      partDefinitionBulkUnit: partDefinitions.bulkUnit,
      partDefinitionIndividualUnit: partDefinitions.individualUnit,
      quantity: quoteItems.quantity,
      uomId: quoteItems.uomId,
      unitCost: quoteItems.unitCost,
      descriptionSnapshot: quoteItems.descriptionSnapshot,
      supplierPartSupplierId: supplierParts.supplierId,
      supplierSku: supplierParts.supplierSku,
      packSize: supplierParts.packSize,
    })
    .from(quoteItems)
    .leftJoin(jobRooms, eq(quoteItems.roomId, jobRooms.id))
    .leftJoin(supplierParts, eq(quoteItems.supplierPartId, supplierParts.id))
    .leftJoin(
      partDefinitions,
      eq(quoteItems.partDefinitionId, partDefinitions.id),
    )
    .where(and(eq(quoteItems.quoteId, quoteId), isNull(quoteItems.sentOrderItemId))) as Promise<OrderableQuoteItem[]>;
}

import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import { ensureToolRoomSupplier } from "~/server/assets/service";
import { assertCan, userCan } from "~/server/auth/permissions";
import {
  jobRooms,
  jobs,
  locations,
  materialLists,
  materialListSyncTombstones,
  materials,
  orderItems,
  orders,
  partDefinitions,
  quoteItems,
  quotes,
  supplierParts,
  suppliers,
  units,
  users,
} from "~/server/db/schema";

export const materialListRouter = createTRPCRouter({
  undoOrder: hasDashboardAccess
    .input(z.object({ orderId: z.string().uuid() }))
    .mutation(async ({ctx, input}) => {
      assertCan(ctx.user, "orders.send");
      const organizationId = ctx.user.organizationId;
      if (!organizationId) throw new TRPCError({code:"FORBIDDEN"});
      const result = await ctx.db.transaction(async tx => {
        const [order] = await tx.select().from(orders).where(and(eq(orders.id,input.orderId),eq(orders.organizationId,organizationId))).limit(1);
        if (!order || order.kind !== "materials") throw new TRPCError({code:"NOT_FOUND",message:"Material order not found."});
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${organizationId}:${order.jobId}:orders`}))`);
        await tx.select({id:orders.id}).from(orders).where(eq(orders.id,order.id)).for("update");

        const lines = await tx.select({id:orderItems.id}).from(orderItems).where(eq(orderItems.orderId,order.id));
        const unlocked = lines.length ? await tx.update(quoteItems).set({sentOrderItemId:null,updatedAt:new Date()})
          .where(inArray(quoteItems.sentOrderItemId,lines.map(line=>line.id))).returning({quoteId:quoteItems.quoteId}) : [];
        // Undo removes the order, including its delivery verification records.
        await tx.delete(orderItems).where(eq(orderItems.orderId,order.id));
        await tx.delete(orders).where(eq(orders.id,order.id));
        for (const quoteId of new Set(unlocked.map(line=>line.quoteId))) await recalculatePurchaseTotals(tx,quoteId);
        return {materialListId:order.materialListId};
      });
      if (result.materialListId) publishMaterialListEvent(result.materialListId,"updated",organizationId);
      return result;
    }),

  merge: hasDashboardAccess
    .input(z.object({ sourceId: z.string().uuid(), targetId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.user, "lists.edit");
      const organizationId = ctx.user.organizationId;
      if (!organizationId) throw new TRPCError({ code: "FORBIDDEN" });
      if (input.sourceId === input.targetId) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose another material list." });
      const result = await ctx.db.transaction(async tx => {
        const lists = await tx.select().from(materialLists).where(and(
          inArray(materialLists.id, [input.sourceId, input.targetId]), eq(materialLists.organizationId, organizationId),
        ));
        const source = lists.find(list => list.id === input.sourceId);
        const target = lists.find(list => list.id === input.targetId);
        if (!source || !target) throw new TRPCError({ code: "NOT_FOUND", message: "Material list not found." });
        if (source.jobId !== target.jobId || source.kind === "tools" || target.kind === "tools")
          throw new TRPCError({ code: "BAD_REQUEST", message: "Choose another material list in the same job." });
        if (!source.quoteId || !target.quoteId) throw new TRPCError({ code: "BAD_REQUEST", message: "This material list is not ready to merge." });
        // Same lock order as sending an order; a sent row can never move.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${organizationId}:${source.jobId}:orders`}))`);
        // Block concurrent inserts through the quote FK while checking emptiness.
        await tx.select({ id: quotes.id }).from(quotes)
          .where(inArray(quotes.id, [source.quoteId, target.quoteId])).orderBy(quotes.id).for("update");
        await tx.select({ id: quoteItems.id }).from(quoteItems)
          .where(inArray(quoteItems.quoteId, [source.quoteId, target.quoteId]))
          .orderBy(quoteItems.id).for("update");
        const moved = await tx.update(quoteItems).set({ quoteId: target.quoteId, updatedAt: new Date() })
          .where(and(eq(quoteItems.quoteId, source.quoteId), isNull(quoteItems.sentOrderItemId)))
          .returning({ id: quoteItems.id });
        if (!moved.length) throw new TRPCError({ code: "BAD_REQUEST", message: "This list has no unlocked items to merge." });
        await recalculatePurchaseTotals(tx, source.quoteId);
        await recalculatePurchaseTotals(tx, target.quoteId);
        await tx.update(materialLists).set({ updatedAt: new Date() })
          .where(inArray(materialLists.id, [source.id, target.id]));
        const remaining = await tx.select({ id: quoteItems.id }).from(quoteItems)
          .where(eq(quoteItems.quoteId, source.quoteId)).limit(1);
        const sourceDeleted = remaining.length === 0;
        if (sourceDeleted) {
          await tx.insert(materialListSyncTombstones).values({
            organizationId, materialListId: source.id, entityType: "materialList",
            entityId: source.id, deletedAt: new Date(),
          }).onConflictDoUpdate({
            target: [materialListSyncTombstones.organizationId, materialListSyncTombstones.entityType, materialListSyncTombstones.entityId],
            set: { deletedAt: new Date() },
          });
          await tx.delete(quotes).where(eq(quotes.id, source.quoteId));
          await tx.delete(materialLists).where(eq(materialLists.id, source.id));
        }
        return { id: target.id, movedCount: moved.length, sourceDeleted };
      });
      publishMaterialListEvent(input.sourceId, result.sourceDeleted ? "deleted" : "updated", organizationId);
      publishMaterialListEvent(input.targetId, "updated", organizationId);
      return result;
    }),

  duplicate: hasDashboardAccess
    .input(z.object({ materialListId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.user, "lists.edit");
      if (!ctx.user.organizationId) throw new TRPCError({ code: "FORBIDDEN" });
      const organizationId = ctx.user.organizationId;
      const copy = await ctx.db.transaction(async tx => {
        const [source] = await tx.select().from(materialLists).where(and(
          eq(materialLists.id, input.materialListId), eq(materialLists.organizationId, organizationId),
        )).limit(1);
        if (!source) throw new TRPCError({ code: "NOT_FOUND", message: "Material list not found" });
        const id = crypto.randomUUID(), quoteId = crypto.randomUUID();
        await tx.insert(materialLists).values({ id, organizationId, jobId: source.jobId,
          name: `${source.name} (copy)`.slice(0, 255), kind: source.kind, roomId: source.roomId, createdByUserId: ctx.userId });
        const [quote] = source.quoteId ? await tx.select().from(quotes).where(eq(quotes.id, source.quoteId)).limit(1) : [];
        await tx.insert(quotes).values({ id: quoteId, organizationId, materialListId: id, jobId: source.jobId,
          createdByUserId: ctx.userId, notes: quote?.notes, markupPercent: quote?.markupPercent });
        await tx.update(materialLists).set({ quoteId }).where(eq(materialLists.id, id));
        const rows = source.quoteId ? await tx.select().from(quoteItems).where(eq(quoteItems.quoteId, source.quoteId)) : [];
        if (rows.length) await tx.insert(quoteItems).values(rows.map(row => ({ ...row,
          id: crypto.randomUUID(), quoteId, sentOrderItemId: null, addedByUserId: ctx.userId,
          createdAt: new Date(), updatedAt: new Date(),
        })));
        await recalculatePurchaseTotals(tx, quoteId);
        return { id };
      });
      publishMaterialListEvent(copy.id, "updated", organizationId);
      return copy;
    }),

  applyMaterialListMutationsBatch: retiredOfflineMutation,
  syncMaterialListMutations: retiredOfflineMutation,

  /**
   * Get a material list with all items
   */
  getMaterialList: hasDashboardAccess
    .input(z.object({ materialListId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // Get material list with job
      const [materialList] = await ctx.db
        .select({
          id: materialLists.id,
          name: materialLists.name,
          roomId: materialLists.roomId,
          roomName: jobRooms.name,
          jobId: materialLists.jobId,
          quoteId: materialLists.quoteId,
          createdAt: materialLists.createdAt,
          updatedAt: materialLists.updatedAt,
          createdByUserId: materialLists.createdByUserId,
          job: {
            id: jobs.id,
            name: jobs.name,
            locationId: jobs.locationId,
            foremanUserId: jobs.foremanUserId,
            status: jobs.status,
            locationName: locations.name,
            foremanId: users.id,
            foremanName: users.name,
            foremanEmail: users.email,
          },
        })
        .from(materialLists)
        .leftJoin(jobRooms, eq(materialLists.roomId, jobRooms.id))
        .leftJoin(jobs, eq(materialLists.jobId, jobs.id))
        .leftJoin(locations, eq(jobs.locationId, locations.id))
        .leftJoin(users, eq(jobs.foremanUserId, users.id))
        .where(
          and(
            eq(materialLists.id, input.materialListId),
            eq(materialLists.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!materialList || !materialList.job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Material list not found",
        });
      }

      // Get quote for this material list
      if (!materialList.quoteId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Quote not found for material list",
        });
      }

      const [createdBy, quoteRows, itemsRaw] = await Promise.all([
        materialList.createdByUserId
          ? ctx.db
              .select({
                id: users.id,
                name: users.name,
                email: users.email,
              })
              .from(users)
              .where(eq(users.id, materialList.createdByUserId))
              .limit(1)
              .then((rows) => rows[0] ?? null)
          : Promise.resolve(null),
        ctx.db
          .select()
          .from(quotes)
          .where(eq(quotes.id, materialList.quoteId))
          .limit(1),
        // Get quote items with part definitions and suppliers
        ctx.db
          .select({
            id: quoteItems.id,
            sentOrderItemId: quoteItems.sentOrderItemId,
            roomId: quoteItems.roomId,
            roomName: jobRooms.name,
            quantity: quoteItems.quantity,
            unitCost: quoteItems.unitCost,
            extendedPrice: quoteItems.extendedPrice,
            descriptionSnapshot: quoteItems.descriptionSnapshot,
            createdAt: quoteItems.createdAt,
            updatedAt: quoteItems.updatedAt,
            partDefinitionId: partDefinitions.id,
            partDefinitionDisplayName: partDefinitions.displayName,
            partDefinitionPiecesPerPack: partDefinitions.piecesPerPack,
            partDefinitionBulkUnit: partDefinitions.bulkUnit,
            partDefinitionIndividualUnit: partDefinitions.individualUnit,
            partDefinitionImageUrl: partDefinitions.imageUrl,
            partDefinitionMaterialId: partDefinitions.materialId,
            partDefinitionMaterialName: materials.name,
            supplierPartId: supplierParts.id,
            selectedSupplierId: quoteItems.supplierId,
            supplierPartSupplierId: supplierParts.supplierId,
            supplierPartSku: supplierParts.supplierSku,
            supplierPartLastKnownUnitCost: supplierParts.lastKnownUnitCost,
            supplierPartPackSize: supplierParts.packSize,
            supplierId: suppliers.id,
            supplierName: suppliers.name,
            uomId: units.id,
            uomCode: units.code,
            uomDisplayName: units.displayName,
            // One-off fields
            oneOffDisplayName: quoteItems.oneOffDisplayName,
            oneOffDescription: quoteItems.oneOffDescription,
            oneOffMaterial: quoteItems.oneOffMaterial,
            oneOffSizeNominal: quoteItems.oneOffSizeNominal,
            oneOffSizeUnitId: quoteItems.oneOffSizeUnitId,
            addedByUserId: quoteItems.addedByUserId,
            addedByName: users.name,
            addedByEmail: users.email,
          })
          .from(quoteItems)
          .leftJoin(jobRooms, eq(quoteItems.roomId, jobRooms.id))
          .leftJoin(
            partDefinitions,
            eq(quoteItems.partDefinitionId, partDefinitions.id),
          )
          .leftJoin(
            supplierParts,
            eq(quoteItems.supplierPartId, supplierParts.id),
          )
          .leftJoin(suppliers, eq(supplierParts.supplierId, suppliers.id))
          .leftJoin(units, eq(quoteItems.uomId, units.id))
          .leftJoin(materials, eq(partDefinitions.materialId, materials.id))
          .leftJoin(users, eq(quoteItems.addedByUserId, users.id))
          .where(eq(quoteItems.quoteId, materialList.quoteId))
          .orderBy(asc(quoteItems.createdAt), asc(quoteItems.id)),
      ]);

      const [quote] = quoteRows;
      if (!quote) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Quote not found for material list",
        });
      }

      // Transform to nested structure
      const items = itemsRaw.map((item) => ({
        id: item.id,
        roomId: item.roomId,
        roomName: item.roomName,
        quantity: item.quantity,
        unitCost: item.unitCost,
        sentOrderItemId: item.sentOrderItemId,
        extendedPrice: item.sentOrderItemId ? item.extendedPrice : String(purchaseLineTotal(item.quantity, item.unitCost, item.supplierPartPackSize, item.partDefinitionPiecesPerPack)),
        descriptionSnapshot: item.descriptionSnapshot,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        syncVersion: item.updatedAt?.toISOString?.() ?? String(item.updatedAt),
        partDefinition: item.partDefinitionId
          ? {
              id: item.partDefinitionId,
              displayName: item.partDefinitionDisplayName,
              piecesPerPack: item.partDefinitionPiecesPerPack,
              bulkUnit: item.partDefinitionBulkUnit,
              individualUnit: item.partDefinitionIndividualUnit,
              imageUrl: item.partDefinitionImageUrl,
              material: item.partDefinitionMaterialName,
            }
          : null,
        // One-off part data
        oneOff: item.oneOffDisplayName
          ? {
              displayName: item.oneOffDisplayName,
              description: item.oneOffDescription,
              material: item.oneOffMaterial,
              sizeNominal: item.oneOffSizeNominal,
              sizeUnitId: item.oneOffSizeUnitId,
            }
          : null,
        selectedSupplierId:
          item.selectedSupplierId ?? item.supplierPartSupplierId ?? null,
        supplierPart: item.supplierPartId
          ? {
              id: item.supplierPartId,
              supplierId: item.supplierPartSupplierId,
              supplierSku: item.supplierPartSku,
              packSize: item.supplierPartPackSize,
              lastKnownUnitCost: item.supplierPartLastKnownUnitCost,
              supplier: item.supplierId
                ? {
                    id: item.supplierId,
                    name: item.supplierName,
                  }
                : null,
            }
          : null,
        uom: item.uomId
          ? {
              id: item.uomId,
              code: item.uomCode,
              displayName: item.uomDisplayName,
            }
          : null,
        addedBy: item.addedByUserId
          ? {
              id: item.addedByUserId,
              name: item.addedByName ?? item.addedByEmail ?? "Unknown",
              email: item.addedByEmail,
            }
          : null,
      }));

      // Calculate material total
      const materialTotal = items.reduce((sum, item) => {
        const extendedPrice = item.extendedPrice
          ? parseFloat(item.extendedPrice.toString())
          : 0;
        return sum + extendedPrice;
      }, 0);

      return {
        materialList: {
          id: materialList.id,
          name: materialList.name,
          roomId: materialList.roomId,
          roomName: materialList.roomName,
          createdAt: materialList.createdAt,
          updatedAt: materialList.updatedAt,
          syncVersion:
            materialList.updatedAt?.toISOString?.() ??
            String(materialList.updatedAt),
          createdBy: createdBy
            ? {
                id: createdBy.id,
                name: createdBy.name ?? "Unknown",
                email: createdBy.email,
              }
            : null,
        },
        job: {
          id: materialList.job.id,
          name: materialList.job.name,
          locationId: materialList.job.locationId,
          foremanUserId: materialList.job.foremanUserId,
          status: materialList.job.status,
          location: materialList.job.locationName
            ? {
                id: materialList.job.locationId ?? "",
                name: materialList.job.locationName,
              }
            : null,
          foreman: materialList.job.foremanId
            ? {
                id: materialList.job.foremanId,
                name: materialList.job.foremanName ?? "",
                email: materialList.job.foremanEmail ?? "",
              }
            : null,
        },
        quote,
        items,
        materialTotal,
      };
    }),

  pullMaterialListSyncChanges: hasDashboardAccess
    .input(
      z.object({
        since: z.string().datetime().optional(),
        materialListIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const since = input.since ? new Date(input.since) : new Date(0);
      const scopedMaterialListIds = input.materialListIds?.length
        ? Array.from(new Set(input.materialListIds))
        : null;

      const materialListFilters = [
        eq(materialLists.organizationId, ctx.user.organizationId),
        gte(materialLists.updatedAt, since),
      ];
      if (scopedMaterialListIds) {
        materialListFilters.push(
          inArray(materialLists.id, scopedMaterialListIds),
        );
      }

      const changedLists = await ctx.db
        .select({ id: materialLists.id, updatedAt: materialLists.updatedAt })
        .from(materialLists)
        .where(and(...materialListFilters))
        .orderBy(asc(materialLists.updatedAt), asc(materialLists.id))
        .limit(200);

      const changedItemFilters = [
        eq(materialLists.organizationId, ctx.user.organizationId),
        gte(quoteItems.updatedAt, since),
      ];
      if (scopedMaterialListIds) {
        changedItemFilters.push(
          inArray(materialLists.id, scopedMaterialListIds),
        );
      }

      const changedItems = await ctx.db
        .select({
          materialListId: materialLists.id,
          updatedAt: quoteItems.updatedAt,
        })
        .from(quoteItems)
        .innerJoin(quotes, eq(quoteItems.quoteId, quotes.id))
        .innerJoin(materialLists, eq(quotes.materialListId, materialLists.id))
        .where(and(...changedItemFilters))
        .orderBy(asc(quoteItems.updatedAt), asc(quoteItems.id))
        .limit(500);

      const tombstoneFilters = [
        eq(materialListSyncTombstones.organizationId, ctx.user.organizationId),
        gte(materialListSyncTombstones.deletedAt, since),
      ];
      if (scopedMaterialListIds) {
        tombstoneFilters.push(
          inArray(
            materialListSyncTombstones.materialListId,
            scopedMaterialListIds,
          ),
        );
      }

      const tombstones = await ctx.db
        .select({
          materialListId: materialListSyncTombstones.materialListId,
          entityType: materialListSyncTombstones.entityType,
          entityId: materialListSyncTombstones.entityId,
          deletedAt: materialListSyncTombstones.deletedAt,
        })
        .from(materialListSyncTombstones)
        .where(and(...tombstoneFilters))
        .orderBy(
          asc(materialListSyncTombstones.deletedAt),
          asc(materialListSyncTombstones.entityId),
        )
        .limit(500);

      const changedMaterialListIds = Array.from(
        new Set([
          ...changedLists.map((row) => row.id),
          ...changedItems.map((row) => row.materialListId),
          ...tombstones.map((row) => row.materialListId),
        ]),
      );
      const maxReturnedTimestamp = [
        ...changedLists.map((row) => row.updatedAt),
        ...changedItems.map((row) => row.updatedAt),
        ...tombstones.map((row) => row.deletedAt),
      ]
        .filter((value): value is Date => value instanceof Date)
        .sort((a, b) => a.getTime() - b.getTime())
        .at(-1);

      return {
        cursor: (maxReturnedTimestamp ?? since).toISOString(),
        changedMaterialListIds,
        tombstones: tombstones.map((row) => ({
          materialListId: row.materialListId,
          entityType: row.entityType,
          entityId: row.entityId,
          deletedAt: row.deletedAt.toISOString(),
        })),
      };
    }),

  /**
   * Generate quote from material list
   */
  generateQuote: hasDashboardAccess
    .input(
      z.object({
        materialListId: z.string().uuid(),
        markupPercent: z.number().min(0).max(1000).default(0),
        notes: z.string().optional(),
        quoteId: z.string().uuid().optional(), // Optional: update specific quote instead of material list's quote
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.user, "quotes.create");

      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // If quoteId is provided, use that quote directly
      if (input.quoteId) {
        const [quote] = await ctx.db
          .select()
          .from(quotes)
          .where(
            and(
              eq(quotes.id, input.quoteId),
              eq(quotes.organizationId, ctx.user.organizationId),
            ),
          )
          .limit(1);

        if (!quote) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Quote not found",
          });
        }

        // Calculate totals for this quote
        const subtotalMaterials = await recalculatePurchaseTotals(ctx.db, String(quote.id));

        const effectiveMarkup = userCan(ctx.user, "financial.view")
          ? input.markupPercent
          : Number(quote.markupPercent ?? 0);
        const markup = effectiveMarkup / 100;
        const total = subtotalMaterials * (1 + markup);

        // Update quote
        const updateData: {
          generatedAt: Date;
          markupPercent: string;
          subtotalMaterials: string;
          total: string;
          notes?: string | null;
        } = {
          generatedAt: new Date(),
          markupPercent: effectiveMarkup.toString(),
          subtotalMaterials: subtotalMaterials.toString(),
          total: total.toString(),
        };

        if (input.notes !== undefined) {
          updateData.notes = input.notes.trim() || null;
        }

        const [updated] = await ctx.db
          .update(quotes)
          .set(updateData)
          .where(eq(quotes.id, quote.id))
          .returning();

        return updated;
      }

      // Get material list and verify it exists
      const [materialList] = await ctx.db
        .select({
          id: materialLists.id,
          quoteId: materialLists.quoteId,
        })
        .from(materialLists)
        .where(
          and(
            eq(materialLists.id, input.materialListId),
            eq(materialLists.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!materialList) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Material list not found",
        });
      }

      if (!materialList.quoteId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Quote not found for material list",
        });
      }

      // Get quote
      const [quote] = await ctx.db
        .select()
        .from(quotes)
        .where(eq(quotes.id, materialList.quoteId))
        .limit(1);

      if (!quote) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Quote not found for material list",
        });
      }

      // Calculate totals
      const subtotalMaterials = await recalculatePurchaseTotals(ctx.db, String(quote.id));

      const effectiveMarkup = userCan(ctx.user, "financial.view")
        ? input.markupPercent
        : Number(quote.markupPercent ?? 0);
      const markup = effectiveMarkup / 100;
      const total = subtotalMaterials * (1 + markup);

      // Update quote
      const updateData: {
        generatedAt: Date;
        markupPercent: string;
        subtotalMaterials: string;
        total: string;
        notes?: string | null;
      } = {
        generatedAt: new Date(),
        markupPercent: effectiveMarkup.toString(),
        subtotalMaterials: subtotalMaterials.toString(),
        total: total.toString(),
      };

      // Update notes if provided
      if (input.notes !== undefined) {
        updateData.notes = input.notes.trim() || null;
      }

      const [updated] = await ctx.db
        .update(quotes)
        .set(updateData)
        .where(eq(quotes.id, quote.id))
        .returning();

      return updated;
    }),

  /**
   * Get quote email content
   */
  getQuoteEmailContent: hasDashboardAccess
    .input(
      z.object({
        quoteId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // Get quote with job and foreman
      const [quote] = await ctx.db
        .select({
          id: quotes.id,
          markupPercent: quotes.markupPercent,
          subtotalMaterials: quotes.subtotalMaterials,
          total: quotes.total,
          notes: quotes.notes,
          job: {
            id: jobs.id,
            name: jobs.name,
            poNumber: jobs.poNumber,
          },
          foreman: {
            id: users.id,
            name: users.name,
          },
        })
        .from(quotes)
        .leftJoin(jobs, eq(quotes.jobId, jobs.id))
        .leftJoin(users, eq(jobs.foremanUserId, users.id))
        .where(
          and(
            eq(quotes.id, input.quoteId),
            eq(quotes.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!quote) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Quote not found",
        });
      }

      // Get quote items
      const items = await ctx.db
        .select({
          descriptionSnapshot: quoteItems.descriptionSnapshot,
          partDefinitionDisplayName: partDefinitions.displayName,
          partDefinitionPiecesPerPack: partDefinitions.piecesPerPack,
          partDefinitionBulkUnit: partDefinitions.bulkUnit,
          partDefinitionIndividualUnit: partDefinitions.individualUnit,
          quantity: quoteItems.quantity,
          extendedPrice: quoteItems.extendedPrice,
          unitCost: quoteItems.unitCost,
          packSize: supplierParts.packSize,
        })
        .from(quoteItems)
        .leftJoin(
          partDefinitions,
          eq(quoteItems.partDefinitionId, partDefinitions.id),
        )
        .leftJoin(supplierParts, eq(quoteItems.supplierPartId, supplierParts.id))
        .where(eq(quoteItems.quoteId, input.quoteId));

      const foremanName = quote.foreman?.name || "Foreman";
      const jobName = quote.job?.name || "Job";
      const markupPercent = quote.markupPercent
        ? parseFloat(quote.markupPercent.toString())
        : 0;
      const markupMultiplier = 1 + markupPercent / 100;
      const total = quote.total ? parseFloat(quote.total.toString()) : 0;

      // Build email body with adjusted prices (markup already included)
      let adjustedTotal = 0;
      const lineItems = items
        .map((item) => {
          const ordered = purchaseQuantity(item.quantity, item.packSize, item.partDefinitionPiecesPerPack);
          const qty = packContents(item.partDefinitionPiecesPerPack) > 1 ? formatOrderedBulkQuantity(ordered, item.partDefinitionPiecesPerPack, item.partDefinitionBulkUnit, item.partDefinitionIndividualUnit) : formatPurchaseQuantity(item.quantity, ordered);
          const basePrice = purchaseLineTotal(item.quantity, item.unitCost, item.packSize, item.partDefinitionPiecesPerPack);
          // Apply markup to get the customer-facing price
          const adjustedPrice = basePrice * markupMultiplier;
          adjustedTotal += adjustedPrice;
          const description =
            item.descriptionSnapshot?.trim() ||
            item.partDefinitionDisplayName?.trim() ||
            "Item";
          return userCan(ctx.user, "financial.view")
            ? `- ${description} × ${qty}     $${adjustedPrice.toFixed(2)}`
            : `- ${description} × ${qty}`;
        })
        .join("\n");

      // Use the calculated total (should match quote.total, but use it for consistency)
      const finalTotal = adjustedTotal > 0 ? adjustedTotal : total;

      const subject = `Quote – ${jobName}`;
      let body = `Hi,

Here's the materials quote for the ${jobName}:

${lineItems}${userCan(ctx.user, "financial.view") ? `\n-----------------------------\nTotal: $${finalTotal.toFixed(2)}` : ""}`;

      // Add notes from quote if available
      if (quote.notes && quote.notes.trim()) {
        body += `\n\nNotes:\n${quote.notes.trim()}`;
      }

      body += `\n\nLet me know if you'd like to move forward.

Thanks,
${foremanName}`;

      return { subject, body };
    }),

  /**
   * Preview possible supplier orders plus already-sent orders.
   * Does not persist draft orders.
   */
  previewOrders: hasDashboardAccess
    .input(z.object({ materialListId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const [materialList] = await ctx.db
        .select({
          id: materialLists.id,
          kind: materialLists.kind,
          quoteId: materialLists.quoteId,
          jobId: materialLists.jobId,
          jobName: jobs.name,
          jobPoNumber: jobs.poNumber,
          locationName: locations.name,
          locationAddress1: locations.address1,
          locationAddress2: locations.address2,
          locationCity: locations.city,
          locationRegion: locations.region,
          locationPostalCode: locations.postalCode,
          locationCountry: locations.country,
        })
        .from(materialLists)
        .leftJoin(jobs, eq(materialLists.jobId, jobs.id))
        .leftJoin(locations, eq(jobs.locationId, locations.id))
        .where(
          and(
            eq(materialLists.id, input.materialListId),
            eq(materialLists.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!materialList) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Material list not found",
        });
      }
      // Anyone can send a tool request to the tool room; supplier orders
      // stay limited to accounts that may generate documents.
      const isToolRequest = materialList.kind === "tools";
      if (!isToolRequest) assertCan(ctx.user, "orders.send");

      if (!materialList.quoteId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Quote not found for material list",
        });
      }

      const [quote] = await ctx.db
        .select({ id: quotes.id })
        .from(quotes)
        .where(eq(quotes.id, materialList.quoteId))
        .limit(1);

      if (!quote) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Quote not found for material list",
        });
      }

      const quoteItemsList = await loadOrderableQuoteItems(ctx.db, quote.id);
      // Every tool on a tool request goes to the organization's tool room,
      // minus anything this list has already requested.
      const toolItems = isToolRequest
        ? await withoutAlreadyRequestedTools(
            ctx.db,
            materialList.id,
            quoteItemsList,
          )
        : [];
      const orderableItemsBySupplier = isToolRequest
        ? new Map(
            toolItems.length
              ? [
                  [
                    await ensureToolRoomSupplier(
                      ctx.db,
                      ctx.user.organizationId,
                    ),
                    toolItems,
                  ],
                ]
              : [],
          )
        : groupOrderableItemsBySupplier(quoteItemsList);

      const sentOrders = await ctx.db
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          notes: orders.notes,
          sentAt: orders.sentAt,
          fulfillmentStatus: orders.fulfillmentStatus,
          supplierId: orders.supplierId,
          supplierName: suppliers.name,
          supplierContactName: suppliers.contactName,
          supplierContactEmail: suppliers.contactEmail,
          supplierContacts: suppliers.contacts,
        })
        .from(orders)
        .leftJoin(suppliers, eq(orders.supplierId, suppliers.id))
        .where(
          and(
            eq(orders.materialListId, input.materialListId),
            eq(orders.organizationId, ctx.user.organizationId),
            eq(orders.status, "sent"),
          ),
        )
        .orderBy(desc(orders.sentAt), desc(orders.createdAt));

      const sentOrderIds = sentOrders.map((order) => order.id);
      const sentItemRows = sentOrderIds.length
        ? await ctx.db
            .select({
              id: orderItems.id,
              roomId: orderItems.roomId,
              roomName: jobRooms.name,
              orderId: orderItems.orderId,
              quantity: orderItems.quantity,
              requestedQuantity: orderItems.requestedQuantity,
              descriptionSnapshot: orderItems.descriptionSnapshot,
              supplierSkuSnapshot: orderItems.supplierSkuSnapshot,
              partDefinitionDisplayName: partDefinitions.displayName,
              partDefinitionPiecesPerPack: partDefinitions.piecesPerPack,
              partDefinitionBulkUnit: partDefinitions.bulkUnit,
              partDefinitionIndividualUnit: partDefinitions.individualUnit,
            })
            .from(orderItems)
            .leftJoin(jobRooms, eq(orderItems.roomId, jobRooms.id))
            .leftJoin(
              partDefinitions,
              eq(orderItems.partDefinitionId, partDefinitions.id),
            )
            .where(inArray(orderItems.orderId, sentOrderIds))
        : [];
      const sentItemsByOrderId = new Map<string, typeof sentItemRows>();
      for (const item of sentItemRows) {
        const bucket = sentItemsByOrderId.get(item.orderId) ?? [];
        bucket.push(item);
        sentItemsByOrderId.set(item.orderId, bucket);
      }

      const possibleSupplierIds = Array.from(orderableItemsBySupplier.keys());
      const possibleSupplierRows = possibleSupplierIds.length
        ? await ctx.db
            .select({
              id: suppliers.id,
              name: suppliers.name,
              contactName: suppliers.contactName,
              contactEmail: suppliers.contactEmail,
              contacts: suppliers.contacts,
            })
            .from(suppliers)
            .where(inArray(suppliers.id, possibleSupplierIds))
        : [];
      const possibleSuppliersById = new Map(
        possibleSupplierRows.map((supplier) => [supplier.id, supplier]),
      );

      const jobName = materialList.jobName || "Job";
      const deliveryAddress = formatOneLineAddress({
        name: materialList.locationName,
        address1: materialList.locationAddress1,
        address2: materialList.locationAddress2,
        city: materialList.locationCity,
        region: materialList.locationRegion,
        postalCode: materialList.locationPostalCode,
        country: materialList.locationCountry,
      });
      const foremanName = ctx.user.name || "Foreman";
      const deliveryDate = await userDeliveryDate(ctx.db, ctx.user.id);

      const possible = possibleSupplierIds.map((supplierId) => {
        const supplier = possibleSuppliersById.get(supplierId) ?? null;
        const items = orderableItemsBySupplier.get(supplierId) ?? [];
        const supplierContacts = normalizeSupplierContacts(supplier?.contacts, {
          contactName: supplier?.contactName ?? supplier?.name ?? null,
          contactEmail: supplier?.contactEmail ?? null,
        });
        const recipients = getSupplierEmailRecipients(supplierContacts);
        const supplierContactName =
          formatSupplierGreetingName(supplierContacts) ||
          firstName(supplier?.contactName || supplier?.name);
        const poNumber =
          materialList.jobPoNumber?.trim() ||
          `ORDER-${(supplier?.name || "Supplier").replace(/\s+/g, "").slice(0, 12)}`;
        const email = buildOrderEmailContent({
          jobName,
          poNumber,
          deliveryAddress,
          deliveryDate,
          supplierContactName,
          items,
          foremanName,
        });

        return {
          id: `preview:${supplierId}`,
          supplierId,
          orderNumber: null,
          notes: null,
          sentAt: null,
          supplier: supplier
            ? {
                id: supplier.id,
                name: supplier.name,
                contactEmail: supplier.contactEmail,
                contacts: supplier.contacts,
              }
            : null,
          items: items.map((item) => ({
            id: item.id,
            roomId: item.roomId,
            roomName: item.roomName,
            quantity: item.quantity,
            requestedQuantity: item.requestedQuantity ?? item.quantity,
            descriptionSnapshot:
              item.descriptionSnapshot?.trim() ||
              item.partDefinitionDisplayName?.trim() ||
              null,
            supplierSkuSnapshot: item.supplierSku ?? null,
          })),
          email: {
            ...email,
            to: recipients.to,
            cc: recipients.cc,
          },
        };
      });

      const sent = sentOrders.map((order) => {
        const items = (sentItemsByOrderId.get(order.id) ?? []).map(
          ({ orderId: _orderId, partDefinitionDisplayName, ...item }) => ({
            ...item,
            descriptionSnapshot:
              item.descriptionSnapshot?.trim() ||
              partDefinitionDisplayName?.trim() ||
              null,
          }),
        );
        const supplierContacts = normalizeSupplierContacts(
          order.supplierContacts,
          {
            contactName:
              order.supplierContactName ?? order.supplierName ?? null,
            contactEmail: order.supplierContactEmail ?? null,
          },
        );
        const recipients = getSupplierEmailRecipients(supplierContacts);
        const supplierContactName =
          formatSupplierGreetingName(supplierContacts) ||
          firstName(order.supplierContactName || order.supplierName);
        const poNumber =
          materialList.jobPoNumber?.trim() ||
          order.orderNumber?.trim() ||
          `ORDER-${order.id.slice(0, 8)}`;
        const email = buildOrderEmailContent({
          jobName,
          poNumber,
          deliveryAddress,
          deliveryDate,
          supplierContactName,
          items,
          notes: order.notes,
          foremanName,
        });

        return {
          id: order.id,
          supplierId: order.supplierId,
          orderNumber: order.orderNumber,
          notes: order.notes,
          sentAt: order.sentAt,
          fulfillmentStatus: order.fulfillmentStatus,
          supplier: order.supplierId
            ? {
                id: order.supplierId,
                name: order.supplierName ?? "",
                contactEmail: order.supplierContactEmail,
                contacts: order.supplierContacts,
              }
            : null,
          items,
          email: {
            ...email,
            to: recipients.to,
            cc: recipients.cc,
          },
        };
      });

      return { possible, sent, listKind: materialList.kind };
    }),

  /**
   * Persist a possible order as sent. No draft records are created.
   */
  sendGeneratedOrder: hasDashboardAccess
    .input(
      z.object({
        materialListId: z.string().uuid(),
        supplierId: z.string().uuid(),
        sentTo: z.string().min(1).max(1000),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const [materialList] = await ctx.db
        .select({
          id: materialLists.id,
          kind: materialLists.kind,
          quoteId: materialLists.quoteId,
          jobId: materialLists.jobId,
        })
        .from(materialLists)
        .where(
          and(
            eq(materialLists.id, input.materialListId),
            eq(materialLists.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!materialList) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Material list not found",
        });
      }

      const isToolRequest = materialList.kind === "tools";
      if (!isToolRequest) assertCan(ctx.user, "orders.send");
      const toolRoomSupplierId = isToolRequest
        ? await ensureToolRoomSupplier(ctx.db, ctx.user.organizationId)
        : null;
      if (isToolRequest && input.supplierId !== toolRoomSupplierId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Tool requests go to the tool room.",
        });
      }

      if (!materialList.quoteId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Quote not found for material list",
        });
      }

      const result = await ctx.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`${ctx.user.organizationId}:${materialList.jobId}:orders`}))`,
        );
        // Serialize sending against edits and simultaneous sends of the same rows.
        await tx.select({ id: quoteItems.id }).from(quoteItems)
          .where(eq(quoteItems.quoteId, materialList.quoteId!)).orderBy(quoteItems.id).for("update");
        const quoteItemsList = await loadOrderableQuoteItems(tx, materialList.quoteId!);
        const items = isToolRequest
          ? await withoutAlreadyRequestedTools(tx, input.materialListId, quoteItemsList)
          : (groupOrderableItemsBySupplier(quoteItemsList).get(input.supplierId) ?? []);
        if (!items.length) throw new TRPCError({ code: "BAD_REQUEST", message: "No unsent items remain for this supplier. Duplicate the list to reorder." });

        const [existingOrderCountResult] = await tx
          .select({
            count: sql<number>`coalesce(max(substring(${orders.orderNumber} from '([0-9]{1,9})$')::int), 0)::int`,
          })
          .from(orders)
          .where(
            and(
              eq(orders.jobId, materialList.jobId),
              eq(orders.organizationId, ctx.user.organizationId),
              // Tool requests are numbered separately (TOOLS-001, …).
              isToolRequest
                ? eq(orders.kind, "tool_request")
                : eq(orders.kind, "materials"),
            ),
          );

        const createdOrderSequence =
          Number(existingOrderCountResult?.count ?? 0) + 1;

        const [createdOrder] = await tx
          .insert(orders)
          .values({
            organizationId: ctx.user.organizationId,
            jobId: materialList.jobId,
            materialListId: input.materialListId,
            orderNumber: `${isToolRequest ? "TOOLS" : "ORDER"}-${String(createdOrderSequence).padStart(3, "0")}`,
            supplierId: input.supplierId,
            createdByUserId: ctx.userId,
            status: "sent",
            kind: isToolRequest ? "tool_request" : "materials",
            fulfillmentStatus: isToolRequest ? "open" : null,
            sentVia: isToolRequest ? "tool_room" : "email",
            sentTo: input.sentTo,
            sentAt: new Date(),
            notes: input.notes?.trim() || null,
          })
          .returning();

        if (!createdOrder) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create order",
          });
        }

        for (const item of items) {
          const orderItemId = crypto.randomUUID();
          await tx.insert(orderItems).values({
            id: orderItemId,
            orderId: createdOrder.id,
            roomId: item.roomId,
            supplierPartId: item.supplierPartId ?? undefined,
            partDefinitionId: item.partDefinitionId!,
            quantity: item.quantity ?? "1",
            requestedQuantity: item.requestedQuantity ?? item.quantity,
            orderMultipleSnapshot: item.orderMultipleSnapshot ?? null,
            uomId: item.uomId ?? undefined,
            unitCostAtOrderTime: item.unitCost ?? undefined,
            descriptionSnapshot:
              item.descriptionSnapshot?.trim() ||
              item.partDefinitionDisplayName?.trim() ||
              undefined,
            supplierSkuSnapshot: item.supplierSku ?? undefined,
          });
          if (!isToolRequest) await tx.update(quoteItems).set({ sentOrderItemId: orderItemId, extendedPrice: String(purchaseLineTotal(item.quantity, item.unitCost)), updatedAt: new Date() })
            .where(eq(quoteItems.id, item.id));
        }


        return createdOrder;
      });
      publishMaterialListEvent(input.materialListId, "updated", ctx.user.organizationId);
      return result;
    }),

  /**
   * Get order email content
   */
  getOrderEmailContent: hasDashboardAccess
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // Get order with job and supplier
      const [order] = await ctx.db
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          notes: orders.notes,
          job: {
            id: jobs.id,
            name: jobs.name,
            poNumber: jobs.poNumber,
          },
          supplier: {
            id: suppliers.id,
            name: suppliers.name,
            contactName: suppliers.contactName,
            contactEmail: suppliers.contactEmail,
            contacts: suppliers.contacts,
          },
          location: {
            name: locations.name,
            address1: locations.address1,
            address2: locations.address2,
            city: locations.city,
            region: locations.region,
            postalCode: locations.postalCode,
            country: locations.country,
          },
        })
        .from(orders)
        .leftJoin(jobs, eq(orders.jobId, jobs.id))
        .leftJoin(suppliers, eq(orders.supplierId, suppliers.id))
        .leftJoin(locations, eq(jobs.locationId, locations.id))
        .where(
          and(
            eq(orders.id, input.orderId),
            eq(orders.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!order) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Order not found",
        });
      }

      // Get order items
      const items = await ctx.db
        .select({
          descriptionSnapshot: orderItems.descriptionSnapshot,
          partDefinitionDisplayName: partDefinitions.displayName,
          partDefinitionPiecesPerPack: partDefinitions.piecesPerPack,
          partDefinitionBulkUnit: partDefinitions.bulkUnit,
          partDefinitionIndividualUnit: partDefinitions.individualUnit,
          quantity: orderItems.quantity,
        })
        .from(orderItems)
        .leftJoin(
          partDefinitions,
          eq(orderItems.partDefinitionId, partDefinitions.id),
        )
        .where(eq(orderItems.orderId, input.orderId));

      const jobName = order.job?.name || "Job";
      const supplierContacts = normalizeSupplierContacts(
        order.supplier?.contacts,
        {
          contactName:
            order.supplier?.contactName ?? order.supplier?.name ?? null,
          contactEmail: order.supplier?.contactEmail ?? null,
        },
      );
      const recipients = getSupplierEmailRecipients(supplierContacts);
      const supplierContactName =
        formatSupplierGreetingName(supplierContacts) ||
        firstName(order.supplier?.contactName || order.supplier?.name);
      const poNumber =
        order.job?.poNumber?.trim() ||
        order.orderNumber?.trim() ||
        `ORDER-${order.id.slice(0, 8)}`;
      const deliveryDate = await userDeliveryDate(ctx.db, ctx.user.id);
      const formattedDeliveryDate = formatDeliveryDate(deliveryDate);
      const deliveryAddress = formatOneLineAddress(order.location ?? {});

      const lineItems = items.map(formatEmailItemLine).join("\n");

      const sections = [
        `Hello${supplierContactName ? ` ${supplierContactName}` : ""},`,
        "",
        `Job: ${jobName}`,
        `PO#: ${poNumber}`,
        `Address: ${deliveryAddress || ""}`,
        `Delivery Date: ${formattedDeliveryDate}`,
        "",
        lineItems || "No items",
        ...(order.notes?.trim() ? ["", "Notes:", order.notes.trim()] : []),
        "",
        "Thanks,",
        ctx.user.name || "Foreman",
      ];

      const subject = `Material Order ${poNumber} - ${jobName}`;
      const body = sections.join("\n");

      return { subject, body, to: recipients.to, cc: recipients.cc };
    }),

  /**
   * Mark order as sent
   */
  markOrderSent: hasDashboardAccess
    .input(
      z.object({
        orderId: z.string().uuid(),
        sentTo: z.string().min(1).max(1000),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.user, "orders.send");
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // Verify order exists and belongs to organization
      const [existing] = await ctx.db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.id, input.orderId),
            eq(orders.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Order not found",
        });
      }

      // Update order
      const updateData: {
        status: string;
        sentVia: string;
        sentTo: string;
        sentAt: Date;
        notes?: string | null;
      } = {
        status: "sent",
        sentVia: "email",
        sentTo: input.sentTo,
        sentAt: new Date(),
      };

      // Update notes if provided
      if (input.notes !== undefined) {
        updateData.notes = input.notes.trim() || null;
      }

      const [updated] = await ctx.db
        .update(orders)
        .set(updateData)
        .where(eq(orders.id, input.orderId))
        .returning();

      return updated;
    }),

  /**
   * Get all quotes for a material list
   */
  getQuotesForMaterialList: hasDashboardAccess
    .input(z.object({ materialListId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // Verify material list exists and belongs to organization
      const [materialList] = await ctx.db
        .select({ id: materialLists.id, jobId: materialLists.jobId })
        .from(materialLists)
        .where(
          and(
            eq(materialLists.id, input.materialListId),
            eq(materialLists.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!materialList) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Material list not found",
        });
      }

      // Get all quotes for this material list
      const quotesList = await ctx.db
        .select({
          id: quotes.id,
          quoteNumber: quotes.quoteNumber,
          total: quotes.total,
          createdAt: quotes.createdAt,
        })
        .from(quotes)
        .where(
          and(
            eq(quotes.materialListId, input.materialListId),
            eq(quotes.organizationId, ctx.user.organizationId),
            sql<boolean>`${quotes}."generatedAt" is not null`,
          ),
        )
        .orderBy(desc(quotes.createdAt));

      return quotesList;
    }),

  /**
   * Get all orders for a material list (via job)
   */
  getOrdersForMaterialList: hasDashboardAccess
    .input(z.object({ materialListId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // Verify material list exists and belongs to organization
      const [materialList] = await ctx.db
        .select({ id: materialLists.id, jobId: materialLists.jobId })
        .from(materialLists)
        .where(
          and(
            eq(materialLists.id, input.materialListId),
            eq(materialLists.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!materialList) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Material list not found",
        });
      }

      // Get all orders created from this material list
      const ordersList = await ctx.db
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          status: orders.status,
          createdAt: orders.createdAt,
          supplierId: suppliers.id,
          supplierName: suppliers.name,
        })
        .from(orders)
        .leftJoin(suppliers, eq(orders.supplierId, suppliers.id))
        .where(
          and(
            eq(orders.materialListId, input.materialListId),
            eq(orders.organizationId, ctx.user.organizationId),
            eq(orders.status, "sent"),
          ),
        )
        .orderBy(desc(orders.createdAt));

      // Transform to include supplier object
      return ordersList.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        createdAt: order.createdAt,
        supplier: order.supplierId
          ? {
              id: order.supplierId,
              name: order.supplierName ?? "",
            }
          : null,
      }));
    }),

  /**
   * Get a specific quote by ID
   */
  getQuoteById: hasDashboardAccess
    .input(z.object({ quoteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const [quote] = await ctx.db
        .select({
          id: quotes.id,
          quoteNumber: quotes.quoteNumber,
          markupPercent: quotes.markupPercent,
          notes: quotes.notes,
          subtotalMaterials: quotes.subtotalMaterials,
          total: quotes.total,
          createdAt: quotes.createdAt,
          materialListId: quotes.materialListId,
          jobId: quotes.jobId,
        })
        .from(quotes)
        .where(
          and(
            eq(quotes.id, input.quoteId),
            eq(quotes.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!quote) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Quote not found",
        });
      }

      return quote;
    }),

  /**
   * List all quotes for the organization
   */
  listQuotes: hasDashboardAccess.query(async ({ ctx }) => {
    if (!ctx.user.organizationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "User must belong to an organization",
      });
    }

    const quotesList = await ctx.db
      .select({
        id: quotes.id,
        quoteNumber: quotes.quoteNumber,
        total: quotes.total,
        createdAt: quotes.createdAt,
        materialListId: quotes.materialListId,
        materialListName: materialLists.name,
        jobId: quotes.jobId,
        jobName: jobs.name,
      })
      .from(quotes)
      .leftJoin(materialLists, eq(quotes.materialListId, materialLists.id))
      .leftJoin(jobs, eq(quotes.jobId, jobs.id))
      .where(and(
        eq(quotes.organizationId, ctx.user.organizationId),
        sql<boolean>`${quotes}."generatedAt" is not null`,
      ))
      .orderBy(desc(quotes.createdAt));

    return quotesList;
  }),

  /**
   * Get a specific order by ID with items
   */
  getOrderById: hasDashboardAccess
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const [order] = await ctx.db
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          status: orders.status,
          notes: orders.notes,
          createdAt: orders.createdAt,
          sentAt: orders.sentAt,
          materialListId: orders.materialListId,
          supplierId: orders.supplierId,
          supplierName: suppliers.name,
          supplierContactEmail: suppliers.contactEmail,
          supplierContacts: suppliers.contacts,
        })
        .from(orders)
        .leftJoin(suppliers, eq(orders.supplierId, suppliers.id))
        .where(
          and(
            eq(orders.id, input.orderId),
            eq(orders.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!order) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Order not found",
        });
      }

      // Get order items
      const items = await ctx.db
        .select({
          id: orderItems.id,
          roomId: orderItems.roomId,
          roomName: jobRooms.name,
          supplierPartId: orderItems.supplierPartId,
          partDefinitionId: orderItems.partDefinitionId,
          quantity: orderItems.quantity,
          requestedQuantity: orderItems.requestedQuantity,
          orderMultipleSnapshot: orderItems.orderMultipleSnapshot,
          receivedQuantity: orderItems.receivedQuantity,
          verificationStatus: orderItems.verificationStatus,
          descriptionSnapshot: orderItems.descriptionSnapshot,
          partDefinitionDisplayName: partDefinitions.displayName,
          partDefinitionPiecesPerPack: partDefinitions.piecesPerPack,
          partDefinitionBulkUnit: partDefinitions.bulkUnit,
          partDefinitionIndividualUnit: partDefinitions.individualUnit,
          supplierSkuSnapshot: orderItems.supplierSkuSnapshot,
        })
        .from(orderItems)
        .leftJoin(jobRooms, eq(orderItems.roomId, jobRooms.id))
        .leftJoin(
          partDefinitions,
          eq(orderItems.partDefinitionId, partDefinitions.id),
        )
        .where(eq(orderItems.orderId, input.orderId));

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        notes: order.notes,
        createdAt: order.createdAt,
        sentAt: order.sentAt,
        materialListId: order.materialListId,
        supplier: order.supplierId
          ? {
              id: order.supplierId,
              name: order.supplierName ?? "",
              contactEmail: order.supplierContactEmail,
              contacts: order.supplierContacts,
            }
          : null,
        items: items.map((item) => ({
          id: item.id,
          roomId: item.roomId,
          roomName: item.roomName,
          supplierPartId: item.supplierPartId,
          partDefinitionId: item.partDefinitionId,
          quantity: item.quantity,
          receivedQuantity: item.receivedQuantity,
          verificationStatus: item.verificationStatus,
          descriptionSnapshot:
            item.descriptionSnapshot?.trim() ||
            item.partDefinitionDisplayName?.trim() ||
            null,
          supplierSkuSnapshot: item.supplierSkuSnapshot,
        })),
      };
    }),

  /**
   * Update verification state for a single order item.
   */
  updateOrderItemVerification: hasDashboardAccess
    .input(
      z.object({
        orderItemId: z.string().uuid(),
        receivedQuantity: z.number().min(0),
        verificationStatus: z.enum([
          "pending",
          "partial",
          "complete",
          "problem",
        ]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.user, "orders.receive");
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const [existing] = await ctx.db
        .select({ id: orderItems.id, materialListId: orders.materialListId })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(
          and(
            eq(orderItems.id, input.orderItemId),
            eq(orders.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Order item not found",
        });
      }

      const [updated] = await ctx.db
        .update(orderItems)
        .set({
          receivedQuantity: input.receivedQuantity.toString(),
          verificationStatus: input.verificationStatus,
        })
        .where(eq(orderItems.id, input.orderItemId))
        .returning({
          id: orderItems.id,
          receivedQuantity: orderItems.receivedQuantity,
          verificationStatus: orderItems.verificationStatus,
        });

      if (existing.materialListId) publishMaterialListEvent(existing.materialListId, "updated", ctx.user.organizationId);
      return updated;
    }),

  /**
   * Update internal notes for an order.
   */
  updateOrderNotes: hasDashboardAccess
    .input(
      z.object({
        orderId: z.string().uuid(),
        notes: z.string().max(10000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.user, "orders.receive");
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const [updated] = await ctx.db
        .update(orders)
        .set({ notes: input.notes?.trim() || null })
        .where(
          and(
            eq(orders.id, input.orderId),
            eq(orders.organizationId, ctx.user.organizationId),
          ),
        )
        .returning({
          id: orders.id,
          notes: orders.notes,
        });

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Order not found",
        });
      }

      return updated;
    }),

  /**
   * List all orders for the organization with material lists
   */
  listOrders: hasDashboardAccess
    .input(z.object({ summary: z.boolean() }).optional())
    .query(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // Orders and their items load together; the item query joins on the same
      // organization/status filter instead of sending every order id back.
      const sentOrderFilter = and(
        eq(orders.organizationId, ctx.user.organizationId),
        eq(orders.status, "sent"),
        // Tool requests and returns live in Asset Management.
        eq(orders.kind, "materials"),
      );
      const [ordersList, itemRows] = await Promise.all([
        ctx.db
          .select({
            id: orders.id,
            orderNumber: orders.orderNumber,
            status: orders.status,
            notes: orders.notes,
            createdAt: orders.createdAt,
            sentAt: orders.sentAt,
            sentTo: orders.sentTo,
            jobId: orders.jobId,
            jobName: jobs.name,
            materialListId: materialLists.id,
            materialListName: materialLists.name,
            supplierId: orders.supplierId,
            supplierName: suppliers.name,
            supplierContactEmail: suppliers.contactEmail,
            supplierContacts: suppliers.contacts,
          })
          .from(orders)
          .leftJoin(jobs, eq(orders.jobId, jobs.id))
          .leftJoin(materialLists, eq(orders.materialListId, materialLists.id))
          .leftJoin(suppliers, eq(orders.supplierId, suppliers.id))
          .where(sentOrderFilter)
          .orderBy(desc(orders.createdAt)),
        ctx.db
          .select({
            orderId: orderItems.orderId,
            roomId: orderItems.roomId,
            roomName: jobRooms.name,
            quantity: orderItems.quantity,
            descriptionSnapshot: orderItems.descriptionSnapshot,
            supplierSkuSnapshot: orderItems.supplierSkuSnapshot,
            partDefinitionDisplayName: partDefinitions.displayName,
            partDefinitionPiecesPerPack: partDefinitions.piecesPerPack,
            partDefinitionBulkUnit: partDefinitions.bulkUnit,
            partDefinitionIndividualUnit: partDefinitions.individualUnit,
          })
          .from(orderItems)
          .leftJoin(jobRooms, eq(orderItems.roomId, jobRooms.id))
          .innerJoin(orders, eq(orderItems.orderId, orders.id))
          .leftJoin(
            partDefinitions,
            eq(orderItems.partDefinitionId, partDefinitions.id),
          )
          .where(sentOrderFilter),
      ]);

      const itemsByOrderId = new Map<string, typeof itemRows>();
      for (const item of itemRows) {
        const bucket = itemsByOrderId.get(item.orderId) ?? [];
        bucket.push(item);
        itemsByOrderId.set(item.orderId, bucket);
      }

      return ordersList.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        notes: order.notes,
        createdAt: order.createdAt,
        sentAt: order.sentAt,
        sentTo: order.sentTo,
        job: {
          id: order.jobId,
          name: order.jobName ?? "",
        },
        supplier: order.supplierId
          ? {
              id: order.supplierId,
              name: order.supplierName ?? "",
              contactEmail: order.supplierContactEmail,
              contacts: order.supplierContacts,
            }
          : null,
        materialList: order.materialListId
          ? {
              id: order.materialListId,
              name: order.materialListName ?? "",
            }
          : null,
        // Current clients search this compact text and load email details on demand.
        // Preserve item arrays for cached/older clients that omit the summary flag.
        searchableItems: input?.summary
          ? (itemsByOrderId.get(order.id) ?? [])
              .flatMap((item) => [
                item.roomName,
                item.quantity,
                item.descriptionSnapshot?.trim() ||
                  item.partDefinitionDisplayName?.trim(),
                item.supplierSkuSnapshot,
              ])
              .filter(Boolean)
              .join(" ")
          : undefined,
        items: input?.summary
          ? []
          : (itemsByOrderId.get(order.id) ?? []).map((item) => ({
              roomId: item.roomId,
              roomName: item.roomName,
              quantity: item.quantity,
              description:
                item.descriptionSnapshot?.trim() ||
                item.partDefinitionDisplayName?.trim() ||
                null,
              supplierSku: item.supplierSkuSnapshot,
            })),
      }));
    }),
});

import { userCan } from "~/server/auth/permissions";
import {
  resolveDefaultSupplier,
  supplierVersionPrice,
} from "~/server/job-supplier-defaults";
import { materialListProgress } from "~/lib/material-list-progress";
import { materialListOrderStatuses } from "~/lib/material-list-order-status";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { retiredOfflineMutation } from "../retired-offline-sync";

import { createTRPCRouter, hasAppAccess } from "~/server/api/trpc";
import {
  jobRooms,
  jobs,
  locations,
  materialLists,
  orderItems,
  orders,
  quoteItems,
  supplierParts,
  suppliers,
  users,
} from "~/server/db/schema";

export const jobRouter = createTRPCRouter({
  previewSupplierDefault: hasAppAccess
    .input(z.object({ jobId: z.string().uuid(), partId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const org = ctx.user.organizationId;
      if (!org) throw new TRPCError({ code: "FORBIDDEN" });
      const version = await resolveDefaultSupplier(
        ctx.db,
        org,
        input.jobId,
        input.partId,
      );
      if (!version) return null;
      const price = await supplierVersionPrice(
        ctx.db,
        org,
        version,
        input.partId,
      );
      return {
        version,
        ...price,
        unitCost: userCan(ctx.user, "financial.view") ? price.unitCost : null,
        listing: price.listing
          ? {
              ...price.listing,
              unitCost: userCan(ctx.user, "financial.view")
                ? price.listing.unitCost
                : null,
            }
          : undefined,
      };
    }),
  supplierDefaultOptions: hasAppAccess
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const org = ctx.user.organizationId;
      if (!org) throw new TRPCError({ code: "FORBIDDEN" });
      const [job] = await ctx.db.execute<{
        supplierDefaults:
          | import("~/lib/job-supplier-defaults").JobSupplierDefaults
          | null;
      }>(
        sql`select "supplierDefaults" from kublai_job where id=${input.jobId} and "organizationId"=${org}`,
      );
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });
      const options = await ctx.db.execute<{
        supplierId: string;
        bookId: string | null;
        label: string;
      }>(sql`select s.id as "supplierId",null::uuid as "bookId",s.name as label from kublai_supplier s where s."organizationId"=${org} and coalesce(s.kind,'supplier')<>'tool_room'
      union all select s.id,b.id,s.name || ' - ' || b.name from kublai_supplier s join kublai_supplier_price_book b on b."supplierId"=s.id and b."organizationId"=${org} where s."organizationId"=${org} and coalesce(s.kind,'supplier')<>'tool_room' order by label`);
      return { defaults: job.supplierDefaults, options: [...options] };
    }),
  syncEntityMutations: retiredOfflineMutation,

  /**
   * Get a single job with material lists
   */
  getJob: hasAppAccess
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const [job] = await ctx.db
        .select({
          id: jobs.id,
          name: jobs.name,
          poNumber: jobs.poNumber,
          supplierDefaults: sql<
            import("~/lib/job-supplier-defaults").JobSupplierDefaults | null
          >`${jobs}."supplierDefaults"`,
          locationId: jobs.locationId,
          foremanUserId: jobs.foremanUserId,
          foremanName: jobs.foremanName,
          status: jobs.status,
          createdAt: jobs.createdAt,
          location: {
            id: locations.id,
            name: locations.name,
            address1: locations.address1,
            address2: locations.address2,
            city: locations.city,
            region: locations.region,
            postalCode: locations.postalCode,
            country: locations.country,
          },
          foreman: {
            id: users.id,
            name: sql<string>`coalesce(${jobs.foremanName}, ${users.name})`,
          },
        })
        .from(jobs)
        .leftJoin(locations, eq(jobs.locationId, locations.id))
        .leftJoin(users, eq(jobs.foremanUserId, users.id))
        .where(
          and(
            eq(jobs.id, input.jobId),
            eq(jobs.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!job) {
        return null;
      }

      // Get material lists for this job
      const lists = await ctx.db
        .select({
          id: materialLists.id,
          name: materialLists.name,
          roomId: materialLists.roomId,
          roomName: jobRooms.name,
          kind: materialLists.kind,
          quoteId: materialLists.quoteId,
          createdAt: materialLists.createdAt,
        })
        .from(materialLists)
        .leftJoin(jobRooms, eq(materialLists.roomId, jobRooms.id))
        .where(
          and(
            eq(materialLists.jobId, input.jobId),
            eq(materialLists.organizationId, ctx.user.organizationId),
          ),
        )
        .orderBy(desc(materialLists.createdAt));

      const listIds = lists.map((list) => list.id);
      const quoteIds = lists
        .map((list) => list.quoteId)
        .filter((value): value is string => Boolean(value));

      const [supplierRows, orderRows] = await Promise.all([
        quoteIds.length
          ? ctx.db
              .select({
                quoteId: quoteItems.quoteId,
                quantity: quoteItems.quantity,
                sentQuantity: orderItems.quantity,
                receivedQuantity: orderItems.receivedQuantity,
                verificationStatus: orderItems.verificationStatus,
                sentOrderStatus: orders.status,
                sentAt: orders.sentAt,
                sentOrderId: orders.id,
                supplierName: suppliers.name,
                selectedSupplierId: quoteItems.supplierId,
                supplierPartSupplierId: supplierParts.supplierId,
                partDefinitionId: quoteItems.partDefinitionId,
              })
              .from(quoteItems)
              .leftJoin(
                supplierParts,
                eq(quoteItems.supplierPartId, supplierParts.id),
              )
              .leftJoin(
                suppliers,
                eq(
                  suppliers.id,
                  sql`coalesce(${quoteItems.supplierId}, ${supplierParts.supplierId})`,
                ),
              )
              .leftJoin(
                orderItems,
                eq(quoteItems.sentOrderItemId, orderItems.id),
              )
              .leftJoin(orders, eq(orderItems.orderId, orders.id))
              .where(inArray(quoteItems.quoteId, quoteIds))
          : Promise.resolve([]),
        listIds.length
          ? ctx.db
              .select({
                id: orders.id,
                materialListId: orders.materialListId,
                orderNumber: orders.orderNumber,
                supplierId: orders.supplierId,
                status: orders.status,
                sentAt: orders.sentAt,
              })
              .from(orders)
              .where(inArray(orders.materialListId, listIds))
          : Promise.resolve([]),
      ]);

      const totalSupplierIdsByQuoteId = new Map<string, Set<string>>();
      // Tool request lines have no supplier; they all go to the tool room.
      const quoteIdsWithItems = new Set<string>();
      for (const row of supplierRows) {
        if (!row.partDefinitionId) continue;
        quoteIdsWithItems.add(row.quoteId);

        const supplierId = row.selectedSupplierId ?? row.supplierPartSupplierId;
        if (!supplierId) continue;

        const supplierIds =
          totalSupplierIdsByQuoteId.get(row.quoteId) ?? new Set<string>();
        supplierIds.add(supplierId);
        totalSupplierIdsByQuoteId.set(row.quoteId, supplierIds);
      }

      const orderIds = orderRows.map((row) => row.id);
      const orderVerificationRows = orderIds.length
        ? await ctx.db
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

      const verificationByOrderId = new Map(
        orderVerificationRows.map((row) => [row.orderId, row]),
      );

      const sentSupplierIdsByListId = new Map<string, Set<string>>();
      const verifiedSupplierIdsByListId = new Map<string, Set<string>>();
      for (const row of orderRows) {
        if (!row.materialListId || !row.supplierId) continue;

        const hasBeenSent =
          !!row.sentAt ||
          ["sent", "confirmed", "received"].includes(row.status);
        if (!hasBeenSent) continue;

        const supplierIds =
          sentSupplierIdsByListId.get(row.materialListId) ?? new Set<string>();
        supplierIds.add(row.supplierId);
        sentSupplierIdsByListId.set(row.materialListId, supplierIds);

        const verificationCounts = verificationByOrderId.get(row.id);
        const isVerified =
          !!verificationCounts &&
          verificationCounts.itemCount > 0 &&
          verificationCounts.verifiedItemCount === verificationCounts.itemCount;
        if (!isVerified) continue;

        const verifiedSupplierIds =
          verifiedSupplierIdsByListId.get(row.materialListId) ??
          new Set<string>();
        verifiedSupplierIds.add(row.supplierId);
        verifiedSupplierIdsByListId.set(
          row.materialListId,
          verifiedSupplierIds,
        );
      }

      return {
        ...job,
        materialLists: lists.map((list) => ({
          ...list,
          overallProgress: materialListProgress(
            supplierRows.filter((row) => row.quoteId === list.quoteId),
          ),
          orderStatuses: materialListOrderStatuses(
            list.id,
            orderRows,
            verificationByOrderId,
            supplierRows
              .filter(
                (row) =>
                  row.quoteId === list.quoteId &&
                  row.partDefinitionId &&
                  Number(row.quantity) > 0,
              )
              .map((row) => ({
                sentOrderId: row.sentOrderId,
                supplierId:
                  list.kind === "tools"
                    ? "tool-room"
                    : (row.selectedSupplierId ?? row.supplierPartSupplierId),
                supplierName:
                  list.kind === "tools" ? "Tool Room" : row.supplierName,
              })),
          ),
          orderNumbers: [
            ...new Set(
              orderRows
                .filter(
                  (order) =>
                    order.materialListId === list.id &&
                    order.status !== "cancelled",
                )
                .map((order) => order.orderNumber?.trim())
                .filter((number): number is string => Boolean(number)),
            ),
          ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
          totalSupplierCount: !list.quoteId
            ? 0
            : list.kind === "tools"
              ? Number(quoteIdsWithItems.has(list.quoteId))
              : (totalSupplierIdsByQuoteId.get(list.quoteId)?.size ?? 0),
          sentSupplierCount: sentSupplierIdsByListId.get(list.id)?.size ?? 0,
          verifiedSupplierCount:
            verifiedSupplierIdsByListId.get(list.id)?.size ?? 0,
        })),
      };
    }),
});

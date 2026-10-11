import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { retiredOfflineMutation } from "../retired-offline-sync";

import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import {
  jobRooms,
  jobs,
  locations,
  materialLists,
  orderItems,
  orders,
  quoteItems,
  supplierParts,
  users,
} from "~/server/db/schema";

export const jobRouter = createTRPCRouter({
  syncEntityMutations: retiredOfflineMutation,

  /**
   * Get a single job with material lists
   */
  getJob: hasDashboardAccess
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
                selectedSupplierId: quoteItems.supplierId,
                supplierPartSupplierId: supplierParts.supplierId,
                partDefinitionId: quoteItems.partDefinitionId,
              })
              .from(quoteItems)
              .leftJoin(
                supplierParts,
                eq(quoteItems.supplierPartId, supplierParts.id),
              )
              .where(inArray(quoteItems.quoteId, quoteIds))
          : Promise.resolve([]),
        listIds.length
          ? ctx.db
              .select({
                id: orders.id,
                materialListId: orders.materialListId,
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

import { TRPCError } from "@trpc/server";
import { eq, and, sql, desc, inArray, gt } from "drizzle-orm";
import { z } from "zod";
import type { db as appDb } from "~/server/db";

function getNextBusinessDay(from = new Date()) {
  const next = new Date(from);
  next.setHours(0, 0, 0, 0);
  do {
    next.setDate(next.getDate() + 1);
  } while (next.getDay() === 0 || next.getDay() === 6);
  return next;
}

function formatTorontoDate(from = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(from);
}

function formatMaterialListName(listNumber: number, from = new Date()) {
  return `${formatTorontoDate(from)} -${listNumber}`;
}

function formatEmailItemLine(item: {
  quantity: string | null;
  descriptionSnapshot: string | null;
}) {
  const rawQty = item.quantity ? item.quantity.toString().trim() : "0";
  const parsedQty = Number(rawQty);
  const qty = Number.isFinite(parsedQty)
    ? parsedQty.toLocaleString("en-CA", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 6,
      })
    : rawQty;
  const description = item.descriptionSnapshot?.trim() || "Item";

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

import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import {
  assertCanDeleteCoreRecords,
  assertCanGenerateDocuments,
} from "~/server/auth/permissions";
import { publishMaterialListEvent } from "~/server/material-list-events";
import {
  jobs,
  materialLists,
  quotes,
  quoteItems,
  orders,
  orderItems,
  partDefinitions,
  supplierParts,
  suppliers,
  units,
  locations,
  users,
  materials,
  materialListSyncMutations,
  materialListSyncTombstones,
} from "~/server/db/schema";

async function recalculateQuoteTotals(database: typeof appDb, quoteId: string) {
  const allItems = await database
    .select({ extendedPrice: quoteItems.extendedPrice })
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quoteId));

  const subtotal = allItems.reduce((sum, item) => {
    const price = item.extendedPrice
      ? parseFloat(item.extendedPrice.toString())
      : 0;
    return sum + price;
  }, 0);

  await database
    .update(quotes)
    .set({
      subtotalMaterials: subtotal.toString(),
      total: subtotal.toString(),
    })
    .where(eq(quotes.id, quoteId));

  return subtotal;
}

async function touchMaterialList(database: typeof appDb, materialListId: string) {
  await database
    .update(materialLists)
    .set({ updatedAt: new Date() })
    .where(eq(materialLists.id, materialListId));
}

async function recordMaterialListItemTombstone(
  database: typeof appDb,
  input: { organizationId: string; materialListId: string; itemId: string },
) {
  await database
    .insert(materialListSyncTombstones)
    .values({
      organizationId: input.organizationId,
      materialListId: input.materialListId,
      entityType: "quoteItem",
      entityId: input.itemId,
    })
    .onConflictDoNothing();
}

const materialListSyncMutationInput = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("addItem"),
    clientMutationId: z.string().min(1).max(255),
    queuedAt: z.string(),
    localItemId: z.string().min(1).max(255),
    partDefinitionId: z.string().uuid().optional(),
    quantity: z.number().positive(),
    supplierPartId: z.string().uuid().optional().nullable(),
    supplierId: z.string().uuid().optional().nullable(),
    unitCost: z.number().optional(),
    oneOffDisplayName: z.string().min(1).optional(),
    oneOffDescription: z.string().optional(),
    oneOffMaterial: z.string().optional(),
    oneOffSizeNominal: z.number().optional(),
    oneOffSizeUnitId: z.string().uuid().optional(),
  }),
  z.object({
    type: z.literal("updateItemQuantity"),
    clientMutationId: z.string().min(1).max(255),
    queuedAt: z.string(),
    itemId: z.string().uuid(),
    quantity: z.number().positive(),
  }),
  z.object({
    type: z.literal("updateItemSupplierPart"),
    clientMutationId: z.string().min(1).max(255),
    queuedAt: z.string(),
    itemId: z.string().uuid(),
    supplierPartId: z.string().uuid().nullable(),
    supplierId: z.string().uuid().optional().nullable(),
  }),
  z.object({
    type: z.literal("removeItem"),
    clientMutationId: z.string().min(1).max(255),
    queuedAt: z.string(),
    itemId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("renameMaterialList"),
    clientMutationId: z.string().min(1).max(255),
    queuedAt: z.string(),
    name: z.string().min(1).max(255),
  }),
]);

export const materialListRouter = createTRPCRouter({
  /**
   * Create a new material list (linked to job)
   */
  createMaterialList: hasDashboardAccess
    .input(
      z.object({
        jobId: z.string().uuid().optional(),
        name: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // Get job ID - use provided, current job, or create one
      let jobId = input.jobId;

      if (!jobId) {
        // Use current job if available
        if (ctx.user.currentJobId) {
          // Verify current job exists and belongs to organization
          const [currentJob] = await ctx.db
            .select({ id: jobs.id })
            .from(jobs)
            .where(
              and(
                eq(jobs.id, ctx.user.currentJobId),
                eq(jobs.organizationId, ctx.user.organizationId),
              ),
            )
            .limit(1);

          if (currentJob) {
            jobId = currentJob.id;
          }
        }

        // If still no job, get or create current job via job router
        if (!jobId) {
          // This will be handled by the frontend calling getCurrentJob first
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No job specified. Please select a job first.",
          });
        }
      }

      // Verify job exists and belongs to organization
      const [job] = await ctx.db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      const [materialListCountResult] = await ctx.db
        .select({
          count: sql<number>`count(*)::int`,
        })
        .from(materialLists)
        .where(
          and(
            eq(materialLists.jobId, jobId),
            eq(materialLists.organizationId, ctx.user.organizationId),
          ),
        );

      const nextMaterialListNumber = (materialListCountResult?.count ?? 0) + 1;
      const materialListName =
        input.name?.trim() || formatMaterialListName(nextMaterialListNumber);

      // Create material list
      const [materialList] = await ctx.db
        .insert(materialLists)
        .values({
          organizationId: ctx.user.organizationId,
          jobId: jobId,
          name: materialListName,
          createdByUserId: ctx.userId,
        })
        .returning();

      if (!materialList) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create material list",
        });
      }

      // Create draft quote linked to material list
      const [quote] = await ctx.db
        .insert(quotes)
        .values({
          organizationId: ctx.user.organizationId,
          materialListId: materialList.id,
          jobId: jobId,
          createdByUserId: ctx.userId,
          subtotalMaterials: "0",
          total: "0",
        })
        .returning();

      if (!quote) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create quote",
        });
      }

      // Update material list with quote ID
      await ctx.db
        .update(materialLists)
        .set({ quoteId: quote.id })
        .where(eq(materialLists.id, materialList.id));

      return { materialListId: materialList.id, quoteId: quote.id };
    }),

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

      const createdBy = materialList.createdByUserId
        ? await ctx.db
            .select({
              id: users.id,
              name: users.name,
              email: users.email,
            })
            .from(users)
            .where(eq(users.id, materialList.createdByUserId))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : null;

      // Get quote for this material list
      if (!materialList.quoteId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Quote not found for material list",
        });
      }

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

      // Get quote items with part definitions and suppliers
      const itemsRaw = await ctx.db
        .select({
          id: quoteItems.id,
          quantity: quoteItems.quantity,
          unitCost: quoteItems.unitCost,
          extendedPrice: quoteItems.extendedPrice,
          descriptionSnapshot: quoteItems.descriptionSnapshot,
          createdAt: quoteItems.createdAt,
          updatedAt: quoteItems.updatedAt,
          partDefinitionId: partDefinitions.id,
          partDefinitionDisplayName: partDefinitions.displayName,
          partDefinitionImageUrl: partDefinitions.imageUrl,
          partDefinitionMaterialId: partDefinitions.materialId,
          partDefinitionMaterialName: materials.name,
          supplierPartId: supplierParts.id,
          selectedSupplierId: quoteItems.supplierId,
          supplierPartSupplierId: supplierParts.supplierId,
          supplierPartSku: supplierParts.supplierSku,
          supplierPartLastKnownUnitCost: supplierParts.lastKnownUnitCost,
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
        .where(eq(quoteItems.quoteId, quote.id));

      // Transform to nested structure
      const items = itemsRaw.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        unitCost: item.unitCost,
        extendedPrice: item.extendedPrice,
        descriptionSnapshot: item.descriptionSnapshot,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        syncVersion: item.updatedAt?.toISOString?.() ?? String(item.updatedAt),
        partDefinition: item.partDefinitionId
          ? {
              id: item.partDefinitionId,
              displayName: item.partDefinitionDisplayName,
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
        selectedSupplierId: item.selectedSupplierId ?? item.supplierPartSupplierId ?? null,
        supplierPart: item.supplierPartId
          ? {
              id: item.supplierPartId,
              supplierId: item.supplierPartSupplierId,
              supplierSku: item.supplierPartSku,
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

  /**
   * List all material lists for a job (defaults to current job)
   */
  listMaterialLists: hasDashboardAccess
    .input(
      z.object({
        jobId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // Use provided jobId or current job
      let jobId = input.jobId ?? ctx.user.currentJobId;

      if (!jobId) {
        // No job specified - return empty array
        return [];
      }

      // Verify job belongs to organization
      const [job] = await ctx.db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!job) {
        return [];
      }

      const materialListsData = await ctx.db
        .select({
          id: materialLists.id,
          name: materialLists.name,
          createdAt: materialLists.createdAt,
          createdByUserId: materialLists.createdByUserId,
          foreman: {
            id: users.id,
            name: users.name,
          },
        })
        .from(materialLists)
        .leftJoin(jobs, eq(materialLists.jobId, jobs.id))
        .leftJoin(users, eq(jobs.foremanUserId, users.id))
        .where(
          and(
            eq(materialLists.jobId, jobId),
            eq(materialLists.organizationId, ctx.user.organizationId),
          ),
        )
        .orderBy(desc(materialLists.createdAt));

      const createdByIds = Array.from(
        new Set(
          materialListsData
            .map((list) => list.createdByUserId)
            .filter((value): value is string => Boolean(value)),
        ),
      );

      const createdByUsers = createdByIds.length
        ? await ctx.db
            .select({
              id: users.id,
              name: users.name,
              email: users.email,
            })
            .from(users)
            .where(inArray(users.id, createdByIds))
        : [];

      const createdByMap = new Map(
        createdByUsers.map((user) => [user.id, user]),
      );

      // Get item counts and totals for each material list
      const listsWithDetails = await Promise.all(
        materialListsData.map(async (list) => {
          // Get quote for this material list
          const [materialListWithQuote] = await ctx.db
            .select({ quoteId: materialLists.quoteId })
            .from(materialLists)
            .where(eq(materialLists.id, list.id))
            .limit(1);

          const createdBy = list.createdByUserId
            ? (createdByMap.get(list.createdByUserId) ?? null)
            : null;

          if (!materialListWithQuote?.quoteId) {
            return {
              ...list,
              createdBy: createdBy
                ? {
                    id: createdBy.id,
                    name: createdBy.name ?? "Unknown",
                    email: createdBy.email,
                  }
                : null,
              itemCount: 0,
              materialTotal: 0,
            };
          }

          // Get items count and total
          const items = await ctx.db
            .select({
              extendedPrice: quoteItems.extendedPrice,
            })
            .from(quoteItems)
            .where(eq(quoteItems.quoteId, materialListWithQuote.quoteId));

          const itemCount = items.length;
          const materialTotal = items.reduce((sum, item) => {
            const price = item.extendedPrice
              ? parseFloat(item.extendedPrice.toString())
              : 0;
            return sum + price;
          }, 0);

          return {
            ...list,
            createdBy: createdBy
              ? {
                  id: createdBy.id,
                  name: createdBy.name ?? "Unknown",
                  email: createdBy.email,
                }
              : null,
            itemCount,
            materialTotal,
          };
        }),
      );

      return listsWithDetails;
    }),

  /**
   * Update job info (name and location) for the job associated with a material list
   */
  updateMaterialListJobInfo: hasDashboardAccess
    .input(
      z.object({
        materialListId: z.string().uuid(),
        name: z.string().min(1).max(255),
        locationId: z.string().uuid().optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // Verify material list exists and belongs to organization
      const [existing] = await ctx.db
        .select({
          id: materialLists.id,
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

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Material list not found",
        });
      }

      // Update job name and location
      const jobUpdates: {
        name: string;
        locationId?: string | null;
      } = {
        name: input.name,
      };

      if (input.locationId !== undefined) {
        jobUpdates.locationId = input.locationId ?? null;
      }

      await ctx.db
        .update(jobs)
        .set(jobUpdates)
        .where(eq(jobs.id, existing.jobId));

      publishMaterialListEvent(input.materialListId);
      return { success: true };
    }),

  /**
   * Update material list name
   */
  updateMaterialListName: hasDashboardAccess
    .input(
      z.object({
        materialListId: z.string().uuid(),
        name: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // Verify material list exists and belongs to organization
      const [existing] = await ctx.db
        .select({
          id: materialLists.id,
        })
        .from(materialLists)
        .where(
          and(
            eq(materialLists.id, input.materialListId),
            eq(materialLists.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Material list not found",
        });
      }

      // Update material list name
      await ctx.db
        .update(materialLists)
        .set({
          name: input.name,
        })
        .where(eq(materialLists.id, input.materialListId));

      publishMaterialListEvent(input.materialListId);
      return { success: true };
    }),

  /**
   * Delete a material list and its quote/items.
   */
  deleteMaterialList: hasDashboardAccess
    .input(z.object({ materialListId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertCanDeleteCoreRecords(ctx.user);

      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const [existing] = await ctx.db
        .select({ id: materialLists.id })
        .from(materialLists)
        .where(
          and(
            eq(materialLists.id, input.materialListId),
            eq(materialLists.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Material list not found",
        });
      }

      await ctx.db
        .delete(materialLists)
        .where(eq(materialLists.id, input.materialListId));

      publishMaterialListEvent(input.materialListId, "deleted");
      return { success: true };
    }),

  /**
   * Add item to material list
   */
  addItemToMaterialList: hasDashboardAccess
    .input(
      z.object({
        materialListId: z.string().uuid(),
        partDefinitionId: z.string().uuid().optional(),
        quantity: z.number().positive(),
        supplierPartId: z.string().uuid().optional(),
        unitCost: z.number().optional(),
        // One-off part fields
        oneOffDisplayName: z.string().min(1).optional(),
        oneOffDescription: z.string().optional(),
        oneOffMaterial: z.string().optional(),
        oneOffSizeNominal: z.number().optional(),
        oneOffSizeUnitId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // Validate: either partDefinitionId or one-off fields must be provided
      if (!input.partDefinitionId && !input.oneOffDisplayName) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Either partDefinitionId or oneOffDisplayName must be provided",
        });
      }

      // Get material list and verify it exists
      const [materialList] = await ctx.db
        .select({
          id: materialLists.id,
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

      let partDef = null;
      let supplierPartId = input.supplierPartId;
      let supplierPart = null;
      let unitCost = input.unitCost ? input.unitCost.toString() : null;
      let uomId = null;
      let descriptionSnapshot = null;

      if (input.partDefinitionId) {
        // Regular part - get part definition
        const [pd] = await ctx.db
          .select()
          .from(partDefinitions)
          .where(eq(partDefinitions.id, input.partDefinitionId))
          .limit(1);

        if (!pd) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Part definition not found",
          });
        }

        partDef = pd;
        uomId = null;
        descriptionSnapshot = pd.displayName;

        // Determine supplier part
        if (supplierPartId) {
          // Use provided supplier part
          const [sp] = await ctx.db
            .select()
            .from(supplierParts)
            .where(and(eq(supplierParts.id, supplierPartId)))
            .limit(1);
          supplierPart = sp;
          if (sp) {
            unitCost = sp.lastKnownUnitCost;
          }
        } else {
          // Auto-select preferred supplier
          const [preferred] = await ctx.db
            .select()
            .from(supplierParts)
            .where(
              and(
                eq(supplierParts.partDefinitionId, input.partDefinitionId),
                eq(supplierParts.isPreferred, true),
              ),
            )
            .limit(1);

          if (preferred) {
            supplierPartId = preferred.id;
            supplierPart = preferred;
            unitCost = preferred.lastKnownUnitCost;
          }
        }
      } else {
        // One-off part
        descriptionSnapshot = input.oneOffDisplayName ?? "";
        // For one-off parts, use provided unitCost or default to 0
        unitCost = input.unitCost ? input.unitCost.toString() : null;
      }

      // Calculate extended price
      const qty = input.quantity;
      const cost = unitCost ? parseFloat(unitCost.toString()) : 0;
      const extendedPrice = qty * cost;

      // Create quote item
      const [quoteItem] = await ctx.db
        .insert(quoteItems)
        .values({
          quoteId: quote.id,
          supplierPartId: supplierPartId ?? null,
          partDefinitionId: input.partDefinitionId ?? null,
          quantity: qty.toString(),
          uomId: uomId,
          unitCost: unitCost,
          extendedPrice: extendedPrice.toString(),
          descriptionSnapshot: descriptionSnapshot,
          // One-off fields
          oneOffDisplayName: input.oneOffDisplayName ?? null,
          oneOffDescription: input.oneOffDescription ?? null,
          oneOffMaterial: input.oneOffMaterial ?? null,
          oneOffSizeNominal:
            input.oneOffSizeNominal !== undefined
              ? input.oneOffSizeNominal.toString()
              : null,
          oneOffSizeUnitId: input.oneOffSizeUnitId ?? null,
          addedByUserId: ctx.userId,
        })
        .returning();

      await recalculateQuoteTotals(ctx.db, quote.id);

      publishMaterialListEvent(input.materialListId);
      return quoteItem;
    }),

  /**
   * Add multiple regular catalog items to a material list in one transaction-ish pass.
   * This avoids firing several addItem mutations at once, which was slow and could race
   * while recalculating quote totals.
   */
  addItemsToMaterialList: hasDashboardAccess
    .input(
      z.object({
        materialListId: z.string().uuid(),
        items: z
          .array(
            z.object({
              partDefinitionId: z.string().uuid(),
              quantity: z.number().positive(),
              supplierPartId: z.string().uuid(),
            }),
          )
          .min(1),
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

      const partDefinitionIds = [
        ...new Set(input.items.map((item) => item.partDefinitionId)),
      ];
      const supplierPartIds = [
        ...new Set(input.items.map((item) => item.supplierPartId)),
      ];

      const [partDefs, selectedSupplierParts] = await Promise.all([
        ctx.db
          .select()
          .from(partDefinitions)
          .where(inArray(partDefinitions.id, partDefinitionIds)),
        ctx.db
          .select()
          .from(supplierParts)
          .where(
            and(
              inArray(supplierParts.id, supplierPartIds),
              eq(supplierParts.organizationId, ctx.user.organizationId),
            ),
          ),
      ]);

      const partDefById = new Map(
        partDefs.map((partDef) => [partDef.id, partDef]),
      );
      const supplierPartById = new Map(
        selectedSupplierParts.map((supplierPart) => [
          supplierPart.id,
          supplierPart,
        ]),
      );

      const values = input.items.map((item) => {
        const partDef = partDefById.get(item.partDefinitionId);
        if (!partDef) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Part definition not found",
          });
        }

        const supplierPart = supplierPartById.get(item.supplierPartId);
        if (
          !supplierPart ||
          supplierPart.partDefinitionId !== item.partDefinitionId
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Selected supplier does not match one of the selected parts",
          });
        }

        const unitCost = supplierPart.lastKnownUnitCost;
        const cost = unitCost ? parseFloat(unitCost.toString()) : 0;
        const extendedPrice = item.quantity * cost;

        return {
          quoteId: quote.id,
          supplierPartId: supplierPart.id,
          partDefinitionId: partDef.id,
          quantity: item.quantity.toString(),
          uomId: null,
          unitCost,
          extendedPrice: extendedPrice.toString(),
          descriptionSnapshot: partDef.displayName,
          addedByUserId: ctx.userId,
        };
      });

      const insertedItems = await ctx.db
        .insert(quoteItems)
        .values(values)
        .returning();

      await recalculateQuoteTotals(ctx.db, quote.id);

      publishMaterialListEvent(input.materialListId);
      return insertedItems;
    }),

  /**
   * Update material list item
   */
  updateMaterialListItem: hasDashboardAccess
    .input(
      z.object({
        itemId: z.string().uuid(),
        quantity: z.number().positive().optional(),
        supplierPartId: z.string().uuid().optional().nullable(),
        supplierId: z.string().uuid().optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // Get quote item
      const [quoteItem] = await ctx.db
        .select({
          id: quoteItems.id,
          quoteId: quoteItems.quoteId,
          quantity: quoteItems.quantity,
          unitCost: quoteItems.unitCost,
          supplierPartId: quoteItems.supplierPartId,
          supplierId: quoteItems.supplierId,
        })
        .from(quoteItems)
        .where(eq(quoteItems.id, input.itemId))
        .limit(1);

      if (!quoteItem) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item not found",
        });
      }

      // Get quote to verify organization
      const [quote] = await ctx.db
        .select()
        .from(quotes)
        .where(
          and(
            eq(quotes.id, quoteItem.quoteId),
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

      // Update values
      const quantity = input.quantity
        ? input.quantity
        : parseFloat(quoteItem.quantity.toString());
      let unitCost = quoteItem.unitCost
        ? parseFloat(quoteItem.unitCost.toString())
        : 0;

      // If supplier changed, get new unit cost
      let nextSupplierPartId = quoteItem.supplierPartId;
      let nextSupplierId = quoteItem.supplierId;

      if (input.supplierPartId !== undefined) {
        if (input.supplierPartId) {
          const [supplierPart] = await ctx.db
            .select()
            .from(supplierParts)
            .where(
              and(
                eq(supplierParts.id, input.supplierPartId),
                eq(supplierParts.organizationId, ctx.user.organizationId),
              ),
            )
            .limit(1);

          if (supplierPart) {
            nextSupplierPartId = supplierPart.id;
            nextSupplierId = supplierPart.supplierId;
            unitCost = supplierPart.lastKnownUnitCost
              ? parseFloat(supplierPart.lastKnownUnitCost.toString())
              : 0;
          }
        } else {
          nextSupplierPartId = null;
          unitCost = 0;
        }
      }

      if (input.supplierId !== undefined) {
        if (input.supplierId) {
          const [supplier] = await ctx.db
            .select({ id: suppliers.id })
            .from(suppliers)
            .where(
              and(
                eq(suppliers.id, input.supplierId),
                eq(suppliers.organizationId, ctx.user.organizationId),
              ),
            )
            .limit(1);

          if (supplier) {
            nextSupplierId = supplier.id;
            nextSupplierPartId = null;
            unitCost = 0;
          }
        } else {
          nextSupplierId = null;
        }
      }

      const extendedPrice = quantity * unitCost;

      // Update quote item
      const [updated] = await ctx.db
        .update(quoteItems)
        .set({
          quantity: quantity.toString(),
          supplierPartId: nextSupplierPartId,
          supplierId: nextSupplierId,
          unitCost: unitCost.toString(),
          extendedPrice: extendedPrice.toString(),
          updatedAt: new Date(),
        })
        .where(eq(quoteItems.id, input.itemId))
        .returning();

      await recalculateQuoteTotals(ctx.db, quote.id);

      if (quote.materialListId) publishMaterialListEvent(quote.materialListId);
      return updated;
    }),

  /**
   * Remove item from material list
   */
  removeMaterialListItem: hasDashboardAccess
    .input(z.object({ itemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // Get quote item
      const [quoteItem] = await ctx.db
        .select({ quoteId: quoteItems.quoteId })
        .from(quoteItems)
        .where(eq(quoteItems.id, input.itemId))
        .limit(1);

      if (!quoteItem) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item not found",
        });
      }

      // Verify quote belongs to organization
      const [quote] = await ctx.db
        .select()
        .from(quotes)
        .where(
          and(
            eq(quotes.id, quoteItem.quoteId),
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

      // Delete item
      await ctx.db.delete(quoteItems).where(eq(quoteItems.id, input.itemId));

      await recalculateQuoteTotals(ctx.db, quote.id);
      if (quote.materialListId) {
        await recordMaterialListItemTombstone(ctx.db, {
          organizationId: ctx.user.organizationId,
          materialListId: quote.materialListId,
          itemId: input.itemId,
        });
        await touchMaterialList(ctx.db, quote.materialListId);
      }

      if (quote.materialListId) publishMaterialListEvent(quote.materialListId);
      return { success: true };
    }),


  /**
   * Apply several latency-sensitive material-list edits in one server round trip.
   * The client still updates locally first; this endpoint is for background sync.
   */
  applyMaterialListMutationsBatch: hasDashboardAccess
    .input(
      z.object({
        materialListId: z.string().uuid(),
        mutations: z
          .array(
            z.discriminatedUnion("type", [
              z.object({
                type: z.literal("updateItemQuantity"),
                itemId: z.string().uuid(),
                quantity: z.number().positive(),
              }),
              z.object({
                type: z.literal("removeItem"),
                itemId: z.string().uuid(),
              }),
              z.object({
                type: z.literal("renameMaterialList"),
                name: z.string().min(1).max(255),
              }),
            ]),
          )
          .min(1),
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
        .select({ id: materialLists.id, quoteId: materialLists.quoteId })
        .from(materialLists)
        .where(
          and(
            eq(materialLists.id, input.materialListId),
            eq(materialLists.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!materialList?.quoteId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Material list not found",
        });
      }

      const quantityUpdates = input.mutations.filter(
        (
          mutation,
        ): mutation is Extract<
          (typeof input.mutations)[number],
          { type: "updateItemQuantity" }
        > => mutation.type === "updateItemQuantity",
      );
      const removeItemIds = input.mutations
        .filter((mutation) => mutation.type === "removeItem")
        .map((mutation) => mutation.itemId);
      const latestRename = [...input.mutations]
        .reverse()
        .find((mutation) => mutation.type === "renameMaterialList");

      if (latestRename?.type === "renameMaterialList") {
        await ctx.db
          .update(materialLists)
          .set({ name: latestRename.name })
          .where(eq(materialLists.id, input.materialListId));
      }

      if (quantityUpdates.length > 0) {
        const itemIds = quantityUpdates.map((mutation) => mutation.itemId);
        const currentItems = await ctx.db
          .select({
            id: quoteItems.id,
            quoteId: quoteItems.quoteId,
            unitCost: quoteItems.unitCost,
          })
          .from(quoteItems)
          .where(inArray(quoteItems.id, itemIds));
        const itemById = new Map(currentItems.map((item) => [item.id, item]));

        for (const mutation of quantityUpdates) {
          const item = itemById.get(mutation.itemId);
          if (!item || item.quoteId !== materialList.quoteId) continue;

          const unitCost = item.unitCost ? parseFloat(item.unitCost.toString()) : 0;
          const extendedPrice = mutation.quantity * unitCost;
          await ctx.db
            .update(quoteItems)
            .set({
              quantity: mutation.quantity.toString(),
              extendedPrice: extendedPrice.toString(),
              updatedAt: new Date(),
            })
            .where(eq(quoteItems.id, mutation.itemId));
        }
      }

      if (removeItemIds.length > 0) {
        const removableItems = await ctx.db
          .select({ id: quoteItems.id, quoteId: quoteItems.quoteId })
          .from(quoteItems)
          .where(inArray(quoteItems.id, removeItemIds));
        const verifiedIds = removableItems
          .filter((item) => item.quoteId === materialList.quoteId)
          .map((item) => item.id);

        if (verifiedIds.length > 0) {
          await ctx.db.delete(quoteItems).where(inArray(quoteItems.id, verifiedIds));
          await Promise.all(
            verifiedIds.map((itemId) =>
              recordMaterialListItemTombstone(ctx.db, {
                organizationId: ctx.user.organizationId!,
                materialListId: input.materialListId,
                itemId,
              }),
            ),
          );
        }
      }

      await recalculateQuoteTotals(ctx.db, materialList.quoteId);
      publishMaterialListEvent(input.materialListId);

      return { success: true };
    }),

  /**
   * Custom local-first sync push endpoint for material-list edits.
   *
   * Client mutations are idempotent by organization + clientMutationId. This is
   * the server-side sync boundary that lets Dexie stay the local source of truth
   * while Postgres remains authoritative after reconnect.
   */
  syncMaterialListMutations: hasDashboardAccess
    .input(
      z.object({
        materialListId: z.string().uuid(),
        mutations: z.array(materialListSyncMutationInput).min(1),
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
        .select({ id: materialLists.id, quoteId: materialLists.quoteId })
        .from(materialLists)
        .where(
          and(
            eq(materialLists.id, input.materialListId),
            eq(materialLists.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!materialList?.quoteId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Material list not found",
        });
      }

      const applied: Array<{
        clientMutationId: string;
        type: string;
        localItemId?: string;
        serverItemId?: string | null;
        duplicate?: boolean;
      }> = [];
      const failed: Array<{ clientMutationId: string; message: string }> = [];
      let needsTotalRecalc = false;

      for (const mutation of input.mutations) {
        const [existing] = await ctx.db
          .select({
            serverItemId: materialListSyncMutations.serverItemId,
            clientItemId: materialListSyncMutations.clientItemId,
            mutationType: materialListSyncMutations.mutationType,
          })
          .from(materialListSyncMutations)
          .where(
            and(
              eq(materialListSyncMutations.organizationId, ctx.user.organizationId),
              eq(materialListSyncMutations.clientMutationId, mutation.clientMutationId),
            ),
          )
          .limit(1);

        if (existing) {
          applied.push({
            clientMutationId: mutation.clientMutationId,
            type: existing.mutationType,
            localItemId: existing.clientItemId ?? undefined,
            serverItemId: existing.serverItemId,
            duplicate: true,
          });
          continue;
        }

        try {
          let serverItemId: string | null = null;
          let clientItemId: string | null = null;

          switch (mutation.type) {
            case "addItem": {
              if (!mutation.partDefinitionId && !mutation.oneOffDisplayName) {
                throw new Error("Add item requires a part definition or one-off name");
              }

              let unitCost = mutation.unitCost?.toString() ?? null;
              let descriptionSnapshot = mutation.oneOffDisplayName ?? "";

              if (mutation.partDefinitionId) {
                const [partDef] = await ctx.db
                  .select({ displayName: partDefinitions.displayName })
                  .from(partDefinitions)
                  .where(eq(partDefinitions.id, mutation.partDefinitionId))
                  .limit(1);

                if (!partDef) throw new Error("Part definition not found");
                descriptionSnapshot = partDef.displayName;

                if (mutation.supplierPartId) {
                  const [supplierPart] = await ctx.db
                    .select({ lastKnownUnitCost: supplierParts.lastKnownUnitCost })
                    .from(supplierParts)
                    .where(eq(supplierParts.id, mutation.supplierPartId))
                    .limit(1);
                  unitCost = supplierPart?.lastKnownUnitCost ?? unitCost;
                }
              }

              const cost = unitCost ? parseFloat(unitCost.toString()) : 0;
              const extendedPrice = mutation.quantity * cost;
              const [quoteItem] = await ctx.db
                .insert(quoteItems)
                .values({
                  quoteId: materialList.quoteId,
                  supplierPartId: mutation.supplierPartId ?? null,
                  supplierId: mutation.supplierId ?? null,
                  partDefinitionId: mutation.partDefinitionId ?? null,
                  quantity: mutation.quantity.toString(),
                  unitCost,
                  extendedPrice: extendedPrice.toString(),
                  descriptionSnapshot,
                  oneOffDisplayName: mutation.oneOffDisplayName ?? null,
                  oneOffDescription: mutation.oneOffDescription ?? null,
                  oneOffMaterial: mutation.oneOffMaterial ?? null,
                  oneOffSizeNominal:
                    mutation.oneOffSizeNominal !== undefined
                      ? mutation.oneOffSizeNominal.toString()
                      : null,
                  oneOffSizeUnitId: mutation.oneOffSizeUnitId ?? null,
                  addedByUserId: ctx.userId,
                })
                .returning({ id: quoteItems.id });

              if (!quoteItem) throw new Error("Failed to create quote item");
              serverItemId = quoteItem.id;
              clientItemId = mutation.localItemId;
              needsTotalRecalc = true;
              break;
            }
            case "updateItemQuantity": {
              const [item] = await ctx.db
                .select({ quoteId: quoteItems.quoteId, unitCost: quoteItems.unitCost })
                .from(quoteItems)
                .where(eq(quoteItems.id, mutation.itemId))
                .limit(1);
              if (!item || item.quoteId !== materialList.quoteId) {
                throw new Error("Quote item not found");
              }

              const cost = item.unitCost ? parseFloat(item.unitCost.toString()) : 0;
              await ctx.db
                .update(quoteItems)
                .set({
                  quantity: mutation.quantity.toString(),
                  extendedPrice: (mutation.quantity * cost).toString(),
                  updatedAt: new Date(),
                })
                .where(eq(quoteItems.id, mutation.itemId));
              serverItemId = mutation.itemId;
              needsTotalRecalc = true;
              break;
            }
            case "updateItemSupplierPart": {
              const [item] = await ctx.db
                .select({ quoteId: quoteItems.quoteId, quantity: quoteItems.quantity })
                .from(quoteItems)
                .where(eq(quoteItems.id, mutation.itemId))
                .limit(1);
              if (!item || item.quoteId !== materialList.quoteId) {
                throw new Error("Quote item not found");
              }

              let unitCost: string | null = null;
              if (mutation.supplierPartId) {
                const [supplierPart] = await ctx.db
                  .select({ lastKnownUnitCost: supplierParts.lastKnownUnitCost })
                  .from(supplierParts)
                  .where(eq(supplierParts.id, mutation.supplierPartId))
                  .limit(1);
                unitCost = supplierPart?.lastKnownUnitCost ?? null;
              }

              const quantity = item.quantity ? parseFloat(item.quantity.toString()) : 0;
              const cost = unitCost ? parseFloat(unitCost.toString()) : 0;
              await ctx.db
                .update(quoteItems)
                .set({
                  supplierPartId: mutation.supplierPartId,
                  supplierId: mutation.supplierId ?? null,
                  unitCost,
                  extendedPrice: (quantity * cost).toString(),
                  updatedAt: new Date(),
                })
                .where(eq(quoteItems.id, mutation.itemId));
              serverItemId = mutation.itemId;
              needsTotalRecalc = true;
              break;
            }
            case "removeItem": {
              const [item] = await ctx.db
                .select({ quoteId: quoteItems.quoteId })
                .from(quoteItems)
                .where(eq(quoteItems.id, mutation.itemId))
                .limit(1);
              if (item?.quoteId === materialList.quoteId) {
                await ctx.db.delete(quoteItems).where(eq(quoteItems.id, mutation.itemId));
                await recordMaterialListItemTombstone(ctx.db, {
                  organizationId: ctx.user.organizationId,
                  materialListId: input.materialListId,
                  itemId: mutation.itemId,
                });
                needsTotalRecalc = true;
              }
              serverItemId = mutation.itemId;
              break;
            }
            case "renameMaterialList": {
              await ctx.db
                .update(materialLists)
                .set({ name: mutation.name })
                .where(eq(materialLists.id, input.materialListId));
              break;
            }
          }

          await ctx.db.insert(materialListSyncMutations).values({
            organizationId: ctx.user.organizationId,
            userId: ctx.userId,
            materialListId: input.materialListId,
            clientMutationId: mutation.clientMutationId,
            mutationType: mutation.type,
            serverItemId,
            clientItemId,
            payload: mutation,
          });

          applied.push({
            clientMutationId: mutation.clientMutationId,
            type: mutation.type,
            localItemId: clientItemId ?? undefined,
            serverItemId,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Sync mutation failed";
          failed.push({ clientMutationId: mutation.clientMutationId, message });
        }
      }

      if (needsTotalRecalc) {
        await recalculateQuoteTotals(ctx.db, materialList.quoteId);
      }
      if (applied.length > 0) {
        await touchMaterialList(ctx.db, input.materialListId);
      }
      if (applied.length > 0) {
        publishMaterialListEvent(input.materialListId);
      }

      return { applied, failed };
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
      const now = new Date();
      const scopedMaterialListIds = input.materialListIds?.length
        ? Array.from(new Set(input.materialListIds))
        : null;

      const materialListFilters = [
        eq(materialLists.organizationId, ctx.user.organizationId),
        gt(materialLists.updatedAt, since),
      ];
      if (scopedMaterialListIds) {
        materialListFilters.push(inArray(materialLists.id, scopedMaterialListIds));
      }

      const changedLists = await ctx.db
        .select({ id: materialLists.id, updatedAt: materialLists.updatedAt })
        .from(materialLists)
        .where(and(...materialListFilters))
        .limit(200);

      const changedItemFilters = [
        eq(materialLists.organizationId, ctx.user.organizationId),
        gt(quoteItems.updatedAt, since),
      ];
      if (scopedMaterialListIds) {
        changedItemFilters.push(inArray(materialLists.id, scopedMaterialListIds));
      }

      const changedItems = await ctx.db
        .select({ materialListId: materialLists.id, updatedAt: quoteItems.updatedAt })
        .from(quoteItems)
        .innerJoin(quotes, eq(quoteItems.quoteId, quotes.id))
        .innerJoin(materialLists, eq(quotes.materialListId, materialLists.id))
        .where(and(...changedItemFilters))
        .limit(500);

      const tombstoneFilters = [
        eq(materialListSyncTombstones.organizationId, ctx.user.organizationId),
        gt(materialListSyncTombstones.deletedAt, since),
      ];
      if (scopedMaterialListIds) {
        tombstoneFilters.push(
          inArray(materialListSyncTombstones.materialListId, scopedMaterialListIds),
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
        .limit(500);

      const changedMaterialListIds = Array.from(
        new Set([
          ...changedLists.map((row) => row.id),
          ...changedItems.map((row) => row.materialListId),
          ...tombstones.map((row) => row.materialListId),
        ]),
      );

      return {
        cursor: now.toISOString(),
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
      assertCanGenerateDocuments(ctx.user);

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
        const items = await ctx.db
          .select({ extendedPrice: quoteItems.extendedPrice })
          .from(quoteItems)
          .where(eq(quoteItems.quoteId, quote.id));

        const subtotalMaterials = items.reduce((sum, item) => {
          const price = item.extendedPrice
            ? parseFloat(item.extendedPrice.toString())
            : 0;
          return sum + price;
        }, 0);

        const markup = input.markupPercent / 100;
        const total = subtotalMaterials * (1 + markup);

        // Update quote
        const updateData: {
          markupPercent: string;
          subtotalMaterials: string;
          total: string;
          notes?: string | null;
        } = {
          markupPercent: input.markupPercent.toString(),
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
      const items = await ctx.db
        .select({ extendedPrice: quoteItems.extendedPrice })
        .from(quoteItems)
        .where(eq(quoteItems.quoteId, quote.id));

      const subtotalMaterials = items.reduce((sum, item) => {
        const price = item.extendedPrice
          ? parseFloat(item.extendedPrice.toString())
          : 0;
        return sum + price;
      }, 0);

      const markup = input.markupPercent / 100;
      const total = subtotalMaterials * (1 + markup);

      // Update quote
      const updateData: {
        markupPercent: string;
        subtotalMaterials: string;
        total: string;
        notes?: string | null;
      } = {
        markupPercent: input.markupPercent.toString(),
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
          quantity: quoteItems.quantity,
          extendedPrice: quoteItems.extendedPrice,
        })
        .from(quoteItems)
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
          const qty = item.quantity ? parseFloat(item.quantity.toString()) : 0;
          const basePrice = item.extendedPrice
            ? parseFloat(item.extendedPrice.toString())
            : 0;
          // Apply markup to get the customer-facing price
          const adjustedPrice = basePrice * markupMultiplier;
          adjustedTotal += adjustedPrice;
          return `- ${item.descriptionSnapshot || "Item"} × ${qty}     $${adjustedPrice.toFixed(2)}`;
        })
        .join("\n");

      // Use the calculated total (should match quote.total, but use it for consistency)
      const finalTotal = adjustedTotal > 0 ? adjustedTotal : total;

      const subject = `Quote – ${jobName}`;
      let body = `Hi,

Here's the materials quote for the ${jobName}:

${lineItems}
-----------------------------
Total: $${finalTotal.toFixed(2)}`;

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
   * Generate orders from material list (grouped by supplier)
   */
  generateOrders: hasDashboardAccess
    .input(z.object({ materialListId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertCanGenerateDocuments(ctx.user);

      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // Get material list
      const [materialList] = await ctx.db
        .select({
          id: materialLists.id,
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

      if (!materialList.quoteId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Quote not found for material list",
        });
      }

      // Get quote
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

      const quoteItemsList = await ctx.db
        .select({
          id: quoteItems.id,
          supplierPartId: quoteItems.supplierPartId,
          selectedSupplierId: quoteItems.supplierId,
          partDefinitionId: quoteItems.partDefinitionId,
          quantity: quoteItems.quantity,
          uomId: quoteItems.uomId,
          unitCost: quoteItems.unitCost,
          descriptionSnapshot: quoteItems.descriptionSnapshot,
          supplierPartSupplierId: supplierParts.supplierId,
          supplierSku: supplierParts.supplierSku,
        })
        .from(quoteItems)
        .leftJoin(
          supplierParts,
          eq(quoteItems.supplierPartId, supplierParts.id),
        )
        .where(eq(quoteItems.quoteId, quote.id));

      // Group by supplier
      const itemsBySupplier = new Map<string, typeof quoteItemsList>();
      for (const item of quoteItemsList) {
        const supplierId = item.selectedSupplierId ?? item.supplierPartSupplierId;
        if (!supplierId) {
          // Skip items without supplier
          continue;
        }
        if (!itemsBySupplier.has(supplierId)) {
          itemsBySupplier.set(supplierId, []);
        }
        itemsBySupplier.get(supplierId)!.push(item);
      }

      const orderableItemsBySupplier = new Map<string, typeof quoteItemsList>();
      for (const [supplierId, items] of itemsBySupplier.entries()) {
        const orderableItems = items.filter((item) => item.partDefinitionId);
        if (orderableItems.length > 0) {
          orderableItemsBySupplier.set(supplierId, orderableItems);
        }
      }

      if (orderableItemsBySupplier.size === 0) {
        return [];
      }

      const createdOrders = await ctx.db.transaction(async (tx) => {
        const [existingOrderCountResult] = await tx
          .select({
            count: sql<number>`count(*)::int`,
          })
          .from(orders)
          .where(
            and(
              eq(orders.jobId, materialList.jobId),
              eq(orders.organizationId, ctx.user.organizationId),
            ),
          );

        let createdOrderSequence = Number(existingOrderCountResult?.count ?? 0);
        const orderInputs = Array.from(orderableItemsBySupplier.keys()).map(
          (supplierId) => {
            createdOrderSequence += 1;
            return {
              organizationId: ctx.user.organizationId!,
              jobId: materialList.jobId,
              materialListId: input.materialListId,
              orderNumber: `PO-${String(createdOrderSequence).padStart(3, "0")}`,
              supplierId,
              createdByUserId: ctx.userId,
              status: "draft",
            };
          },
        );

        const insertedOrders = await tx
          .insert(orders)
          .values(orderInputs)
          .returning();

        if (insertedOrders.length !== orderInputs.length) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create all orders",
          });
        }

        const orderItemInputs = insertedOrders.flatMap((order) =>
          (orderableItemsBySupplier.get(order.supplierId ?? "") ?? []).map(
            (item) => ({
              orderId: order.id,
              supplierPartId: item.supplierPartId ?? undefined,
              partDefinitionId: item.partDefinitionId!,
              quantity: item.quantity ?? "1",
              uomId: item.uomId ?? undefined,
              unitCostAtOrderTime: item.unitCost ?? undefined,
              descriptionSnapshot: item.descriptionSnapshot ?? undefined,
              supplierSkuSnapshot: item.supplierSku ?? undefined,
            }),
          ),
        );

        if (orderItemInputs.length > 0) {
          await tx.insert(orderItems).values(orderItemInputs);
        }

        const orderIds = insertedOrders.map((order) => order.id);
        const supplierIds = insertedOrders
          .map((order) => order.supplierId)
          .filter((supplierId): supplierId is string => !!supplierId);

        const supplierRows = supplierIds.length
          ? await tx
              .select({
                id: suppliers.id,
                name: suppliers.name,
                contactEmail: suppliers.contactEmail,
              })
              .from(suppliers)
              .where(inArray(suppliers.id, supplierIds))
          : [];
        const suppliersById = new Map(
          supplierRows.map((supplier) => [supplier.id, supplier]),
        );

        const orderItemRows = await tx
          .select({
            id: orderItems.id,
            orderId: orderItems.orderId,
            quantity: orderItems.quantity,
            descriptionSnapshot: orderItems.descriptionSnapshot,
            supplierSkuSnapshot: orderItems.supplierSkuSnapshot,
          })
          .from(orderItems)
          .where(inArray(orderItems.orderId, orderIds));

        const itemsByOrderId = new Map<string, typeof orderItemRows>();
        for (const item of orderItemRows) {
          const bucket = itemsByOrderId.get(item.orderId) ?? [];
          bucket.push(item);
          itemsByOrderId.set(item.orderId, bucket);
        }

        return insertedOrders.map((order) => ({
          ...order,
          supplier: order.supplierId
            ? (suppliersById.get(order.supplierId) ?? null)
            : null,
          items: (itemsByOrderId.get(order.id) ?? []).map(
            ({ orderId, ...item }) => item,
          ),
        }));
      });

      return createdOrders;
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
          quantity: orderItems.quantity,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, input.orderId));

      const jobName = order.job?.name || "Job";
      const supplierContactName = firstName(
        order.supplier?.contactName || order.supplier?.name,
      );
      const poNumber =
        order.job?.poNumber?.trim() ||
        order.orderNumber?.trim() ||
        `PO-${order.id.slice(0, 8)}`;
      const deliveryDate = getNextBusinessDay();
      const formattedDeliveryDate = deliveryDate.toLocaleDateString("en-CA", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
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
        "",
        "Thanks,",
        ctx.user.name || "Foreman",
      ];

      const subject = `Material Order ${poNumber} - ${jobName}`;
      const body = sections.join("\n");

      return { subject, body };
    }),

  /**
   * Mark order as sent
   */
  markOrderSent: hasDashboardAccess
    .input(
      z.object({
        orderId: z.string().uuid(),
        sentTo: z.string().email(),
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
      .where(eq(quotes.organizationId, ctx.user.organizationId))
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
          supplierId: orders.supplierId,
          supplierName: suppliers.name,
          supplierContactEmail: suppliers.contactEmail,
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
          quantity: orderItems.quantity,
          descriptionSnapshot: orderItems.descriptionSnapshot,
          supplierSkuSnapshot: orderItems.supplierSkuSnapshot,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, input.orderId));

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        notes: order.notes,
        createdAt: order.createdAt,
        sentAt: order.sentAt,
        supplier: order.supplierId
          ? {
              id: order.supplierId,
              name: order.supplierName ?? "",
              contactEmail: order.supplierContactEmail,
            }
          : null,
        items,
      };
    }),

  /**
   * List all orders for the organization with material lists
   */
  listOrders: hasDashboardAccess.query(async ({ ctx }) => {
    if (!ctx.user.organizationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "User must belong to an organization",
      });
    }

    // Get all orders with supplier, job, and material list info
    const ordersList = await ctx.db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
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
      })
      .from(orders)
      .leftJoin(jobs, eq(orders.jobId, jobs.id))
      .leftJoin(materialLists, eq(orders.materialListId, materialLists.id))
      .leftJoin(suppliers, eq(orders.supplierId, suppliers.id))
      .where(eq(orders.organizationId, ctx.user.organizationId))
      .orderBy(desc(orders.createdAt));

    return ordersList.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
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
          }
        : null,
      materialList: order.materialListId
        ? {
            id: order.materialListId,
            name: order.materialListName ?? "",
          }
        : null,
    }));
  }),
});

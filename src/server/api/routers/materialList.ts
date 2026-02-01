import { TRPCError } from "@trpc/server";
import { eq, and, sql, desc } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import {
  jobs,
  materialLists,
  quotes,
  quoteItems,
  orders,
  orderItems,
  partDefinitions,
  sizes,
  supplierParts,
  suppliers,
  units,
  locations,
  users,
  materials,
  partTypes,
} from "~/server/db/schema";

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

      // Create material list
      const [materialList] = await ctx.db
        .insert(materialLists)
        .values({
          organizationId: ctx.user.organizationId,
          jobId: jobId,
          name: input.name ?? "New Material List",
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
          partDefinitionId: partDefinitions.id,
          partDefinitionDisplayName: partDefinitions.displayName,
          partDefinitionImageUrl: partDefinitions.imageUrl,
          partDefinitionMaterialId: partDefinitions.materialId,
          partDefinitionMaterialName: materials.name,
          supplierPartId: supplierParts.id,
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
          oneOffPartType: quoteItems.oneOffPartType,
          oneOffSizeNominal: quoteItems.oneOffSizeNominal,
          oneOffSizeUnitId: quoteItems.oneOffSizeUnitId,
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
        .where(eq(quoteItems.quoteId, quote.id));

      // Transform to nested structure
      const items = itemsRaw.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        unitCost: item.unitCost,
        extendedPrice: item.extendedPrice,
        descriptionSnapshot: item.descriptionSnapshot,
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
              partType: item.oneOffPartType,
              sizeNominal: item.oneOffSizeNominal,
              sizeUnitId: item.oneOffSizeUnitId,
            }
          : null,
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

      // Get item counts and totals for each material list
      const listsWithDetails = await Promise.all(
        materialListsData.map(async (list) => {
          // Get quote for this material list
          const [materialListWithQuote] = await ctx.db
            .select({ quoteId: materialLists.quoteId })
            .from(materialLists)
            .where(eq(materialLists.id, list.id))
            .limit(1);

          if (!materialListWithQuote?.quoteId) {
            return { ...list, itemCount: 0, materialTotal: 0 };
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

          return { ...list, itemCount, materialTotal };
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
        oneOffPartType: z.string().optional(),
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
        uomId = pd.defaultUomId;
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
          oneOffPartType: input.oneOffPartType ?? null,
          oneOffSizeNominal:
            input.oneOffSizeNominal !== undefined
              ? input.oneOffSizeNominal.toString()
              : null,
          oneOffSizeUnitId: input.oneOffSizeUnitId ?? null,
        })
        .returning();

      // Update quote subtotal
      const allItems = await ctx.db
        .select({ extendedPrice: quoteItems.extendedPrice })
        .from(quoteItems)
        .where(eq(quoteItems.quoteId, quote.id));

      const subtotal = allItems.reduce((sum, item) => {
        const price = item.extendedPrice
          ? parseFloat(item.extendedPrice.toString())
          : 0;
        return sum + price;
      }, 0);

      await ctx.db
        .update(quotes)
        .set({
          subtotalMaterials: subtotal.toString(),
          total: subtotal.toString(),
        })
        .where(eq(quotes.id, quote.id));

      return quoteItem;
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
            unitCost = supplierPart.lastKnownUnitCost
              ? parseFloat(supplierPart.lastKnownUnitCost.toString())
              : 0;
          }
        } else {
          unitCost = 0;
        }
      }

      const extendedPrice = quantity * unitCost;

      // Update quote item
      const [updated] = await ctx.db
        .update(quoteItems)
        .set({
          quantity: quantity.toString(),
          supplierPartId: input.supplierPartId ?? null,
          unitCost: unitCost.toString(),
          extendedPrice: extendedPrice.toString(),
        })
        .where(eq(quoteItems.id, input.itemId))
        .returning();

      // Update quote subtotal
      const allItems = await ctx.db
        .select({ extendedPrice: quoteItems.extendedPrice })
        .from(quoteItems)
        .where(eq(quoteItems.quoteId, quote.id));

      const subtotal = allItems.reduce((sum, item) => {
        const price = item.extendedPrice
          ? parseFloat(item.extendedPrice.toString())
          : 0;
        return sum + price;
      }, 0);

      await ctx.db
        .update(quotes)
        .set({
          subtotalMaterials: subtotal.toString(),
          total: subtotal.toString(),
        })
        .where(eq(quotes.id, quote.id));

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

      // Update quote subtotal
      const allItems = await ctx.db
        .select({ extendedPrice: quoteItems.extendedPrice })
        .from(quoteItems)
        .where(eq(quoteItems.quoteId, quote.id));

      const subtotal = allItems.reduce((sum, item) => {
        const price = item.extendedPrice
          ? parseFloat(item.extendedPrice.toString())
          : 0;
        return sum + price;
      }, 0);

      await ctx.db
        .update(quotes)
        .set({
          subtotalMaterials: subtotal.toString(),
          total: subtotal.toString(),
        })
        .where(eq(quotes.id, quote.id));

      return { success: true };
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
          partDefinitionId: quoteItems.partDefinitionId,
          quantity: quoteItems.quantity,
          uomId: quoteItems.uomId,
          unitCost: quoteItems.unitCost,
          descriptionSnapshot: quoteItems.descriptionSnapshot,
          supplierPart: {
            id: supplierParts.id,
            supplierId: supplierParts.supplierId,
            supplierSku: supplierParts.supplierSku,
          },
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
        if (!item.supplierPart?.supplierId) {
          // Skip items without supplier
          continue;
        }
        const supplierId = item.supplierPart.supplierId;
        if (!itemsBySupplier.has(supplierId)) {
          itemsBySupplier.set(supplierId, []);
        }
        itemsBySupplier.get(supplierId)!.push(item);
      }

      // Create orders
      const createdOrders = [];
      for (const [supplierId, items] of itemsBySupplier.entries()) {
        // Get job ID from material list
        const [materialListForOrder] = await ctx.db
          .select({ jobId: materialLists.jobId })
          .from(materialLists)
          .where(eq(materialLists.id, input.materialListId))
          .limit(1);

        if (!materialListForOrder) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Material list not found",
          });
        }

        // Create order
        const [order] = await ctx.db
          .insert(orders)
          .values({
            organizationId: ctx.user.organizationId,
            jobId: materialListForOrder.jobId,
            supplierId,
            createdByUserId: ctx.userId,
            status: "draft",
          })
          .returning();

        if (!order) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create order",
          });
        }

        // Create order items
        for (const item of items) {
          // Skip items without partDefinitionId (one-off items should not be in orders)
          if (!item.partDefinitionId) {
            continue;
          }
          await ctx.db.insert(orderItems).values({
            orderId: order.id,
            supplierPartId: item.supplierPartId ?? undefined,
            partDefinitionId: item.partDefinitionId,
            quantity: item.quantity ?? "1",
            uomId: item.uomId ?? undefined,
            unitCostAtOrderTime: item.unitCost ?? undefined,
            descriptionSnapshot: item.descriptionSnapshot ?? undefined,
            supplierSkuSnapshot: item.supplierPart?.supplierSku ?? undefined,
          });
        }

        // Get supplier info
        const [supplier] = await ctx.db
          .select({
            id: suppliers.id,
            name: suppliers.name,
            contactEmail: suppliers.contactEmail,
          })
          .from(suppliers)
          .where(eq(suppliers.id, supplierId))
          .limit(1);

        // Get order with items for return (including size unit)
        const orderItemsList = await ctx.db
          .select({
            id: orderItems.id,
            quantity: orderItems.quantity,
            descriptionSnapshot: orderItems.descriptionSnapshot,
            supplierSkuSnapshot: orderItems.supplierSkuSnapshot,
            sizeUnitCode: units.code,
          })
          .from(orderItems)
          .leftJoin(
            partDefinitions,
            eq(orderItems.partDefinitionId, partDefinitions.id),
          )
          .leftJoin(sizes, eq(partDefinitions.sizeId, sizes.id))
          .leftJoin(units, eq(sizes.unitId, units.id))
          .where(eq(orderItems.orderId, order.id));

        createdOrders.push({
          ...order,
          supplier: supplier ?? null,
          items: orderItemsList,
        });
      }

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
          notes: orders.notes,
          job: {
            id: jobs.id,
            name: jobs.name,
          },
          supplier: {
            id: suppliers.id,
            name: suppliers.name,
          },
        })
        .from(orders)
        .leftJoin(jobs, eq(orders.jobId, jobs.id))
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
          descriptionSnapshot: orderItems.descriptionSnapshot,
          quantity: orderItems.quantity,
          supplierSkuSnapshot: orderItems.supplierSkuSnapshot,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, input.orderId));

      const jobName = order.job?.name || "Job";
      const supplierName = order.supplier?.name || "Supplier";

      // Build email body
      const lineItems = items
        .map((item) => {
          const qty = item.quantity ? parseFloat(item.quantity.toString()) : 0;
          const sku = item.supplierSkuSnapshot
            ? ` (SKU: ${item.supplierSkuSnapshot})`
            : "";
          return `- ${item.descriptionSnapshot || "Item"} × ${qty}${sku}`;
        })
        .join("\n");

      const subject = `Material Order – ${jobName}`;
      let body = `Hi,

Please see the material order below:

Job: ${jobName}

${lineItems}`;

      // Add notes from order if available
      if (order.notes && order.notes.trim()) {
        body += `\n\nNotes:\n${order.notes.trim()}`;
      }

      body += `\n\nPlease confirm availability.

Thanks,
${ctx.user.name || "Foreman"}`;

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

      // Get all orders for the job associated with this material list
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
            eq(orders.jobId, materialList.jobId),
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

      // Get order items (including size unit)
      const items = await ctx.db
        .select({
          id: orderItems.id,
          quantity: orderItems.quantity,
          descriptionSnapshot: orderItems.descriptionSnapshot,
          supplierSkuSnapshot: orderItems.supplierSkuSnapshot,
          sizeUnitCode: units.code,
        })
        .from(orderItems)
        .leftJoin(
          partDefinitions,
          eq(orderItems.partDefinitionId, partDefinitions.id),
        )
        .leftJoin(sizes, eq(partDefinitions.sizeId, sizes.id))
        .leftJoin(units, eq(sizes.unitId, units.id))
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

    // Get all orders with supplier and job info
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
        supplierId: orders.supplierId,
        supplierName: suppliers.name,
        supplierContactEmail: suppliers.contactEmail,
      })
      .from(orders)
      .leftJoin(jobs, eq(orders.jobId, jobs.id))
      .leftJoin(suppliers, eq(orders.supplierId, suppliers.id))
      .where(eq(orders.organizationId, ctx.user.organizationId))
      .orderBy(desc(orders.createdAt));

    // For each order, find the most recent material list for the same job
    const ordersWithMaterialLists = await Promise.all(
      ordersList.map(async (order) => {
        // Get the most recent material list for this job
        const [materialList] = await ctx.db
          .select({
            id: materialLists.id,
            name: materialLists.name,
          })
          .from(materialLists)
          .where(
            and(
              eq(materialLists.jobId, order.jobId),
              eq(materialLists.organizationId, ctx.user.organizationId),
            ),
          )
          .orderBy(desc(materialLists.createdAt))
          .limit(1);

        return {
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
          materialList: materialList
            ? {
                id: materialList.id,
                name: materialList.name,
              }
            : null,
        };
      }),
    );

    return ordersWithMaterialLists;
  }),
});

import { TRPCError } from "@trpc/server";
import { eq, and, sql, desc } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import {
  jobs,
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
} from "~/server/db/schema";

export const materialListRouter = createTRPCRouter({
  /**
   * Create a new material list (draft job + draft quote)
   */
  createMaterialList: hasDashboardAccess.mutation(async ({ ctx }) => {
    if (!ctx.user.organizationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "User must belong to an organization",
      });
    }

      // Create draft job
      const [job] = await ctx.db
        .insert(jobs)
        .values({
          organizationId: ctx.user.organizationId,
          name: "New Material List",
          foremanUserId: ctx.userId,
          createdByUserId: ctx.userId,
          status: "draft",
        })
        .returning();

      if (!job) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create job",
        });
      }

      // Create draft quote linked to job
      const [quote] = await ctx.db
        .insert(quotes)
        .values({
          organizationId: ctx.user.organizationId,
          jobId: job.id,
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

      return { materialListId: job.id, quoteId: quote.id };
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

      // Get job
      const [job] = await ctx.db
        .select({
          id: jobs.id,
          name: jobs.name,
          locationId: jobs.locationId,
          foremanUserId: jobs.foremanUserId,
          status: jobs.status,
          createdAt: jobs.createdAt,
          location: {
            id: locations.id,
            name: locations.name,
          },
          foreman: {
            id: users.id,
            name: users.name,
            email: users.email,
          },
        })
        .from(jobs)
        .leftJoin(locations, eq(jobs.locationId, locations.id))
        .leftJoin(users, eq(jobs.foremanUserId, users.id))
        .where(
          and(
            eq(jobs.id, input.materialListId),
            eq(jobs.organizationId, ctx.user.organizationId),
            eq(jobs.status, "draft"),
          ),
        )
        .limit(1);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Material list not found",
        });
      }

      // Get draft quote for this job
      const [quote] = await ctx.db
        .select()
        .from(quotes)
        .where(
          and(
            eq(quotes.jobId, input.materialListId),
            eq(quotes.organizationId, ctx.user.organizationId),
          ),
        )
        .orderBy(desc(quotes.createdAt))
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
          partDefinitionMaterial: partDefinitions.material,
          supplierPartId: supplierParts.id,
          supplierPartSupplierId: supplierParts.supplierId,
          supplierPartSku: supplierParts.supplierSku,
          supplierPartLastKnownUnitCost: supplierParts.lastKnownUnitCost,
          supplierId: suppliers.id,
          supplierName: suppliers.name,
          uomId: units.id,
          uomCode: units.code,
          uomDisplayName: units.displayName,
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
              material: item.partDefinitionMaterial,
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
        job,
        quote,
        items,
        materialTotal,
      };
    }),

  /**
   * List all material lists (draft jobs) for the organization
   */
  listMaterialLists: hasDashboardAccess.query(async ({ ctx }) => {
    if (!ctx.user.organizationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "User must belong to an organization",
      });
    }

    const materialLists = await ctx.db
      .select({
        id: jobs.id,
        name: jobs.name,
        createdAt: jobs.createdAt,
        foreman: {
          id: users.id,
          name: users.name,
        },
      })
      .from(jobs)
      .leftJoin(users, eq(jobs.foremanUserId, users.id))
      .where(
        and(
          eq(jobs.organizationId, ctx.user.organizationId),
          eq(jobs.status, "draft"),
        ),
      )
      .orderBy(desc(jobs.createdAt));

    // Get item counts and totals for each material list
    const listsWithDetails = await Promise.all(
      materialLists.map(async (list) => {
        // Get quote for this job
        const [quote] = await ctx.db
          .select({ id: quotes.id })
          .from(quotes)
          .where(
            and(
              eq(quotes.jobId, list.id),
              eq(quotes.organizationId, ctx.user.organizationId!),
            ),
          )
          .orderBy(desc(quotes.createdAt))
          .limit(1);

        if (!quote) {
          return { ...list, itemCount: 0, materialTotal: 0 };
        }

        // Get items count and total
        const items = await ctx.db
          .select({
            extendedPrice: quoteItems.extendedPrice,
          })
          .from(quoteItems)
          .where(eq(quoteItems.quoteId, quote.id));

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
   * Update material list job info (name and location)
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

      // Verify job exists and belongs to organization
      const [existing] = await ctx.db
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.id, input.materialListId),
            eq(jobs.organizationId, ctx.user.organizationId),
            eq(jobs.status, "draft"),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Material list not found",
        });
      }

      // Update job
      const [updated] = await ctx.db
        .update(jobs)
        .set({
          name: input.name,
          locationId: input.locationId ?? null,
        })
        .where(eq(jobs.id, input.materialListId))
        .returning();

      return updated;
    }),

  /**
   * Add item to material list
   */
  addItemToMaterialList: hasDashboardAccess
    .input(
      z.object({
        materialListId: z.string().uuid(),
        partDefinitionId: z.string().uuid(),
        quantity: z.number().positive(),
        supplierPartId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // Get job and verify it exists
      const [job] = await ctx.db
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.id, input.materialListId),
            eq(jobs.organizationId, ctx.user.organizationId),
            eq(jobs.status, "draft"),
          ),
        )
        .limit(1);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Material list not found",
        });
      }

      // Get draft quote
      const [quote] = await ctx.db
        .select()
        .from(quotes)
        .where(
          and(
            eq(quotes.jobId, input.materialListId),
            eq(quotes.organizationId, ctx.user.organizationId),
          ),
        )
        .orderBy(desc(quotes.createdAt))
        .limit(1);

      if (!quote) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Quote not found for material list",
        });
      }

      // Get part definition
      const [partDef] = await ctx.db
        .select()
        .from(partDefinitions)
        .where(eq(partDefinitions.id, input.partDefinitionId))
        .limit(1);

      if (!partDef) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Part definition not found",
        });
      }

      // Determine supplier part
      let supplierPartId = input.supplierPartId;
      let supplierPart = null;
      let unitCost = null;

      if (supplierPartId) {
        // Use provided supplier part
        const [sp] = await ctx.db
          .select()
          .from(supplierParts)
          .where(
            and(
              eq(supplierParts.id, supplierPartId),
              eq(supplierParts.organizationId, ctx.user.organizationId),
            ),
          )
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
              eq(supplierParts.organizationId, ctx.user.organizationId),
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
          partDefinitionId: input.partDefinitionId,
          quantity: qty.toString(),
          uomId: partDef.defaultUomId,
          unitCost: unitCost,
          extendedPrice: extendedPrice.toString(),
          descriptionSnapshot: partDef.displayName,
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
      let quantity = input.quantity
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
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // Get job and verify it exists
      const [job] = await ctx.db
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.id, input.materialListId),
            eq(jobs.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Material list not found",
        });
      }

      // Get draft quote
      const [quote] = await ctx.db
        .select()
        .from(quotes)
        .where(
          and(
            eq(quotes.jobId, input.materialListId),
            eq(quotes.organizationId, ctx.user.organizationId),
          ),
        )
        .orderBy(desc(quotes.createdAt))
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
      const [updated] = await ctx.db
        .update(quotes)
        .set({
          markupPercent: input.markupPercent.toString(),
          subtotalMaterials: subtotalMaterials.toString(),
          total: total.toString(),
        })
        .where(eq(quotes.id, quote.id))
        .returning();

      return updated;
    }),

  /**
   * Get quote email content
   */
  getQuoteEmailContent: hasDashboardAccess
    .input(z.object({ quoteId: z.string().uuid() }))
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
      const subtotal = quote.subtotalMaterials
        ? parseFloat(quote.subtotalMaterials.toString())
        : 0;
      const markup = quote.markupPercent
        ? parseFloat(quote.markupPercent.toString())
        : 0;
      const total = quote.total ? parseFloat(quote.total.toString()) : 0;

      // Build email body
      const lineItems = items
        .map((item) => {
          const qty = item.quantity
            ? parseFloat(item.quantity.toString())
            : 0;
          const price = item.extendedPrice
            ? parseFloat(item.extendedPrice.toString())
            : 0;
          return `- ${item.descriptionSnapshot || "Item"} × ${qty}     $${price.toFixed(2)}`;
        })
        .join("\n");

      const subject = `Quote – ${jobName}`;
      const body = `Hi,

Here's the materials quote for the ${jobName}:

${lineItems}
-----------------------------
Materials subtotal: $${subtotal.toFixed(2)}
Markup: ${markup}%
Total: $${total.toFixed(2)}

Let me know if you'd like to move forward.

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

      // Get job
      const [job] = await ctx.db
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.id, input.materialListId),
            eq(jobs.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Material list not found",
        });
      }

      // Get quote items
      const [quote] = await ctx.db
        .select({ id: quotes.id })
        .from(quotes)
        .where(
          and(
            eq(quotes.jobId, input.materialListId),
            eq(quotes.organizationId, ctx.user.organizationId),
          ),
        )
        .orderBy(desc(quotes.createdAt))
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
        // Create order
        const [order] = await ctx.db
          .insert(orders)
          .values({
            organizationId: ctx.user.organizationId,
            jobId: input.materialListId,
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
          await ctx.db.insert(orderItems).values({
            orderId: order.id,
            supplierPartId: item.supplierPartId,
            partDefinitionId: item.partDefinitionId,
            quantity: item.quantity,
            uomId: item.uomId,
            unitCostAtOrderTime: item.unitCost,
            descriptionSnapshot: item.descriptionSnapshot,
            supplierSkuSnapshot: item.supplierPart?.supplierSku ?? null,
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

        // Get order with items for return
        const orderItemsList = await ctx.db
          .select({
            id: orderItems.id,
            quantity: orderItems.quantity,
            descriptionSnapshot: orderItems.descriptionSnapshot,
            supplierSkuSnapshot: orderItems.supplierSkuSnapshot,
          })
          .from(orderItems)
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
          const qty = item.quantity
            ? parseFloat(item.quantity.toString())
            : 0;
          const sku = item.supplierSkuSnapshot
            ? ` (SKU: ${item.supplierSkuSnapshot})`
            : "";
          return `- ${item.descriptionSnapshot || "Item"} × ${qty}${sku}`;
        })
        .join("\n");

      const subject = `Material Order – ${jobName}`;
      const body = `Hi,

Please see the material order below:

Job: ${jobName}

${lineItems}

Please confirm availability.

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
      const [updated] = await ctx.db
        .update(orders)
        .set({
          status: "sent",
          sentVia: "email",
          sentTo: input.sentTo,
          sentAt: new Date(),
        })
        .where(eq(orders.id, input.orderId))
        .returning();

      return updated;
    }),
});


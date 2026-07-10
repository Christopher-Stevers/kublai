import { TRPCError } from "@trpc/server";
import { eq, and, desc, asc, isNull, inArray } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import { assertCanDeleteCoreRecords } from "~/server/auth/permissions";
import {
  suppliers,
  supplierParts,
  partDefinitions,
  units,
  locations,
} from "~/server/db/schema";
import {
  getPrimarySupplierContact,
  normalizeSupplierContacts,
} from "~/lib/supplier-contacts";

const supplierContactsInput = z.unknown().optional().nullable();

export const supplierRouter = createTRPCRouter({
  /**
   * Get all suppliers for the user's organization
   */
  list: hasDashboardAccess.query(async ({ ctx }) => {
    if (!ctx.user.organizationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "User must belong to an organization",
      });
    }

    const supplierList = await ctx.db
      .select({
        id: suppliers.id,
        organizationId: suppliers.organizationId,
        name: suppliers.name,
        contactName: suppliers.contactName,
        contactEmail: suppliers.contactEmail,
        contactPhone: suppliers.contactPhone,
        contacts: suppliers.contacts,
        orderingNotes: suppliers.orderingNotes,
        locationId: suppliers.locationId,
        createdAt: suppliers.createdAt,
        updatedAt: suppliers.updatedAt,
        location: {
          id: locations.id,
          name: locations.name,
          city: locations.city,
          region: locations.region,
        },
      })
      .from(suppliers)
      .leftJoin(locations, eq(suppliers.locationId, locations.id))
      .orderBy(suppliers.name);

    return supplierList;
  }),

  /**
   * Get a single supplier by ID with related supplierParts
   */
  getById: hasDashboardAccess
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const [supplier] = await ctx.db
        .select({
          id: suppliers.id,
          organizationId: suppliers.organizationId,
          name: suppliers.name,
          contactName: suppliers.contactName,
          contactEmail: suppliers.contactEmail,
          contactPhone: suppliers.contactPhone,
          contacts: suppliers.contacts,
          orderingNotes: suppliers.orderingNotes,
          locationId: suppliers.locationId,
          createdAt: suppliers.createdAt,
          location: {
            id: locations.id,
            name: locations.name,
            city: locations.city,
            region: locations.region,
          },
        })
        .from(suppliers)
        .leftJoin(locations, eq(suppliers.locationId, locations.id))
        .where(
          and(
            eq(suppliers.id, input.id),
            eq(suppliers.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!supplier) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Supplier not found",
        });
      }

      // Get supplier parts with part definition details
      const supplierPartsList = await ctx.db
        .select({
          id: supplierParts.id,
          supplierId: supplierParts.supplierId,
          partDefinitionId: supplierParts.partDefinitionId,
          supplierSku: supplierParts.supplierSku,
          supplierName: supplierParts.supplierName,
          packSize: supplierParts.packSize,
          packUomId: supplierParts.packUomId,
          lastKnownUnitCost: supplierParts.lastKnownUnitCost,
          currency: supplierParts.currency,
          isPreferred: supplierParts.isPreferred,
          notes: supplierParts.notes,
          createdAt: supplierParts.createdAt,
          partDefinition: {
            id: partDefinitions.id,
            displayName: partDefinitions.displayName,
            description: partDefinitions.description,
          },
          packUom: {
            id: units.id,
            code: units.code,
            displayName: units.displayName,
          },
        })
        .from(supplierParts)
        .leftJoin(
          partDefinitions,
          eq(supplierParts.partDefinitionId, partDefinitions.id),
        )
        .leftJoin(units, eq(supplierParts.packUomId, units.id))
        .where(
          and(
            eq(supplierParts.supplierId, input.id),
            eq(supplierParts.organizationId, ctx.user.organizationId),
          ),
        )
        .orderBy(supplierParts.supplierSku);

      return {
        ...supplier,
        supplierParts: supplierPartsList,
      };
    }),

  /**
   * Create a new supplier
   */
  create: hasDashboardAccess
    .input(
      z.object({
        name: z
          .string()
          .min(1, "Supplier name is required")
          .max(255, "Supplier name must be less than 255 characters")
          .trim(),
        contactName: z.string().max(255).optional().or(z.literal("")),
        contactEmail: z
          .union([z.string().email("Invalid email address"), z.literal("")])
          .optional(),
        contactPhone: z.string().max(50).optional().or(z.literal("")),
        contacts: supplierContactsInput,
        orderingNotes: z.string().optional(),
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

      try {
        const contacts = normalizeSupplierContacts(input.contacts, input);
        const primaryContact = getPrimarySupplierContact(contacts);
        const [newSupplier] = await ctx.db
          .insert(suppliers)
          .values({
            organizationId: ctx.user.organizationId,
            name: input.name,
            contactName: primaryContact?.name ?? input.contactName ?? null,
            contactEmail: primaryContact?.email ?? input.contactEmail ?? null,
            contactPhone: primaryContact?.phone ?? input.contactPhone ?? null,
            contacts,
            orderingNotes: input.orderingNotes ?? null,
            locationId: input.locationId ?? null,
            updatedAt: new Date(),
          })
          .returning();

        return newSupplier;
      } catch (error) {
        // Check for unique constraint violation
        if (
          error instanceof Error &&
          error.message.includes("supplier_org_name_uniq")
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "A supplier with this name already exists in your organization",
          });
        }

        console.error("Error creating supplier:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create supplier",
          cause: error,
        });
      }
    }),

  /**
   * Update supplier details
   */
  update: hasDashboardAccess
    .input(
      z.object({
        id: z.string().uuid(),
        name: z
          .string()
          .min(1, "Supplier name is required")
          .max(255, "Supplier name must be less than 255 characters")
          .trim(),
        contactName: z.string().max(255).optional().or(z.literal("")),
        contactEmail: z
          .union([z.string().email("Invalid email address"), z.literal("")])
          .optional(),
        contactPhone: z.string().max(50).optional().or(z.literal("")),
        contacts: supplierContactsInput,
        orderingNotes: z.string().optional(),
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

      // Verify supplier exists and belongs to organization
      const [existing] = await ctx.db
        .select()
        .from(suppliers)
        .where(
          and(
            eq(suppliers.id, input.id),
            eq(suppliers.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Supplier not found",
        });
      }

      try {
        const contacts = normalizeSupplierContacts(input.contacts, input);
        const primaryContact = getPrimarySupplierContact(contacts);
        const [updated] = await ctx.db
          .update(suppliers)
          .set({
            name: input.name,
            contactName: primaryContact?.name ?? input.contactName ?? null,
            contactEmail: primaryContact?.email ?? input.contactEmail ?? null,
            contactPhone: primaryContact?.phone ?? input.contactPhone ?? null,
            contacts,
            orderingNotes: input.orderingNotes ?? null,
            locationId: input.locationId ?? null,
          })
          .where(
            and(
              eq(suppliers.id, input.id),
              eq(suppliers.organizationId, ctx.user.organizationId),
            ),
          )
          .returning();

        return updated;
      } catch (error) {
        // Check for unique constraint violation
        if (
          error instanceof Error &&
          error.message.includes("supplier_org_name_uniq")
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "A supplier with this name already exists in your organization",
          });
        }

        console.error("Error updating supplier:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update supplier",
          cause: error,
        });
      }
    }),

  /**
   * Delete a supplier
   */
  delete: hasDashboardAccess
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertCanDeleteCoreRecords(ctx.user);

      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // Verify supplier exists and belongs to organization
      const [existing] = await ctx.db
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, input.id)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Supplier not found",
        });
      }

      // Delete supplier (cascade will handle supplierParts)
      await ctx.db.delete(suppliers).where(eq(suppliers.id, input.id));

      return { success: true };
    }),

  /**
   * Get all parts for a specific supplier
   */
  getSupplierParts: hasDashboardAccess
    .input(z.object({ supplierId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const parts = await ctx.db
        .select({
          id: supplierParts.id,
          supplierId: supplierParts.supplierId,
          partDefinitionId: supplierParts.partDefinitionId,
          supplierSku: supplierParts.supplierSku,
          supplierName: supplierParts.supplierName,
          packSize: supplierParts.packSize,
          packUomId: supplierParts.packUomId,
          lastKnownUnitCost: supplierParts.lastKnownUnitCost,
          currency: supplierParts.currency,
          isPreferred: supplierParts.isPreferred,
          notes: supplierParts.notes,
          createdAt: supplierParts.createdAt,
          partDefinition: {
            id: partDefinitions.id,
            displayName: partDefinitions.displayName,
            description: partDefinitions.description,
          },
          packUom: {
            id: units.id,
            code: units.code,
            displayName: units.displayName,
          },
        })
        .from(supplierParts)
        .leftJoin(
          partDefinitions,
          eq(supplierParts.partDefinitionId, partDefinitions.id),
        )
        .leftJoin(units, eq(supplierParts.packUomId, units.id))
        .where(and(eq(supplierParts.supplierId, input.supplierId)))
        .orderBy(supplierParts.supplierSku);

      return parts;
    }),

  /**
   * Add a part to a supplier
   */
  addSupplierPart: hasDashboardAccess
    .input(
      z.object({
        supplierId: z.string().uuid(),
        partDefinitionId: z.string().uuid(),
        supplierSku: z.string().max(255).optional().or(z.literal("")),
        supplierName: z.string().optional(),
        packSize: z.string().optional(),
        packUomId: z.string().uuid().optional(),
        lastKnownUnitCost: z.string().optional(),
        isPreferred: z.boolean().optional(),
        currency: z.string().max(10).default("CAD"),
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

      // Verify supplier exists and belongs to organization
      const [supplier] = await ctx.db
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, input.supplierId)))
        .limit(1);

      if (!supplier) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Supplier not found",
        });
      }

      // Verify part definition exists
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

      // Normalize supplierSku: convert empty strings to null
      const normalizedSku =
        input.supplierSku && input.supplierSku.trim() !== ""
          ? input.supplierSku.trim()
          : null;

      const existingSupplierPartsForPart = await ctx.db
        .select({
          id: supplierParts.id,
          lastKnownUnitCost: supplierParts.lastKnownUnitCost,
          currency: supplierParts.currency,
          isPreferred: supplierParts.isPreferred,
        })
        .from(supplierParts)
        .where(
          and(
            eq(supplierParts.organizationId, ctx.user.organizationId),
            eq(supplierParts.partDefinitionId, input.partDefinitionId),
          ),
        );

      const existingPartWithPricing = existingSupplierPartsForPart.find(
        (supplierPart) => supplierPart.lastKnownUnitCost !== null,
      );
      const shouldSetPreferred =
        input.isPreferred === true ||
        !existingSupplierPartsForPart.some(
          (supplierPart) => supplierPart.isPreferred,
        );

      if (shouldSetPreferred) {
        await ctx.db
          .update(supplierParts)
          .set({ isPreferred: false })
          .where(
            and(
              eq(supplierParts.organizationId, ctx.user.organizationId),
              eq(supplierParts.partDefinitionId, input.partDefinitionId),
              eq(supplierParts.isPreferred, true),
            ),
          );
      }

      // Check if this supplier already has this part (by supplierId + partDefinitionId)
      const [existingSupplierPart] = await ctx.db
        .select()
        .from(supplierParts)
        .where(
          and(
            eq(supplierParts.supplierId, input.supplierId),
            eq(supplierParts.partDefinitionId, input.partDefinitionId),
            eq(supplierParts.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      // If exists, update it
      if (existingSupplierPart) {
        const [updated] = await ctx.db
          .update(supplierParts)
          .set({
            supplierSku: normalizedSku ?? existingSupplierPart.supplierSku,
            supplierName:
              input.supplierName ?? existingSupplierPart.supplierName,
            packSize: input.packSize ?? existingSupplierPart.packSize,
            packUomId: input.packUomId ?? existingSupplierPart.packUomId,
            lastKnownUnitCost:
              input.lastKnownUnitCost ??
              existingSupplierPart.lastKnownUnitCost ??
              existingPartWithPricing?.lastKnownUnitCost ??
              null,
            currency:
              input.currency ??
              existingSupplierPart.currency ??
              existingPartWithPricing?.currency ??
              "CAD",
            notes: input.notes ?? existingSupplierPart.notes,
            isPreferred: shouldSetPreferred
              ? true
              : existingSupplierPart.isPreferred,
          })
          .where(eq(supplierParts.id, existingSupplierPart.id))
          .returning();

        return updated;
      }

      // Try to insert, handling unique constraint on (organizationId, supplierId, supplierSku)
      try {
        const [newSupplierPart] = await ctx.db
          .insert(supplierParts)
          .values({
            organizationId: ctx.user.organizationId,
            supplierId: input.supplierId,
            partDefinitionId: input.partDefinitionId,
            supplierSku: normalizedSku,
            supplierName: input.supplierName ?? null,
            packSize: input.packSize ?? null,
            packUomId: input.packUomId ?? null,
            lastKnownUnitCost:
              input.lastKnownUnitCost ??
              existingPartWithPricing?.lastKnownUnitCost ??
              null,
            currency:
              input.currency ?? existingPartWithPricing?.currency ?? "CAD",
            notes: input.notes ?? null,
            isPreferred: shouldSetPreferred,
          })
          .returning();

        return newSupplierPart;
      } catch (error) {
        // Check for unique constraint violation on (organizationId, supplierId, supplierSku)
        if (
          error instanceof Error &&
          error.message.includes("supplier_part_org_supplier_sku_uniq")
        ) {
          // Find the existing record with the same SKU and update it
          const skuCondition = normalizedSku
            ? eq(supplierParts.supplierSku, normalizedSku)
            : isNull(supplierParts.supplierSku);

          const [existingBySku] = await ctx.db
            .select()
            .from(supplierParts)
            .where(
              and(
                eq(supplierParts.organizationId, ctx.user.organizationId),
                eq(supplierParts.supplierId, input.supplierId),
                skuCondition,
              ),
            )
            .limit(1);

          if (existingBySku) {
            // Update the existing record
            const [updated] = await ctx.db
              .update(supplierParts)
              .set({
                partDefinitionId: input.partDefinitionId,
                supplierName: input.supplierName ?? existingBySku.supplierName,
                packSize: input.packSize ?? existingBySku.packSize,
                packUomId: input.packUomId ?? existingBySku.packUomId,
                lastKnownUnitCost:
                  input.lastKnownUnitCost ??
                  existingBySku.lastKnownUnitCost ??
                  existingPartWithPricing?.lastKnownUnitCost ??
                  null,
                currency:
                  input.currency ??
                  existingBySku.currency ??
                  existingPartWithPricing?.currency ??
                  "CAD",
                notes: input.notes ?? existingBySku.notes,
                isPreferred: shouldSetPreferred
                  ? true
                  : existingBySku.isPreferred,
              })
              .where(eq(supplierParts.id, existingBySku.id))
              .returning();

            return updated;
          }
        }

        console.error("Error adding supplier part:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to add part to supplier",
          cause: error,
        });
      }
    }),

  /**
   * Update supplier part details
   */
  updateSupplierPart: hasDashboardAccess
    .input(
      z.object({
        id: z.string().uuid(),
        supplierSku: z.string().max(255).optional().or(z.literal("")),
        supplierName: z.string().optional(),
        packSize: z.string().optional(),
        packUomId: z.string().uuid().optional(),
        lastKnownUnitCost: z.string().optional(),
        currency: z.string().max(10).optional(),
        isPreferred: z.boolean().optional(),
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

      // Verify supplier part exists and belongs to organization
      const [existing] = await ctx.db
        .select()
        .from(supplierParts)
        .where(and(eq(supplierParts.id, input.id)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Supplier part not found",
        });
      }

      // If setting as preferred, unset other preferred suppliers for this part
      if (input.isPreferred === true) {
        await ctx.db
          .update(supplierParts)
          .set({ isPreferred: false })
          .where(
            and(
              eq(supplierParts.partDefinitionId, existing.partDefinitionId),

              eq(supplierParts.isPreferred, true),
            ),
          );
      }

      try {
        const updateData: Partial<typeof supplierParts.$inferInsert> = {};
        if (input.supplierSku !== undefined)
          updateData.supplierSku = input.supplierSku ?? null;
        if (input.supplierName !== undefined)
          updateData.supplierName = input.supplierName ?? null;
        if (input.packSize !== undefined)
          updateData.packSize = input.packSize ?? null;
        if (input.packUomId !== undefined)
          updateData.packUomId = input.packUomId ?? null;
        if (input.lastKnownUnitCost !== undefined)
          updateData.lastKnownUnitCost = input.lastKnownUnitCost ?? null;
        if (input.currency !== undefined) updateData.currency = input.currency;
        if (input.isPreferred !== undefined)
          updateData.isPreferred = input.isPreferred;
        if (input.notes !== undefined) updateData.notes = input.notes ?? null;

        const [updated] = await ctx.db
          .update(supplierParts)
          .set(updateData)
          .where(eq(supplierParts.id, input.id))
          .returning();

        return updated;
      } catch (error) {
        console.error("Error updating supplier part:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update supplier part",
          cause: error,
        });
      }
    }),

  /**
   * Remove a part from a supplier
   */
  removeSupplierPart: hasDashboardAccess
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertCanDeleteCoreRecords(ctx.user);

      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // Verify supplier part exists and belongs to organization
      const [existing] = await ctx.db
        .select()
        .from(supplierParts)
        .where(and(eq(supplierParts.id, input.id)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Supplier part not found",
        });
      }

      await ctx.db.delete(supplierParts).where(eq(supplierParts.id, input.id));

      return { success: true };
    }),

  /**
   * Set preferred supplier for a part
   */
  setPreferredSupplier: hasDashboardAccess
    .input(
      z.object({
        partDefinitionId: z.string().uuid(),
        supplierId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // Verify supplier exists and belongs to organization
      const [supplier] = await ctx.db
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, input.supplierId)))
        .limit(1);

      if (!supplier) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Supplier not found",
        });
      }

      // Verify part definition exists
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

      // Unset existing preferred supplier for this part
      await ctx.db
        .update(supplierParts)
        .set({ isPreferred: false })
        .where(
          and(
            eq(supplierParts.partDefinitionId, input.partDefinitionId),
            eq(supplierParts.isPreferred, true),
          ),
        );

      // Find or create supplierPart for this supplier and part
      const [existingSupplierPart] = await ctx.db
        .select()
        .from(supplierParts)
        .where(
          and(
            eq(supplierParts.supplierId, input.supplierId),
            eq(supplierParts.partDefinitionId, input.partDefinitionId),
          ),
        )
        .limit(1);

      if (existingSupplierPart) {
        // Update existing supplierPart to be preferred
        const [updated] = await ctx.db
          .update(supplierParts)
          .set({ isPreferred: true })
          .where(eq(supplierParts.id, existingSupplierPart.id))
          .returning();

        return updated;
      } else {
        // Create new supplierPart and set as preferred
        const [newSupplierPart] = await ctx.db
          .insert(supplierParts)
          .values({
            organizationId: ctx.user.organizationId,
            supplierId: input.supplierId,
            partDefinitionId: input.partDefinitionId,
            isPreferred: true,
          })
          .returning();

        return newSupplierPart;
      }
    }),

  /**
   * Get preferred supplier for a specific part
   */
  getPreferredSupplier: hasDashboardAccess
    .input(z.object({ partDefinitionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const [preferred] = await ctx.db
        .select({
          supplierPart: supplierParts,
          supplier: suppliers,
        })
        .from(supplierParts)
        .innerJoin(suppliers, eq(supplierParts.supplierId, suppliers.id))
        .where(
          and(
            eq(supplierParts.partDefinitionId, input.partDefinitionId),
            eq(supplierParts.isPreferred, true),
          ),
        )
        .limit(1);

      return preferred ?? null;
    }),

  /**
   * Get all supplier parts for a specific part definition
   */
  getSupplierPartsByPart: hasDashboardAccess
    .input(z.object({ partDefinitionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const parts = await ctx.db
        .select({
          id: supplierParts.id,
          supplierId: supplierParts.supplierId,
          supplierSku: supplierParts.supplierSku,
          lastKnownUnitCost: supplierParts.lastKnownUnitCost,
          isPreferred: supplierParts.isPreferred,
          supplier: {
            id: suppliers.id,
            name: suppliers.name,
          },
        })
        .from(supplierParts)
        .innerJoin(suppliers, eq(supplierParts.supplierId, suppliers.id))
        .where(and(eq(supplierParts.partDefinitionId, input.partDefinitionId)))
        .orderBy(desc(supplierParts.isPreferred), asc(suppliers.name));

      return parts;
    }),

  /**
   * Get supplier parts for several part definitions so the client can cache
   * supplier choices for offline review/add flows.
   */
  getSupplierPartsByParts: hasDashboardAccess
    .input(
      z.object({ partDefinitionIds: z.array(z.string().uuid()).max(1000) }),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const partDefinitionIds = Array.from(new Set(input.partDefinitionIds));
      if (partDefinitionIds.length === 0) return {};

      const rows = await ctx.db
        .select({
          partDefinitionId: supplierParts.partDefinitionId,
          id: supplierParts.id,
          supplierId: supplierParts.supplierId,
          supplierSku: supplierParts.supplierSku,
          lastKnownUnitCost: supplierParts.lastKnownUnitCost,
          isPreferred: supplierParts.isPreferred,
          supplier: {
            id: suppliers.id,
            name: suppliers.name,
          },
        })
        .from(supplierParts)
        .innerJoin(suppliers, eq(supplierParts.supplierId, suppliers.id))
        .where(
          and(
            eq(supplierParts.organizationId, ctx.user.organizationId),
            inArray(supplierParts.partDefinitionId, partDefinitionIds),
          ),
        )
        .orderBy(
          supplierParts.partDefinitionId,
          desc(supplierParts.isPreferred),
          asc(suppliers.name),
        );

      return rows.reduce<
        Record<string, Array<Omit<(typeof rows)[number], "partDefinitionId">>>
      >((acc, row) => {
        const { partDefinitionId, ...supplierPart } = row;
        (acc[partDefinitionId] ??= []).push(supplierPart);
        return acc;
      }, {});
    }),

  /**
   * Get all parts with their preferred suppliers
   */
  getAllPartsWithPreferred: hasDashboardAccess.query(async ({ ctx }) => {
    if (!ctx.user.organizationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "User must belong to an organization",
      });
    }

    // Get all parts for the organization
    const parts = await ctx.db
      .select({
        id: partDefinitions.id,
        displayName: partDefinitions.displayName,
        description: partDefinitions.description,
        isActive: partDefinitions.isActive,
      })
      .from(partDefinitions)
      .orderBy(partDefinitions.displayName);

    // Get preferred suppliers for all parts
    const preferredSuppliers = await ctx.db
      .select({
        supplierPart: supplierParts,
        supplier: suppliers,
        partDefinitionId: supplierParts.partDefinitionId,
      })
      .from(supplierParts)
      .innerJoin(suppliers, eq(supplierParts.supplierId, suppliers.id))
      .where(and(eq(supplierParts.isPreferred, true)));

    // Create a map of partDefinitionId -> preferred supplier
    const preferredMap = new Map(
      preferredSuppliers.map((ps) => [ps.partDefinitionId, ps.supplier]),
    );

    // Get all suppliers for each part
    const allSupplierParts = await ctx.db
      .select({
        supplierPart: supplierParts,
        supplier: suppliers,
        partDefinitionId: supplierParts.partDefinitionId,
      })
      .from(supplierParts)
      .innerJoin(suppliers, eq(supplierParts.supplierId, suppliers.id));

    // Group suppliers by part
    const suppliersByPart = new Map<
      string,
      (typeof suppliers.$inferSelect)[]
    >();
    for (const sp of allSupplierParts) {
      const existing = suppliersByPart.get(sp.partDefinitionId) ?? [];
      existing.push(sp.supplier);
      suppliersByPart.set(sp.partDefinitionId, existing);
    }

    return parts.map((part) => ({
      ...part,
      preferredSupplier: preferredMap.get(part.id) ?? null,
      availableSuppliers: suppliersByPart.get(part.id) ?? [],
    }));
  }),
});

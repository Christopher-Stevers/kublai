import { TRPCError } from "@trpc/server";
import { eq, and, or, ilike, asc } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import { locations } from "~/server/db/schema";

export const locationRouter = createTRPCRouter({
  /**
   * Search locations by name, address, city, region, or postal code
   */
  searchLocations: hasDashboardAccess
    .input(
      z.object({
        query: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const conditions = [
        eq(locations.organizationId, ctx.user.organizationId),
      ];

      // If query provided, search across multiple fields
      if (input.query && input.query.trim().length > 0) {
        const searchTerm = `%${input.query.trim()}%`;
        conditions.push(
          or(
            ilike(locations.name, searchTerm),
            ilike(locations.address1, searchTerm),
            ilike(locations.city, searchTerm),
            ilike(locations.region, searchTerm),
            ilike(locations.postalCode, searchTerm),
          ),
        );
      }

      const locationList = await ctx.db
        .select()
        .from(locations)
        .where(and(...conditions))
        .orderBy(asc(locations.name));

      return locationList;
    }),

  /**
   * Create a new location
   */
  createLocation: hasDashboardAccess
    .input(
      z.object({
        name: z
          .string()
          .min(1, "Location name is required")
          .max(255, "Location name must be less than 255 characters")
          .trim(),
        address1: z.string().max(255).optional().or(z.literal("")),
        address2: z.string().max(255).optional().or(z.literal("")),
        city: z.string().max(100).optional().or(z.literal("")),
        region: z.string().max(100).optional().or(z.literal("")),
        postalCode: z.string().max(30).optional().or(z.literal("")),
        country: z.string().max(100).optional().or(z.literal("")),
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

      try {
        const [newLocation] = await ctx.db
          .insert(locations)
          .values({
            organizationId: ctx.user.organizationId,
            name: input.name,
            address1: input.address1 || null,
            address2: input.address2 || null,
            city: input.city || null,
            region: input.region || null,
            postalCode: input.postalCode || null,
            country: input.country || null,
            notes: input.notes || null,
          })
          .returning();

        return newLocation;
      } catch (error) {
        console.error("Error creating location:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create location",
          cause: error,
        });
      }
    }),
});


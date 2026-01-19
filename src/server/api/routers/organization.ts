import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  organizations,
  pricingProfiles,
  users,
} from "~/server/db/schema";
import { seedOrganization } from "~/server/utils/seed-organization";

export const organizationRouter = createTRPCRouter({
  /**
   * Create organization and assign user to it
   * Also auto-creates default pricing profile with 15% markup
   */
  createOrganization: protectedProcedure
    .input(
      z.object({
        name: z
          .string()
          .min(1, "Organization name is required")
          .max(255, "Organization name must be less than 255 characters")
          .trim(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;

      if (!user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not found",
        });
      }

      // Check if user already has an organization
      if (user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User already belongs to an organization",
        });
      }

      try {
        // Create organization
        const [organization] = await ctx.db
          .insert(organizations)
          .values({
            name: input.name,
          })
          .returning();

        if (!organization) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create organization",
          });
        }

        // Create default pricing profile with 15% markup
        const [pricingProfile] = await ctx.db
          .insert(pricingProfiles)
          .values({
            organizationId: organization.id,
            name: "Default",
            defaultMarkupPercent: "15",
          })
          .returning();

        // Assign user to organization
        await ctx.db
          .update(users)
          .set({
            organizationId: organization.id,
          })
          .where(eq(users.id, user.id));

        // Seed organization with default parts (async, don't wait)
        seedOrganization(ctx.db, organization.id).catch((error) => {
          console.error("Error seeding organization:", error);
          // Don't throw - seeding failure shouldn't prevent org creation
        });

        return {
          organization,
          pricingProfile,
        };
      } catch (error) {
        // Check for unique constraint violation (duplicate name)
        if (
          error instanceof Error &&
          error.message.includes("organization_name_uniq")
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "An organization with this name already exists",
          });
        }

        console.error("Error creating organization:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create organization",
          cause: error,
        });
      }
    }),
});


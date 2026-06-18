import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  createTRPCRouter,
  hasDashboardAccess,
  protectedProcedure,
} from "~/server/api/trpc";
import {
  assertCanManageOrganization,
  getUserPermissions,
} from "~/server/auth/permissions";
import {
  locations,
  organizationInvites,
  organizations,
  pricingProfiles,
  users,
} from "~/server/db/schema";
import { seedOrganization } from "~/server/utils/seed-organization";

const invitePermissionConfigSchema = z.object({
  tabs: z.object({
    dashboard: z.boolean(),
    catalogue: z.boolean(),
    suppliers: z.boolean(),
    quotes: z.boolean(),
    orders: z.boolean(),
  }),
  actions: z.object({
    canCreateParts: z.boolean(),
    canEditParts: z.boolean(),
    canDeleteParts: z.boolean(),
    canDelete: z.boolean(),
  }),
});
const memberAccessStatusSchema = z.enum(["approved", "pending", "denied"]);

function createInviteToken() {
  return crypto.randomBytes(24).toString("base64url");
}

export const organizationRouter = createTRPCRouter({
  getOrganizationSettings: hasDashboardAccess.query(async ({ ctx }) => {
    assertCanManageOrganization(ctx.user);

    if (!ctx.user.organizationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "User must belong to an organization",
      });
    }

    const [organization] = await ctx.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, ctx.user.organizationId))
      .limit(1);

    if (!organization) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Organization not found",
      });
    }

    const [profileList, locationList, inviteList, memberList] =
      await Promise.all([
        ctx.db
          .select()
          .from(pricingProfiles)
          .where(eq(pricingProfiles.organizationId, ctx.user.organizationId))
          .orderBy(asc(pricingProfiles.name)),
        ctx.db
          .select()
          .from(locations)
          .where(eq(locations.organizationId, ctx.user.organizationId))
          .orderBy(asc(locations.name)),
        ctx.db
          .select()
          .from(organizationInvites)
          .where(
            and(
              eq(organizationInvites.organizationId, ctx.user.organizationId),
              isNull(organizationInvites.revokedAt),
              gt(organizationInvites.expiresAt, new Date()),
            ),
          )
          .orderBy(desc(organizationInvites.createdAt)),
        ctx.db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            role: users.role,
            permissionConfig: users.permissionConfig,
            organizationAccessStatus: users.organizationAccessStatus,
            stripeSubscriptionId: users.stripeSubscriptionId,
            subscriptionStatus: users.subscriptionStatus,
            subscriptionEndsAt: users.subscriptionEndsAt,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(eq(users.organizationId, ctx.user.organizationId))
          .orderBy(asc(users.name), asc(users.email)),
      ]);

    return {
      organization,
      pricingProfiles: profileList,
      locations: locationList,
      invites: inviteList,
      members: memberList.map((member) => ({
        ...member,
        organizationAccessStatus: member.organizationAccessStatus ?? "approved",
        permissions: getUserPermissions(member),
      })),
    };
  }),

  updateOrganizationMember: hasDashboardAccess
    .input(
      z.object({
        userId: z.string().min(1),
        accessStatus: memberAccessStatusSchema,
        permissions: invitePermissionConfigSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageOrganization(ctx.user);

      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      if (input.userId === ctx.userId && input.accessStatus !== "approved") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot remove your own organization access.",
        });
      }

      const [member] = await ctx.db
        .update(users)
        .set({
          organizationAccessStatus: input.accessStatus,
          permissionConfig: input.permissions,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(users.id, input.userId),
            eq(users.organizationId, ctx.user.organizationId),
          ),
        )
        .returning();

      if (!member) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization member not found",
        });
      }

      return member;
    }),

  createOrganizationInvite: hasDashboardAccess
    .input(
      z.object({
        name: z.string().min(1).max(255).trim(),
        permissions: invitePermissionConfigSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageOrganization(ctx.user);

      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const [invite] = await ctx.db
        .insert(organizationInvites)
        .values({
          organizationId: ctx.user.organizationId,
          token: createInviteToken(),
          name: input.name,
          role: "user",
          permissionConfig: input.permissions,
          createdByUserId: ctx.userId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        })
        .returning();

      if (!invite) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create organization invite",
        });
      }

      return invite;
    }),

  revokeOrganizationInvite: hasDashboardAccess
    .input(
      z.object({
        id: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageOrganization(ctx.user);

      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const [invite] = await ctx.db
        .update(organizationInvites)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(organizationInvites.id, input.id),
            eq(organizationInvites.organizationId, ctx.user.organizationId),
          ),
        )
        .returning();

      if (!invite) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization invite not found",
        });
      }

      return invite;
    }),

  updateOrganization: hasDashboardAccess
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
      assertCanManageOrganization(ctx.user);

      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      try {
        const [organization] = await ctx.db
          .update(organizations)
          .set({ name: input.name })
          .where(eq(organizations.id, ctx.user.organizationId))
          .returning();

        if (!organization) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Organization not found",
          });
        }

        return organization;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("organization_name_uniq")
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "An organization with this name already exists",
          });
        }

        throw error;
      }
    }),

  updatePricingProfile: hasDashboardAccess
    .input(
      z.object({
        id: z.string().uuid(),
        name: z
          .string()
          .min(1, "Pricing profile name is required")
          .max(255, "Pricing profile name must be less than 255 characters")
          .trim(),
        defaultMarkupPercent: z.coerce
          .number()
          .min(0, "Markup must be 0 or more")
          .max(999.999, "Markup must be less than 1000")
          .transform((value) => value.toFixed(3)),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageOrganization(ctx.user);

      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const [pricingProfile] = await ctx.db
        .update(pricingProfiles)
        .set({
          name: input.name,
          defaultMarkupPercent: input.defaultMarkupPercent,
        })
        .where(
          and(
            eq(pricingProfiles.id, input.id),
            eq(pricingProfiles.organizationId, ctx.user.organizationId),
          ),
        )
        .returning();

      if (!pricingProfile) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pricing profile not found",
        });
      }

      return pricingProfile;
    }),

  updateLocation: hasDashboardAccess
    .input(
      z.object({
        id: z.string().uuid(),
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
      assertCanManageOrganization(ctx.user);

      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const [location] = await ctx.db
        .update(locations)
        .set({
          name: input.name,
          address1: input.address1 || null,
          address2: input.address2 || null,
          city: input.city || null,
          region: input.region || null,
          postalCode: input.postalCode || null,
          country: input.country || null,
          notes: input.notes || null,
        })
        .where(
          and(
            eq(locations.id, input.id),
            eq(locations.organizationId, ctx.user.organizationId),
          ),
        )
        .returning();

      if (!location) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Location not found",
        });
      }

      return location;
    }),

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

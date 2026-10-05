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
  assertCan,
  getUserPermissions,
  hasManagingSeat,
  resolvePermissions,
  toStoredConfig,
} from "~/server/auth/permissions";
import {
  DEFAULT_INVITE_EXPIRY_DAYS,
  INVITE_EXPIRY_DAYS,
  isPermissionKey,
  type PermissionMap,
} from "~/lib/permission-catalog";
import {
  locations,
  organizationInvites,
  organizations,
  pricingProfiles,
  users,
} from "~/server/db/schema";
import { seedOrganization } from "~/server/utils/seed-organization";

/** A permission map from the client: only known keys with boolean values are kept. */
const permissionMapSchema = z
  .record(z.string(), z.boolean())
  .transform((raw) => {
    const out: Partial<PermissionMap> = {};
    for (const [key, value] of Object.entries(raw))
      if (isPermissionKey(key)) out[key] = value;
    return out;
  });
const memberAccessStatusSchema = z.enum(["approved", "pending", "denied"]);

function createInviteToken() {
  return crypto.randomBytes(24).toString("base64url");
}

export const organizationRouter = createTRPCRouter({
  getOrganizationSettings: hasDashboardAccess.query(async ({ ctx }) => {
    assertCan(ctx.user, "tab.organization");

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

    const [locationList, inviteList, memberList] = await Promise.all([
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

    const viewer = resolvePermissions(ctx.user);
    return {
      organization,
      viewer: {
        userId: ctx.userId,
        canManageMembers: viewer["org.members"],
        canInvite: viewer["org.invite"],
        canEditSettings: viewer["org.settings"],
      },
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
        permissions: permissionMapSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.user, "org.members");
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

      const organizationId = ctx.user.organizationId;
      return ctx.db.transaction(async (tx) => {
        const targetWhere = and(
          eq(users.id, input.userId),
          eq(users.organizationId, organizationId),
        );
        const [target] = await tx
          .select()
          .from(users)
          .where(targetWhere)
          .limit(1)
          .for("update");
        if (!target) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Organization member not found",
          });
        }

        const executive = hasManagingSeat(target);
        if (
          executive &&
          Object.values(input.permissions).some((value) => !value)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Executive Accounts and admins always retain every permission.",
          });
        }
        if (
          executive &&
          (target.organizationAccessStatus ?? "approved") === "approved" &&
          input.accessStatus !== "approved"
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "An active Executive Account or admin cannot have organization access disabled.",
          });
        }

        // Approval is still required for paid invitees. Keep entitlement-derived
        // grants out of storage so they do not survive subscription expiry.
        const permissionConfig: unknown = executive
          ? target.permissionConfig
          : toStoredConfig(input.permissions);
        const nextPermissions = resolvePermissions({
          ...target,
          permissionConfig,
        });
        if (
          input.userId === ctx.userId &&
          (!nextPermissions["org.members"] ||
            !nextPermissions["tab.organization"])
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "You cannot remove your own access to manage organization members.",
          });
        }
        const [member] = await tx
          .update(users)
          .set({
            organizationAccessStatus: input.accessStatus,
            permissionConfig,
            updatedAt: new Date(),
          })
          .where(targetWhere)
          .returning();
        return member;
      });
    }),

  createOrganizationInvite: hasDashboardAccess
    .input(
      z.object({
        name: z.string().min(1).max(255).trim(),
        permissions: permissionMapSchema,
        expiresInDays: z
          .number()
          .int()
          .refine((days) =>
            (INVITE_EXPIRY_DAYS as readonly number[]).includes(days),
          )
          .default(DEFAULT_INVITE_EXPIRY_DAYS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.user, "org.invite");

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
          permissionConfig: toStoredConfig(input.permissions),
          createdByUserId: ctx.userId,
          expiresAt: new Date(
            Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000,
          ),
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
      assertCan(ctx.user, "org.invite");

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
      assertCan(ctx.user, "org.settings");

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
      assertCan(ctx.user, "org.settings");

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

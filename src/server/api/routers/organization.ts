import type { RequestUser } from "~/server/utils/get-request-identity";
import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import {
  createTRPCRouter,
  hasDashboardAccess,
  protectedProcedure,
} from "~/server/api/trpc";
import {
  assertCan,
  expandDrawingPermissions,
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
  organizationPermissionPresets,
  pricingProfiles,
  users,
} from "~/server/db/schema";
import { seedOrganization } from "~/server/utils/seed-organization";

// Keep the legacy user schema’s circular inference at its column boundary.
const userPresetColumn = (users as { permissionPresetId: AnyPgColumn })
  .permissionPresetId;
const userIdColumn = (users as { id: AnyPgColumn }).id;
const userOrgColumn = (users as { organizationId: AnyPgColumn }).organizationId;

/** A permission map from the client: only known keys with boolean values are kept. */
const permissionMapSchema = z
  .record(z.string(), z.boolean())
  .transform((raw) => {
    const out: Partial<PermissionMap> = {};
    for (const [key, value] of Object.entries(expandDrawingPermissions(raw)))
      if (isPermissionKey(key) && typeof value === "boolean") out[key] = value;
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

    const [locationList, inviteList, memberList, presetList] =
      await Promise.all([
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
            permissionPresetId: userPresetColumn,
            organizationAccessStatus: users.organizationAccessStatus,
            stripeSubscriptionId: users.stripeSubscriptionId,
            subscriptionStatus: users.subscriptionStatus,
            subscriptionEndsAt: users.subscriptionEndsAt,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(eq(users.organizationId, ctx.user.organizationId))
          .orderBy(asc(users.name), asc(users.email)),
        ctx.db
          .select()
          .from(organizationPermissionPresets)
          .where(
            eq(
              organizationPermissionPresets.organizationId,
              ctx.user.organizationId,
            ),
          )
          .orderBy(asc(organizationPermissionPresets.name)),
      ]);

    const viewer = resolvePermissions(ctx.user);
    return {
      organization,
      viewer: {
        userId: ctx.userId,
        canManageMembers: viewer["org.members"],
        canSimulateEmployees: !ctx.simulation && hasManagingSeat(ctx.user),
        canSimulateAdmins:
          !ctx.simulation && getUserPermissions(ctx.user).isAdmin,
        canInvite: viewer["org.invite"],
        canEditSettings: viewer["org.settings"],
      },
      locations: locationList,
      invites: inviteList,
      permissionPresets: (
        presetList as {
          id: string;
          name: string;
          permissionConfig: unknown;
          revision: number;
        }[]
      ).map((preset) => ({
        id: preset.id,
        name: preset.name,
        revision: preset.revision,
        permissions: resolvePermissions({
          permissionConfig: preset.permissionConfig,
        }),
        memberCount: memberList.filter(
          (member) => member.permissionPresetId === preset.id,
        ).length,
      })),
      members: (
        memberList as Pick<
          RequestUser,
          | "id"
          | "name"
          | "email"
          | "role"
          | "permissionConfig"
          | "permissionPresetId"
          | "organizationAccessStatus"
          | "stripeSubscriptionId"
          | "subscriptionStatus"
          | "subscriptionEndsAt"
          | "createdAt"
        >[]
      ).map((member) => ({
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
        // Omission from an older client preserves its live assignment.
        permissionPresetId: z.string().uuid().nullable().optional(),
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
        // Serialize member assignments and preset edits for this organization.
        // Always lock the organization before preset/member rows.
        await tx.execute(
          sql`select id from ${organizations} where ${organizations.id} = ${organizationId} for update`,
        );
        const [preset] = input.permissionPresetId
          ? await tx
              .select()
              .from(organizationPermissionPresets)
              .where(
                and(
                  eq(
                    organizationPermissionPresets.id,
                    input.permissionPresetId,
                  ),
                  eq(
                    organizationPermissionPresets.organizationId,
                    organizationId,
                  ),
                ),
              )
              .limit(1)
          : [];
        if (input.permissionPresetId && !preset)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Permission preset not found in this organization.",
          });
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
        if (executive && input.permissionPresetId)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Executive Accounts and admins always retain every permission and cannot use a preset.",
          });
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
          : preset
            ? preset.permissionConfig
            : input.permissionPresetId === undefined &&
                target.permissionPresetId
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
            ...(input.permissionPresetId !== undefined
              ? { permissionPresetId: input.permissionPresetId }
              : {}),
            updatedAt: new Date(),
          })
          .where(targetWhere)
          .returning();
        return member;
      });
    }),

  savePermissionPreset: hasDashboardAccess
    .input(
      z
        .object({
          id: z.string().uuid().optional(),
          revision: z.number().int().positive().optional(),
          name: z.string().trim().min(1).max(100),
          permissions: permissionMapSchema,
        })
        .refine((input) => !input.id || !!input.revision, {
          message: "The preset revision is required when editing.",
        }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.user, "org.members");
      const organizationId = ctx.user.organizationId;
      // Store a complete map so the saved choices have explicit values.
      const permissionConfig = toStoredConfig(
        resolvePermissions({
          permissionConfig: toStoredConfig(input.permissions),
        }),
      );
      try {
        return await ctx.db.transaction(async (tx) => {
          await tx.execute(
            sql`select id from ${organizations} where ${organizations.id} = ${organizationId} for update`,
          );
          if (!input.id) {
            const [preset] = await tx
              .insert(organizationPermissionPresets)
              .values({ organizationId, name: input.name, permissionConfig })
              .returning();
            if (!preset)
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Could not save preset.",
              });
            return { id: preset.id, revision: preset.revision };
          }
          const where = and(
            eq(organizationPermissionPresets.id, input.id),
            eq(organizationPermissionPresets.organizationId, organizationId),
          );
          const [preset] = await tx
            .select()
            .from(organizationPermissionPresets)
            .where(where)
            .limit(1)
            .for("update");
          if (!preset)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Permission preset not found.",
            });
          if (preset.revision !== input.revision)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "This preset was changed by someone else. Reload it before saving.",
            });
          const [actor] = await tx
            .select()
            .from(users)
            .where(
              and(
                eq(userIdColumn, ctx.userId),
                eq(userOrgColumn, organizationId),
              ),
            )
            .limit(1);
          if (actor?.permissionPresetId === input.id) {
            const next = resolvePermissions({ ...actor, permissionConfig });
            if (!next["org.members"] || !next["tab.organization"])
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "You cannot remove your own access to manage organization members.",
              });
          }
          const [saved] = await tx
            .update(organizationPermissionPresets)
            .set({
              name: input.name,
              permissionConfig,
              revision: preset.revision + 1,
              updatedAt: new Date(),
            })
            .where(where)
            .returning();
          // The database trigger applies this map to every assigned member in
          // this same transaction, including accounts read outside tRPC.
          if (!saved)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Could not save preset.",
            });
          return { id: saved.id, revision: saved.revision };
        });
      } catch (error) {
        const cause =
          error instanceof Error && "cause" in error ? error.cause : error;
        if (
          cause &&
          typeof cause === "object" &&
          "code" in cause &&
          cause.code === "23505"
        )
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "A preset with this name already exists in your organization.",
          });
        throw error;
      }
    }),

  deletePermissionPreset: hasDashboardAccess
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.user, "org.members");
      const organizationId = ctx.user.organizationId;
      return ctx.db.transaction(async (tx) => {
        await tx.execute(
          sql`select id from ${organizations} where ${organizations.id} = ${organizationId} for update`,
        );
        const [assigned] = await tx
          .select({ id: userIdColumn })
          .from(users)
          .where(
            and(
              eq(userOrgColumn, organizationId),
              eq(userPresetColumn, input.id),
            ),
          )
          .limit(1);
        if (assigned)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Reassign members or switch them to individual permissions before deleting this preset.",
          });
        const removed = await tx
          .delete(organizationPermissionPresets)
          .where(
            and(
              eq(organizationPermissionPresets.id, input.id),
              eq(organizationPermissionPresets.organizationId, organizationId),
            ),
          )
          .returning({ id: organizationPermissionPresets.id });
        if (!removed.length)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Permission preset not found.",
          });
        return { deleted: true };
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

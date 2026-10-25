import { materialSortSettingsSchema } from "~/lib/material-sort-preferences";
import {
  readMaterialSortPreferences,
  saveMaterialSortPreferences,
} from "~/server/material-sort-preferences";
import {
  readSupplierEmailPreference,
  saveSupplierEmailPreference,
} from "~/server/supplier-email-preferences";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import {
  createTRPCRouter,
  protectedProcedure,
  hasAppAccess,
} from "~/server/api/trpc";
import { getUserPermissions, hasManagingSeat } from "~/server/auth/permissions";
import { users } from "~/server/db/schema";

const tutorialStateFields = {
  completedAt: users.tutorialCompletedAt,
  outcome: users.tutorialOutcome,
};

function assertTutorialAccount(
  expectedUserId: string,
  authenticatedUserId: string,
) {
  if (expectedUserId !== authenticatedUserId) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Your signed-in account changed. Reload before updating tutorial progress.",
    });
  }
}

export const userRouter = createTRPCRouter({
  getMaterialSortPreferences: hasAppAccess
    .input(
      z.object({
        expectedUserId: z.string().min(1),
        expectedOrganizationId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (
        input.expectedUserId !== ctx.userId ||
        input.expectedOrganizationId !== ctx.user.organizationId
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "Your account changed. Reload settings.",
        });
      if (!ctx.user.organizationId) throw new TRPCError({ code: "FORBIDDEN" });
      return {
        ...(await readMaterialSortPreferences(
          ctx.db,
          ctx.user.organizationId,
          ctx.userId,
        )),
        canEditExecutive: hasManagingSeat(ctx.user) && !ctx.simulation,
      };
    }),
  setMaterialSortPreferences: hasAppAccess
    .input(
      z.object({
        expectedUserId: z.string().min(1),
        expectedOrganizationId: z.string().uuid(),
        target: z.enum(["personal", "executive"]),
        settings: materialSortSettingsSchema,
        custom: z.boolean(),
        initializeOnly: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (
        input.expectedUserId !== ctx.userId ||
        input.expectedOrganizationId !== ctx.user.organizationId
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "Your account changed. Reload settings.",
        });
      if (!ctx.user.organizationId) throw new TRPCError({ code: "FORBIDDEN" });
      if (
        input.target === "executive" &&
        (!hasManagingSeat(ctx.user) || ctx.simulation)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only an executive can change shared sorting.",
        });
      await saveMaterialSortPreferences(
        ctx.db,
        ctx.user.organizationId,
        input.target === "executive" ? "executive" : ctx.userId,
        input.settings,
        input.custom,
        input.initializeOnly,
      );
      return {
        ...(await readMaterialSortPreferences(
          ctx.db,
          ctx.user.organizationId,
          ctx.userId,
        )),
        canEditExecutive: hasManagingSeat(ctx.user) && !ctx.simulation,
      };
    }),

  getSupplierEmailPreference: protectedProcedure
    .input(
      z.object({
        supplierId: z.string().uuid(),
        expectedUserId: z.string().min(1).max(255),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.expectedUserId !== ctx.userId)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Your account changed. Reload before reading email preferences.",
        });
      if (!ctx.user.organizationId) throw new TRPCError({ code: "FORBIDDEN" });
      return {
        includeSupplierSku: await readSupplierEmailPreference(
          ctx.db,
          ctx.userId,
          ctx.user.organizationId,
          input.supplierId,
        ),
      };
    }),
  setSupplierEmailPreference: protectedProcedure
    .input(
      z.object({
        supplierId: z.string().uuid(),
        includeSupplierSku: z.boolean(),
        expectedUserId: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.expectedUserId !== ctx.userId)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Your account changed. Reload before updating email preferences.",
        });
      if (!ctx.user.organizationId) throw new TRPCError({ code: "FORBIDDEN" });
      return saveSupplierEmailPreference(
        ctx.db,
        ctx.userId,
        ctx.user.organizationId,
        input.supplierId,
        input.includeSupplierSku,
      );
    }),
  getTutorialState: protectedProcedure.query(async ({ ctx }) => {
    const [state] = await ctx.db
      .select(tutorialStateFields)
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);
    if (!state)
      throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
    return { ...state, userId: ctx.userId };
  }),

  finishTutorial: protectedProcedure
    .input(
      z.object({
        expectedUserId: z.string().min(1).max(255),
        outcome: z.enum(["completed", "skipped"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertTutorialAccount(input.expectedUserId, ctx.userId);
      // Keep the first terminal state until an explicit restart, including when
      // another device or a retried request finishes concurrently.
      const [state] = await ctx.db
        .update(users)
        .set({
          tutorialCompletedAt: sql`coalesce(${users.tutorialCompletedAt}, now())`,
          tutorialOutcome: sql`case when ${users.tutorialCompletedAt} is null then ${input.outcome} else ${users.tutorialOutcome} end`,
        })
        .where(eq(users.id, ctx.userId))
        .returning(tutorialStateFields);
      if (!state)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });
      return state;
    }),

  restartTutorial: protectedProcedure
    .input(z.object({ expectedUserId: z.string().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      assertTutorialAccount(input.expectedUserId, ctx.userId);
      const [state] = await ctx.db
        .update(users)
        .set({ tutorialCompletedAt: null, tutorialOutcome: null })
        .where(eq(users.id, ctx.userId))
        .returning(tutorialStateFields);
      if (!state)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });
      return state;
    }),

  getMyRole: protectedProcedure.query(async ({ ctx }) => {
    const permissions = getUserPermissions(ctx.user);

    return {
      role: ctx.user.role,
      organizationId: ctx.user.organizationId,
      hasOneTimeAccess: ctx.user.hasOneTimeAccess,
      permissions,
    };
  }),

  getMe: protectedProcedure.query(async ({ ctx }) => {
    return {
      id: ctx.user.id,
      name: ctx.user.name,
      email: ctx.user.email,
      department: ctx.user.department ?? null,
    };
  }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updatedUser] = await ctx.db
        .update(users)
        .set({ name: input.name })
        .where(eq(users.id, ctx.userId))
        .returning({
          id: users.id,
          name: users.name,
          email: users.email,
        });

      return updatedUser;
    }),
});

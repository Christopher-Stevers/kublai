import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getUserPermissions } from "~/server/auth/permissions";
import { users } from "~/server/db/schema";

const tutorialStateFields = {
  completedAt: users.tutorialCompletedAt,
  outcome: users.tutorialOutcome,
};

function assertTutorialAccount(expectedUserId: string, authenticatedUserId: string) {
  if (expectedUserId !== authenticatedUserId) {
    throw new TRPCError({ code: "CONFLICT", message: "Your signed-in account changed. Reload before updating tutorial progress." });
  }
}

export const userRouter = createTRPCRouter({
  getTutorialState: protectedProcedure.query(async ({ ctx }) => {
    const [state] = await ctx.db
      .select(tutorialStateFields)
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);
    if (!state) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
    return { ...state, userId: ctx.userId };
  }),

  finishTutorial: protectedProcedure
    .input(z.object({ expectedUserId: z.string().min(1).max(255), outcome: z.enum(["completed", "skipped"]) }))
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
      if (!state) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
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
      if (!state) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
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

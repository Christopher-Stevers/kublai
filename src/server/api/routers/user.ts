import { z } from "zod";
import { eq } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getUserPermissions } from "~/server/auth/permissions";
import { users } from "~/server/db/schema";

export const userRouter = createTRPCRouter({
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

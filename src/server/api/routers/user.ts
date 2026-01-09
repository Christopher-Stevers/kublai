import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const userRouter = createTRPCRouter({
  getMyRole: protectedProcedure.query(async ({ ctx }) => {
    return {
      role: ctx.user.role,
    };
  }),
});


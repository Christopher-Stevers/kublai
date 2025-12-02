import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { creatives } from "~/server/db/schema";

export const creativeRouter = createTRPCRouter({
  getAll: publicProcedure.query(async ({ ctx }) => {
    const allCreatives = await ctx.db.select().from(creatives);
    return allCreatives;
  }),
});


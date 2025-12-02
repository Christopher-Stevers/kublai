import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import { creatives } from "~/server/db/schema";
import { deleteFile, getFilePath } from "~/server/utils/file-upload";

export const creativeRouter = createTRPCRouter({
  getAll: publicProcedure.query(async ({ ctx }) => {
    const allCreatives = await ctx.db.select().from(creatives);
    return allCreatives;
  }),

  getMyCreatives: protectedProcedure.query(async ({ ctx }) => {
    const userCreatives = await ctx.db
      .select()
      .from(creatives)
      .where(eq(creatives.userId, ctx.session.user.id));
    return userCreatives;
  }),

  deleteCreative: protectedProcedure
    .input(
      z.object({
        creativeId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Get the creative and verify ownership
      const [creative] = await ctx.db
        .select()
        .from(creatives)
        .where(eq(creatives.id, input.creativeId));

      if (!creative) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Creative not found",
        });
      }

      // Verify the user owns this creative
      if (creative.userId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only delete your own creatives",
        });
      }

      // Delete the file from filesystem
      // filePath is stored as relative path (e.g., "uploads/userId/filename")
      // Extract filename from path
      const pathParts = creative.filePath.split("/");
      const filename = pathParts[pathParts.length - 1];
      const fullPath = getFilePath(creative.userId, filename);
      deleteFile(fullPath);

      // Delete from database
      await ctx.db.delete(creatives).where(eq(creatives.id, input.creativeId));

      return { success: true };
    }),
});


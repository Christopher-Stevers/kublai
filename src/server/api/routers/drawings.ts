import { TRPCError } from "@trpc/server";
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import { assertSheetsNotReferenced } from "~/server/drawings/service";
import { assertCan, userCan } from "~/server/auth/permissions";
import type { db as database } from "~/server/db";
import { jobDrawingSets, jobDrawingSheets, jobs } from "~/server/db/schema";
import { ensureDrawingTiles, uploadsFromImageUrls } from "~/server/rooms/tiles";

/**
 * Drawings: folders ("sets") of plain drawing sheets for a job. Uploading a PDF
 * into a folder goes through the shared PDF upload route with `drawingSetId`;
 * there is no room detection here.
 */
const name = z.string().trim().min(1).max(255);

type Ctx = {
  db: typeof database;
  user: unknown;
};

function organizationOf(ctx: Ctx) {
  return (ctx.user as { organizationId: string }).organizationId;
}
function assertCanManage(ctx: Ctx) {
  assertCan(ctx.user as never, "drawings.view");
  if (!userCan(ctx.user as never, "drawings.upload"))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You don't have permission to manage drawings",
    });
}
async function requireJob(ctx: Ctx, jobId: string) {
  const [job] = await ctx.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, organizationOf(ctx))))
    .limit(1);
  if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
}
async function requireSet(ctx: Ctx, setId: string) {
  const [set] = await ctx.db
    .select()
    .from(jobDrawingSets)
    .where(
      and(
        eq(jobDrawingSets.id, setId),
        eq(jobDrawingSets.organizationId, organizationOf(ctx)),
        isNull(jobDrawingSets.documentVersionId),
      ),
    )
    .limit(1);
  if (!set)
    throw new TRPCError({ code: "NOT_FOUND", message: "Drawing folder not found" });
  return set;
}
async function requireSheet(ctx: Ctx, sheetId: string) {
  const [sheet] = await ctx.db
    .select()
    .from(jobDrawingSheets)
    .where(
      and(
        eq(jobDrawingSheets.id, sheetId),
        eq(jobDrawingSheets.organizationId, organizationOf(ctx)),
        isNull(jobDrawingSheets.documentVersionId),
      ),
    )
    .limit(1);
  if (!sheet)
    throw new TRPCError({ code: "NOT_FOUND", message: "Drawing not found" });
  return sheet;
}

export const drawingsRouter = createTRPCRouter({
  /** The job's drawing folders with their sheet counts and a cover sheet. */
  listSets: hasDashboardAccess
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertCan(ctx.user, "drawings.view");
      await requireJob(ctx, input.jobId);
      const sets = await ctx.db
        .select()
        .from(jobDrawingSets)
        .where(
          and(
            eq(jobDrawingSets.jobId, input.jobId),
            eq(jobDrawingSets.organizationId, organizationOf(ctx)),
        isNull(jobDrawingSets.documentVersionId),
          ),
        )
        .orderBy(asc(jobDrawingSets.name), asc(jobDrawingSets.createdAt));
      const ids = sets.map((set) => set.id);
      const counts = ids.length
        ? await ctx.db
            .select({ setId: jobDrawingSheets.setId, sheets: count() })
            .from(jobDrawingSheets)
            .where(inArray(jobDrawingSheets.setId, ids))
            .groupBy(jobDrawingSheets.setId)
        : [];
      const covers = ids.length
        ? await ctx.db
            .selectDistinctOn([jobDrawingSheets.setId], {
              setId: jobDrawingSheets.setId,
              imageUrl: jobDrawingSheets.imageUrl,
            })
            .from(jobDrawingSheets)
            .where(inArray(jobDrawingSheets.setId, ids))
            .orderBy(jobDrawingSheets.setId, asc(jobDrawingSheets.sortOrder))
        : [];
      return {
        canManage: userCan(ctx.user, "drawings.upload"),
        canUpload: userCan(ctx.user, "drawings.upload"),
        canDelete: userCan(ctx.user, "drawings.delete"),
        sets: sets.map((set) => ({
          id: set.id,
          name: set.name,
          updatedAt: set.updatedAt,
          sheetCount: Number(counts.find((row) => row.setId === set.id)?.sheets ?? 0),
          coverImageUrl:
            covers.find((row) => row.setId === set.id)?.imageUrl ?? null,
        })),
      };
    }),

  /** One folder and its sheets, in upload order. */
  getSet: hasDashboardAccess
    .input(z.object({ setId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertCan(ctx.user, "drawings.view");
      const set = await requireSet(ctx, input.setId);
      const sheets = await ctx.db
        .select({
          id: jobDrawingSheets.id,
          name: jobDrawingSheets.name,
          imageUrl: jobDrawingSheets.imageUrl,
          width: jobDrawingSheets.width,
          height: jobDrawingSheets.height,
          sourceFilename: jobDrawingSheets.sourceFilename,
        })
        .from(jobDrawingSheets)
        .where(eq(jobDrawingSheets.setId, set.id))
        .orderBy(asc(jobDrawingSheets.sortOrder), asc(jobDrawingSheets.createdAt));
      // Catch up on any sharp-zoom tiles that are missing (e.g. after a restart).
      for (const upload of uploadsFromImageUrls(sheets.map((sheet) => sheet.imageUrl)))
        void ensureDrawingTiles(upload.jobId, upload.uploadId, upload.pages).catch(
          (error: unknown) => console.error("[drawing-tiles] start failed", error),
        );
      return {
        canManage: userCan(ctx.user, "drawings.upload"),
        canUpload: userCan(ctx.user, "drawings.upload"),
        canDelete: userCan(ctx.user, "drawings.delete"),
        set: { id: set.id, jobId: set.jobId, name: set.name },
        sheets,
      };
    }),

  createSet: hasDashboardAccess
    .input(z.object({ jobId: z.string().uuid(), name }))
    .mutation(async ({ ctx, input }) => {
      assertCanManage(ctx);
      await requireJob(ctx, input.jobId);
      const [set] = await ctx.db
        .insert(jobDrawingSets)
        .values({
          organizationId: organizationOf(ctx),
          jobId: input.jobId,
          name: input.name,
          createdByUserId: (ctx.user as { id?: string }).id ?? null,
        })
        .returning({ id: jobDrawingSets.id });
      return { id: set!.id };
    }),

  renameSet: hasDashboardAccess
    .input(z.object({ setId: z.string().uuid(), name }))
    .mutation(async ({ ctx, input }) => {
      assertCanManage(ctx);
      const set = await requireSet(ctx, input.setId);
      await ctx.db
        .update(jobDrawingSets)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(jobDrawingSets.id, set.id));
      return { ok: true as const };
    }),

  /** Deletes the folder and its sheets. */
  deleteSet: hasDashboardAccess
    .input(z.object({ setId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.user, "drawings.view");
      assertCan(ctx.user, "drawings.delete");
      const set = await requireSet(ctx, input.setId);
      await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${set.jobId}, 4151))`);
        const sheets = await tx.select({ id: jobDrawingSheets.id }).from(jobDrawingSheets).where(eq(jobDrawingSheets.setId, set.id));
        await assertSheetsNotReferenced(tx, sheets.map((sheet) => sheet.id));
        await tx.delete(jobDrawingSets).where(eq(jobDrawingSets.id, set.id));
      });
      return { ok: true as const };
    }),

  renameSheet: hasDashboardAccess
    .input(z.object({ sheetId: z.string().uuid(), name }))
    .mutation(async ({ ctx, input }) => {
      assertCanManage(ctx);
      const sheet = await requireSheet(ctx, input.sheetId);
      await ctx.db
        .update(jobDrawingSheets)
        .set({ name: input.name })
        .where(eq(jobDrawingSheets.id, sheet.id));
      return { ok: true as const };
    }),

  deleteSheet: hasDashboardAccess
    .input(z.object({ sheetId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.user, "drawings.view");
      assertCan(ctx.user, "drawings.delete");
      const sheet = await requireSheet(ctx, input.sheetId);
      await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${sheet.jobId}, 4151))`);
        await assertSheetsNotReferenced(tx, [sheet.id]);
        await tx.delete(jobDrawingSheets).where(eq(jobDrawingSheets.id, sheet.id));
      });
      return { ok: true as const };
    }),
});

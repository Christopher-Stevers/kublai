import { drawingLinkTargets } from "~/server/drawings/link-targets";
import { drawingLinkTargetKinds } from "~/lib/drawing-links";
import { z } from "zod";
import {
  drawingMetadataSchema,
  drawingSaveSchema,
} from "~/lib/drawing-workspace";
import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import {
  archiveDrawingEntity,
  commentDrawingEntity,
  favoriteDrawing,
  getDrawingWorkspace,
  listDrawingWorkspace,
  saveDrawingEntity,
  saveDrawingMetadata,
  setDrawingCurrentVersion,
  watchDrawing,
} from "~/server/drawings/service";
import {
  drawingNotificationInbox,
  readDrawingNotification,
} from "~/server/drawings/notifications";
const sheetId = z.string().uuid();
const revision = z.number().int().min(0);
const item = z.object({
  sheetId,
  id: z.string().uuid(),
  expectedRevision: revision,
});
export const drawingsWorkspaceRouter = createTRPCRouter({
  linkTargets: hasDashboardAccess
    .input(
      z.object({
        sheetId,
        kind: z.enum(drawingLinkTargetKinds),
        jobId: z.string().uuid().optional(),
        query: z.string().trim().max(100).default(""),
      }),
    )
    .query(({ ctx, input }) => drawingLinkTargets(ctx, input)),
  watch: hasDashboardAccess
    .input(z.object({ sheetId, watching: z.boolean() }))
    .mutation(({ ctx, input }) => watchDrawing(ctx, input)),
  notifications: hasDashboardAccess
    .input(z.object({ jobId: z.string().uuid().optional() }))
    .query(({ ctx, input }) => drawingNotificationInbox(ctx, input.jobId)),
  readNotification: hasDashboardAccess
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => readDrawingNotification(ctx, input.id)),
  get: hasDashboardAccess
    .input(z.object({ sheetId }))
    .query(({ ctx, input }) => getDrawingWorkspace(ctx, input.sheetId)),
  list: hasDashboardAccess
    .input(z.object({ jobId: z.string().uuid() }))
    .query(({ ctx, input }) => listDrawingWorkspace(ctx, input.jobId)),
  save: hasDashboardAccess
    .input(drawingSaveSchema)
    .mutation(({ ctx, input }) => saveDrawingEntity(ctx, input)),
  archive: hasDashboardAccess
    .input(item)
    .mutation(({ ctx, input }) => archiveDrawingEntity(ctx, input)),
  comment: hasDashboardAccess
    .input(item.extend({ body: z.string().trim().min(1).max(12000) }))
    .mutation(({ ctx, input }) => commentDrawingEntity(ctx, input)),
  metadata: hasDashboardAccess
    .input(
      z.object({
        sheetId,
        expectedRevision: revision,
        data: drawingMetadataSchema,
      }),
    )
    .mutation(({ ctx, input }) => saveDrawingMetadata(ctx, input)),
  setCurrentVersion: hasDashboardAccess
    .input(
      z.object({ sheetId, sourceSheetId: sheetId, expectedRevision: revision }),
    )
    .mutation(({ ctx, input }) => setDrawingCurrentVersion(ctx, input)),
  favorite: hasDashboardAccess
    .input(z.object({ sheetId, favorite: z.boolean() }))
    .mutation(({ ctx, input }) => favoriteDrawing(ctx, input)),
});

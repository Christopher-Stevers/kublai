import { equipmentSources, equipmentMatches } from "~/server/drawings/equipment-links";
import { openDocumentDrawingWorkspace } from "~/server/documents/drawing-workspace";
import { drawingLinkTargets } from "~/server/drawings/link-targets";
import { drawingLinkTargetKinds } from "~/lib/drawing-links";
import { z } from "zod";
import {
  drawingMetadataSchema,
  drawingSaveSchema,
} from "~/lib/drawing-workspace";
import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import {
  reviewDrawingRevisionUpload,
  applyDrawingRevisionUpload,
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
  equipmentSources: hasDashboardAccess.input(z.object({ sheetId })).query(({ctx,input})=>equipmentSources(ctx,input.sheetId)),
  equipmentMatches: hasDashboardAccess.input(z.object({sheetId,tag:z.string().trim().min(2).max(40),source:z.object({kind:z.enum(["drawing","document"]),id:sheetId,name:z.string().max(255)})})).query(({ctx,input})=>equipmentMatches(ctx,input)),
  reviewRevisionUpload: hasDashboardAccess
    .input(z.object({ uploadedSetId: sheetId }))
    .query(({ ctx, input }) =>
      reviewDrawingRevisionUpload(ctx, input.uploadedSetId),
    ),
  applyRevisionUpload: hasDashboardAccess
    .input(
      z.object({
        uploadedSetId: sheetId,
        label: z.string().trim().min(1).max(255),
        rows: z
          .array(
            z.object({
              sourceId: sheetId,
              sourceRevision: revision,
              targetId: sheetId.nullable(),
              expectedRevision: revision.optional(),
            }),
          )
          .min(1)
          .max(100),
      }),
    )
    .mutation(({ ctx, input }) => applyDrawingRevisionUpload(ctx, input)),
  openDocument: hasDashboardAccess
    .input(z.object({ jobId: z.string().uuid(), versionId: z.string().uuid() }))
    .mutation(({ ctx, input }) => openDocumentDrawingWorkspace(ctx, input)),
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

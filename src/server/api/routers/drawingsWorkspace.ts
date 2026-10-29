import { compactDrawingWorkspace } from "~/lib/drawing-workspace-payload";
import { assertCan } from "~/server/auth/permissions";
import { superLabelSettings, saveSuperLabelBoxes, applySuperLabel } from "~/server/drawings/service";
import { superLabelSchema } from "~/lib/super-label";
import { pipeLegendReferences } from "~/server/drawings/legend-components";
import { listLegendItems, scanLegend, saveLegendItems, updateLegendItem } from "~/server/drawings/legend";
import { legendItemSchema } from "~/lib/drawing-legend";
import { startSuperScale, superScaleLatest, cancelSuperScale } from "~/server/super-scale/service";
import { equipmentSources, equipmentMatches, equipmentMatchesBatch } from "~/server/drawings/equipment-links";
import { equipmentTagDestinations } from "~/server/drawings/equipment-register";
import { autoHyperlinkPreview } from "~/server/drawings/auto-hyperlink";
import { hyperlinkDetectInput } from "~/lib/hyperlink-readers";
import { detectHyperlinkTags, hyperlinkReaderOptions } from "~/server/drawings/hyperlink-readers";
import { superEquipmentSources, superEquipmentReport, recognizeEquipmentSource } from "~/server/drawings/super-equipment";
import { openDocumentDrawingWorkspace } from "~/server/documents/drawing-workspace";
import { drawingLinkTargets } from "~/server/drawings/link-targets";
import { drawingLinkTargetKinds } from "~/lib/drawing-links";
import { z } from "zod";
import {
  drawingMetadataSchema,
  drawingSaveSchema,
} from "~/lib/drawing-workspace";
import { createTRPCRouter, hasAppAccess } from "~/server/api/trpc";
import {
  addDrawingMeasurementLayer,
  reviewDrawingRevisionUpload,
  applyDrawingRevisionUpload,
  archiveDrawingEntity,
  commentDrawingEntity,
  favoriteDrawing,
  getDrawingWorkspace,
  getDrawingLink,
  getDrawingWorkspaceChanges,
  listDrawingWorkspace,
  saveDrawingEntity,
  saveDrawingMetadata,
  setDrawingScale,
  setDrawingCurrentVersion,
  watchDrawing,
} from "~/server/drawings/service";
import {
  drawingNotificationInbox,
  readDrawingNotification,
} from "~/server/drawings/notifications";
const sheetTools = hasAppAccess.use(({ ctx, next }) => {
  assertCan(ctx.user, "drawings.view");
  assertCan(ctx.user, "drawings.sheetTools");
  return next();
});
const sheetId = z.string().uuid();
const equipmentSource = z.object({kind:z.enum(["drawing","document"]),id:sheetId,name:z.string().max(255)});
const revision = z.number().int().min(0);
const item = z.object({
  sheetId,
  id: z.string().uuid(),
  expectedRevision: revision,
});
export const drawingsWorkspaceRouter = createTRPCRouter({
  autoHyperlinkReaders: sheetTools.input(z.object({ sheetId })).query(({ctx,input})=>hyperlinkReaderOptions(ctx,input.sheetId)),
  autoHyperlinkDetect: sheetTools.input(hyperlinkDetectInput).mutation(({ctx,input})=>detectHyperlinkTags(ctx,input)),
  autoHyperlinkSources: sheetTools.input(z.object({ sheetId })).query(({ctx,input})=>equipmentSources(ctx,input.sheetId)),
  autoHyperlinkPreview: sheetTools.input(z.object({sheetId,tags:z.array(z.string().trim().min(2).max(40)).min(1).max(200),scope:z.enum(["job","set"]).default("job")})).query(({ctx,input})=>autoHyperlinkPreview(ctx,input)),
  superEquipmentSources: sheetTools.input(z.object({sheetId})).query(({ctx,input})=>superEquipmentSources(ctx,input.sheetId)),
  superEquipmentReport: sheetTools.input(z.object({sheetId,documentIds:z.array(sheetId).max(2000).optional()})).query(({ctx,input})=>superEquipmentReport(ctx,input)),
  recognizeEquipmentSource: sheetTools.input(z.object({sheetId,kind:z.enum(["drawing","document"]),id:sheetId,page:z.number().int().min(1).max(2000)})).mutation(({ctx,input})=>recognizeEquipmentSource(ctx,input)),
  autoHyperlinkSave: sheetTools.input(drawingSaveSchema).mutation(({ctx,input})=>saveDrawingEntity(ctx,input)),
  superLabelSettings: sheetTools.input(z.object({sheetId})).query(({ctx,input})=>superLabelSettings(ctx,input.sheetId)),
  saveSuperLabelBoxes: sheetTools.input(z.object({sheetId,boxes:superLabelSchema})).mutation(({ctx,input})=>saveSuperLabelBoxes(ctx,input)),
  applySuperLabel: sheetTools.input(z.object({sheetId,targetId:sheetId,boxes:superLabelSchema})).mutation(({ctx,input})=>applySuperLabel(ctx,input)),
  pipeLegendReferences: hasAppAccess.input(z.object({sheetId})).query(({ctx,input})=>pipeLegendReferences(ctx,input.sheetId)),
  legendItems: sheetTools.input(z.object({sheetId})).query(({ctx,input})=>listLegendItems(ctx,input.sheetId)),
  scanLegend: sheetTools.input(z.object({sheetId,sourceSheetId:sheetId,recognizeText:z.boolean().optional()})).mutation(({ctx,input})=>scanLegend(ctx,input)),
  saveLegendItems: sheetTools.input(z.object({sheetId,sourceSheetId:sheetId,items:z.array(legendItemSchema).min(1).max(300)})).mutation(({ctx,input})=>saveLegendItems(ctx,input)),
  updateLegendItem: sheetTools.input(z.object({sheetId,id:sheetId,revision:z.number().int().min(1),data:legendItemSchema.nullable()})).mutation(({ctx,input})=>updateLegendItem(ctx,input)),
  addMeasurementLayer: hasAppAccess.input(z.object({sheetId, name:z.string().trim().min(1).max(80)})).mutation(({ctx,input})=>addDrawingMeasurementLayer(ctx,input)),
  setScale: hasAppAccess.input(z.object({sheetId, scale: drawingMetadataSchema.shape.scale})).mutation(({ctx,input}) => setDrawingScale(ctx,input)),
  superScaleLatest: sheetTools.input(z.object({sheetId})).query(({ctx,input})=>superScaleLatest(ctx,input.sheetId)),
  superScaleStart: sheetTools.input(z.object({id:sheetId,sheetId,first:z.string().max(40).default(""),second:z.string().max(40).default("")})).mutation(({ctx,input})=>startSuperScale(ctx,input)),
  superScaleCancel: sheetTools.input(z.object({id:sheetId,sheetId})).mutation(({ctx,input})=>cancelSuperScale(ctx,input)),
  equipmentMatchesBatch: hasAppAccess.input(z.object({ sheetId, tag: z.string().trim().min(2).max(40), sources: z.array(equipmentSource).min(1).max(32), groupBySheet: z.boolean().optional() })).query(({ ctx, input }) => equipmentMatchesBatch(ctx, input)),
  equipmentSources: hasAppAccess.input(z.object({ sheetId })).query(({ctx,input})=>equipmentSources(ctx,input.sheetId)),
  equipmentTag: hasAppAccess.input(z.object({ sheetId, tag: z.string().trim().min(2).max(40), exclude: z.object({ left: z.number().finite(), top: z.number().finite(), right: z.number().finite(), bottom: z.number().finite() }).optional() })).query(({ctx,input})=>equipmentTagDestinations(ctx,input)),
  equipmentMatches: hasAppAccess.input(z.object({sheetId,tag:z.string().trim().min(2).max(40),source:z.object({kind:z.enum(["drawing","document"]),id:sheetId,name:z.string().max(255)})})).query(({ctx,input})=>equipmentMatches(ctx,input)),
  reviewRevisionUpload: hasAppAccess
    .input(z.object({ uploadedSetId: sheetId }))
    .query(({ ctx, input }) =>
      reviewDrawingRevisionUpload(ctx, input.uploadedSetId),
    ),
  applyRevisionUpload: hasAppAccess
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
  openDocument: hasAppAccess
    .input(z.object({ jobId: z.string().uuid(), versionId: z.string().uuid() }))
    .mutation(({ ctx, input }) => openDocumentDrawingWorkspace(ctx, input)),
  linkTargets: hasAppAccess
    .input(
      z.object({
        sheetId,
        kind: z.enum(drawingLinkTargetKinds),
        jobId: z.string().uuid().optional(),
        query: z.string().trim().max(100).default(""),
      }),
    )
    .query(({ ctx, input }) => drawingLinkTargets(ctx, input)),
  watch: hasAppAccess
    .input(z.object({ sheetId, watching: z.boolean() }))
    .mutation(({ ctx, input }) => watchDrawing(ctx, input)),
  notifications: hasAppAccess
    .input(z.object({ jobId: z.string().uuid().optional() }))
    .query(({ ctx, input }) => drawingNotificationInbox(ctx, input.jobId)),
  readNotification: hasAppAccess
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => readDrawingNotification(ctx, input.id)),
  link: hasAppAccess
    .input(z.object({ sheetId, id: sheetId, revision: z.number().int().min(1) }))
    .query(({ ctx, input }) => getDrawingLink(ctx, input)),
  get: hasAppAccess
    .input(z.object({ sheetId, deferLinks: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      const workspace = await getDrawingWorkspace(ctx, input.sheetId);
      return input.deferLinks ? compactDrawingWorkspace(workspace) : workspace;
    }),
  changes: hasAppAccess
    .input(z.object({ sheetId, revision: z.string().max(64).optional(), deferLinks: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      const result = await getDrawingWorkspaceChanges(ctx, input);
      return input.deferLinks && result.workspace ? { ...result, workspace: compactDrawingWorkspace(result.workspace) } : result;
    }),
  list: hasAppAccess
    .input(z.object({ jobId: z.string().uuid() }))
    .query(({ ctx, input }) => listDrawingWorkspace(ctx, input.jobId)),
  save: hasAppAccess
    .input(drawingSaveSchema)
    .mutation(({ ctx, input }) => saveDrawingEntity(ctx, input)),
  archive: hasAppAccess
    .input(item)
    .mutation(({ ctx, input }) => archiveDrawingEntity(ctx, input)),
  comment: hasAppAccess
    .input(item.extend({ body: z.string().trim().min(1).max(12000) }))
    .mutation(({ ctx, input }) => commentDrawingEntity(ctx, input)),
  metadata: hasAppAccess
    .input(
      z.object({
        sheetId,
        expectedRevision: revision,
        data: drawingMetadataSchema,
      }),
    )
    .mutation(({ ctx, input }) => saveDrawingMetadata(ctx, input)),
  setCurrentVersion: hasAppAccess
    .input(
      z.object({ sheetId, sourceSheetId: sheetId, expectedRevision: revision }),
    )
    .mutation(({ ctx, input }) => setDrawingCurrentVersion(ctx, input)),
  favorite: hasAppAccess
    .input(z.object({ sheetId, favorite: z.boolean() }))
    .mutation(({ ctx, input }) => favoriteDrawing(ctx, input)),
});

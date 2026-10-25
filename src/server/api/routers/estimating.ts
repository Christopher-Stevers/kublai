import { z } from "zod";
import { createTRPCRouter, hasAppAccess } from "~/server/api/trpc";
import {
  assemblySchema,
  estimateDocumentSchema,
  estimateStatusSchema,
  pricingRowSchema,
} from "~/lib/estimating/types";
import {
  analyzeEstimateDrawings,
  applyEstimatePricing,
  createEstimate,
  duplicateEstimate,
  estimateCatalogue,
  estimateHistory,
  estimateResources,
  getEstimate,
  getEstimatingPricing,
  handoffEstimateMaterialList,
  importEstimateMaterialList,
  importEstimatePrefab,
  listEstimateJobs,
  listEstimates,
  restoreEstimate,
  saveEstimate,
  saveEstimatingPricing,
  setEstimateStatus,
} from "~/server/estimating/service";
const id = z.string().uuid();
const name = z.string().trim().min(1).max(255);
const revision = z.number().int().min(1).max(2_147_483_646);
const mutation = z.object({ id, expectedRevision: revision });

export const estimatingRouter = createTRPCRouter({
  jobs: hasAppAccess.query(({ ctx }) => listEstimateJobs(ctx)),
  list: hasAppAccess
    .input(
      z
        .object({
          jobId: id.optional(),
          status: estimateStatusSchema.optional(),
          search: z.string().max(300).optional(),
          limit: z.number().int().min(1).max(100).optional(),
          cursor: z.object({ updatedAt: z.string().datetime(), id }).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => listEstimates(ctx, input)),
  get: hasAppAccess
    .input(z.object({ id }))
    .query(({ ctx, input }) => getEstimate(ctx, input.id)),
  create: hasAppAccess
    .input(
      z.object({
        jobId: id,
        name,
        document: estimateDocumentSchema.optional(),
      }),
    )
    .mutation(({ ctx, input }) => createEstimate(ctx, input)),
  save: hasAppAccess
    .input(
      mutation.extend({
        name: name.optional(),
        document: estimateDocumentSchema,
      }),
    )
    .mutation(({ ctx, input }) => saveEstimate(ctx, input)),
  setStatus: hasAppAccess
    .input(mutation.extend({ status: estimateStatusSchema }))
    .mutation(({ ctx, input }) => setEstimateStatus(ctx, input)),
  duplicate: hasAppAccess
    .input(z.object({ id, name: name.optional() }))
    .mutation(({ ctx, input }) => duplicateEstimate(ctx, input)),
  history: hasAppAccess
    .input(
      z.object({
        id,
        limit: z.number().int().min(1).max(100).optional(),
        beforeRevision: revision.optional(),
      }),
    )
    .query(({ ctx, input }) => estimateHistory(ctx, input)),
  restore: hasAppAccess
    .input(mutation.extend({ eventId: id }))
    .mutation(({ ctx, input }) => restoreEstimate(ctx, input)),
  resources: hasAppAccess
    .input(z.object({ jobId: id }))
    .query(({ ctx, input }) => estimateResources(ctx, input.jobId)),
  catalogue: hasAppAccess
    .input(
      z.object({
        search: z.string().max(300),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(({ ctx, input }) => estimateCatalogue(ctx, input)),
  pricing: hasAppAccess.query(({ ctx }) => getEstimatingPricing(ctx)),
  savePricing: hasAppAccess
    .input(
      z.object({
        expectedRevision: z.number().int().min(0).max(2_147_483_646),
        rows: z.array(pricingRowSchema).max(10000).optional(),
        assemblies: z.array(assemblySchema).max(500).optional(),
      }),
    )
    .mutation(({ ctx, input }) => saveEstimatingPricing(ctx, input)),
  applyPricing: hasAppAccess
    .input(mutation)
    .mutation(({ ctx, input }) => applyEstimatePricing(ctx, input)),
  importMaterialList: hasAppAccess
    .input(mutation.extend({ materialListId: id }))
    .mutation(({ ctx, input }) => importEstimateMaterialList(ctx, input)),
  importPrefab: hasAppAccess
    .input(
      mutation.extend({
        prefabId: id,
        quantity: z.number().finite().positive().max(1000000),
      }),
    )
    .mutation(({ ctx, input }) => importEstimatePrefab(ctx, input)),
  analyzeDrawings: hasAppAccess
    .input(
      mutation.extend({
        sheetIds: z.array(id).min(1).max(5),
        includeRooms: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => analyzeEstimateDrawings(ctx, input)),
  handoffMaterialList: hasAppAccess
    .input(mutation)
    .mutation(({ ctx, input }) => handoffEstimateMaterialList(ctx, input)),
});

import { z } from "zod";
import { createTRPCRouter, hasDevAppAccess } from "~/server/api/trpc";
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
  jobs: hasDevAppAccess.query(({ ctx }) => listEstimateJobs(ctx)),
  list: hasDevAppAccess
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
  get: hasDevAppAccess
    .input(z.object({ id }))
    .query(({ ctx, input }) => getEstimate(ctx, input.id)),
  create: hasDevAppAccess
    .input(
      z.object({
        jobId: id,
        name,
        document: estimateDocumentSchema.optional(),
      }),
    )
    .mutation(({ ctx, input }) => createEstimate(ctx, input)),
  save: hasDevAppAccess
    .input(
      mutation.extend({
        name: name.optional(),
        document: estimateDocumentSchema,
      }),
    )
    .mutation(({ ctx, input }) => saveEstimate(ctx, input)),
  setStatus: hasDevAppAccess
    .input(mutation.extend({ status: estimateStatusSchema }))
    .mutation(({ ctx, input }) => setEstimateStatus(ctx, input)),
  duplicate: hasDevAppAccess
    .input(z.object({ id, name: name.optional() }))
    .mutation(({ ctx, input }) => duplicateEstimate(ctx, input)),
  history: hasDevAppAccess
    .input(
      z.object({
        id,
        limit: z.number().int().min(1).max(100).optional(),
        beforeRevision: revision.optional(),
      }),
    )
    .query(({ ctx, input }) => estimateHistory(ctx, input)),
  restore: hasDevAppAccess
    .input(mutation.extend({ eventId: id }))
    .mutation(({ ctx, input }) => restoreEstimate(ctx, input)),
  resources: hasDevAppAccess
    .input(z.object({ jobId: id }))
    .query(({ ctx, input }) => estimateResources(ctx, input.jobId)),
  catalogue: hasDevAppAccess
    .input(
      z.object({
        search: z.string().max(300),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(({ ctx, input }) => estimateCatalogue(ctx, input)),
  pricing: hasDevAppAccess.query(({ ctx }) => getEstimatingPricing(ctx)),
  savePricing: hasDevAppAccess
    .input(
      z.object({
        expectedRevision: z.number().int().min(0).max(2_147_483_646),
        rows: z.array(pricingRowSchema).max(10000).optional(),
        assemblies: z.array(assemblySchema).max(500).optional(),
      }),
    )
    .mutation(({ ctx, input }) => saveEstimatingPricing(ctx, input)),
  applyPricing: hasDevAppAccess
    .input(mutation)
    .mutation(({ ctx, input }) => applyEstimatePricing(ctx, input)),
  importMaterialList: hasDevAppAccess
    .input(mutation.extend({ materialListId: id }))
    .mutation(({ ctx, input }) => importEstimateMaterialList(ctx, input)),
  importPrefab: hasDevAppAccess
    .input(
      mutation.extend({
        prefabId: id,
        quantity: z.number().finite().positive().max(1000000),
      }),
    )
    .mutation(({ ctx, input }) => importEstimatePrefab(ctx, input)),
  analyzeDrawings: hasDevAppAccess
    .input(
      mutation.extend({
        sheetIds: z.array(id).min(1).max(5),
        includeRooms: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => analyzeEstimateDrawings(ctx, input)),
  handoffMaterialList: hasDevAppAccess
    .input(mutation)
    .mutation(({ ctx, input }) => handoffEstimateMaterialList(ctx, input)),
});

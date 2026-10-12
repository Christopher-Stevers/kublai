import { readDesign, saveDesign } from "~/server/models/design";
import { designSchema } from "~/lib/bim/design";
import {
  apsCredentialsSchema,
  storeApsCredentials,
  canConfigureAutodesk,
} from "~/server/models/connection";
import {
  verifyApsCredentials,
  clearApsToken,
} from "~/server/models/translation";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import { modelAccess } from "~/server/models/access";
import {
  modelWorkspace,
  saveModelView,
  removeModelView,
  saveModelIssue,
  commentModelIssue,
  setModelPublication,
  removeModel,
} from "~/server/models/service";
import {
  convertRevitModel,
  refreshRevitModel,
} from "~/server/models/conversion";
import { viewStateSchema, issueSchema } from "~/lib/bim/types";
const job = z.object({ jobId: z.string().uuid() });
const entity = job.extend({ id: z.string().uuid() });
export const modelsRouter = createTRPCRouter({
  design: hasDashboardAccess
    .input(entity)
    .query(async ({ ctx, input }) =>
      readDesign(await modelAccess(ctx.user.id, input.jobId), input.id),
    ),
  saveDesign: hasDashboardAccess
    .input(
      entity.extend({
        expectedRevision: z.number().int().min(0),
        design: designSchema,
      }),
    )
    .mutation(async ({ ctx, input }) =>
      saveDesign(
        await modelAccess(ctx.user.id, input.jobId),
        input.id,
        input.expectedRevision,
        input.design,
      ),
    ),

  connectAutodesk: hasDashboardAccess
    .input(job.extend({ credentials: apsCredentialsSchema }))
    .mutation(async ({ ctx, input }) => {
      const access = await modelAccess(ctx.user.id, input.jobId);
      if (!canConfigureAutodesk(access))
        throw new TRPCError({ code: "FORBIDDEN" });
      try {
        await verifyApsCredentials(input.credentials);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Autodesk connection failed.",
        });
      }
      const result = await storeApsCredentials(access, input.credentials);
      clearApsToken(access.job.organizationId);
      return result;
    }),
  workspace: hasDashboardAccess
    .input(job)
    .query(async ({ ctx, input }) =>
      modelWorkspace(await modelAccess(ctx.user.id, input.jobId)),
    ),
  remove: hasDashboardAccess
    .input(entity)
    .mutation(async ({ ctx, input }) =>
      removeModel(await modelAccess(ctx.user.id, input.jobId), input.id),
    ),
  saveView: hasDashboardAccess
    .input(
      job.extend({
        name: z.string().trim().min(1).max(200),
        view: viewStateSchema,
      }),
    )
    .mutation(async ({ ctx, input }) =>
      saveModelView(
        await modelAccess(ctx.user.id, input.jobId),
        input.name,
        input.view,
      ),
    ),
  removeView: hasDashboardAccess
    .input(entity)
    .mutation(async ({ ctx, input }) =>
      removeModelView(await modelAccess(ctx.user.id, input.jobId), input.id),
    ),
  saveIssue: hasDashboardAccess
    .input(
      entity.extend({
        expectedRevision: z.number().int().min(0),
        data: issueSchema,
      }),
    )
    .mutation(async ({ ctx, input }) =>
      saveModelIssue(
        await modelAccess(ctx.user.id, input.jobId),
        input.id,
        input.expectedRevision,
        input.data,
      ),
    ),
  comment: hasDashboardAccess
    .input(entity.extend({ text: z.string().trim().min(1).max(5000) }))
    .mutation(async ({ ctx, input }) =>
      commentModelIssue(
        await modelAccess(ctx.user.id, input.jobId),
        input.id,
        input.text,
      ),
    ),
  publication: hasDashboardAccess
    .input(
      entity.extend({
        publication: z.enum(["coordination", "construction", "archived"]),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      setModelPublication(
        await modelAccess(ctx.user.id, input.jobId),
        input.id,
        input.publication,
      ),
    ),
  convert: hasDashboardAccess
    .input(entity)
    .mutation(async ({ ctx, input }) =>
      convertRevitModel(await modelAccess(ctx.user.id, input.jobId), input.id),
    ),
  conversionStatus: hasDashboardAccess
    .input(entity)
    .mutation(async ({ ctx, input }) =>
      refreshRevitModel(await modelAccess(ctx.user.id, input.jobId), input.id),
    ),
});

import { TRPCError } from "@trpc/server";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { pipeSpecSchema, pipeSystemCode, type PipeSpec } from "~/lib/pipe-spec";
import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import { userCan } from "~/server/auth/permissions";
import type { db } from "~/server/db";
import { pipeSystemSpecs } from "~/server/db/schema";
import { pricingJobs as jobs } from "~/server/job-pricing-schema";
import {
  ensureSpecifications,
  getAssessment,
  getSpecificationContext,
  retainManualEdits,
  startAssessment,
  validateSpecEvidence,
  validateSpecReferences,
} from "~/server/job-systems/service";
import { redactSystemRequirements } from "~/server/job-systems/sources";

/**
 * Pipe system standards: the company's pipe, fitting and valve choice per
 * system, with per-job overrides. Taking a drawn system off into a material
 * list reads these on the device; the list itself is written offline-first.
 */
type Ctx = { db: typeof db; user: unknown };
const organizationOf = (ctx: Ctx) =>
  (ctx.user as { organizationId: string }).organizationId;
const userIdOf = (ctx: Ctx) => (ctx.user as { id: string }).id;

async function requireJob(ctx: Ctx, jobId: string) {
  const [job] = await ctx.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(eq(jobs.id, jobId), eq(jobs.organizationId, organizationOf(ctx))),
    )
    .limit(1);
  if (!job)
    throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
}
function assertCanEdit(ctx: Ctx, jobId: string | null) {
  // Company standards belong to whoever manages the catalogue; a job override
  // is part of building that job's lists.
  const allowed = jobId
    ? userCan(ctx.user as never, "lists.edit")
    : userCan(ctx.user as never, "parts.edit");
  if (!allowed)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: jobId
        ? "You don't have permission to edit this job's lists"
        : "You don't have permission to edit company pipe standards",
    });
}

export type PipeSpecRow = {
  system: string;
  spec: PipeSpec;
  revision: number;
  updatedAt: Date;
};

export const pipeSpecsRouter = createTRPCRouter({
  assessment: hasDashboardAccess
    .input(z.object({ jobId: z.string().uuid() }))
    .query(({ ctx, input }) => getAssessment(userIdOf(ctx), input.jobId)),
  assess: hasDashboardAccess
    .input(z.object({ jobId: z.string().uuid() }))
    .mutation(({ ctx, input }) => startAssessment(userIdOf(ctx), input.jobId)),
  ensureSpecifications: hasDashboardAccess
    .input(z.object({ jobId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      ensureSpecifications(userIdOf(ctx), input.jobId),
    ),
  /** Company standards, and this job's overrides when a job is given. */
  list: hasDashboardAccess
    .input(z.object({ jobId: z.string().uuid().nullish() }).optional())
    .query(async ({ ctx, input }) => {
      const jobId = input?.jobId ?? null;
      if (jobId) await requireJob(ctx, jobId);
      const sourceContext = jobId
        ? await getSpecificationContext(userIdOf(ctx), jobId, ctx.db)
        : null;
      const rows = await ctx.db
        .select()
        .from(pipeSystemSpecs)
        .where(
          and(
            eq(pipeSystemSpecs.organizationId, organizationOf(ctx)),
            jobId
              ? or(
                  isNull(pipeSystemSpecs.jobId),
                  eq(pipeSystemSpecs.jobId, jobId),
                )
              : isNull(pipeSystemSpecs.jobId),
          ),
        );
      const company: PipeSpecRow[] = [];
      const job: PipeSpecRow[] = [];
      for (const row of rows) {
        const parsed = pipeSpecSchema.safeParse(row.data);
        if (!parsed.success) continue;
        if (parsed.data.requirements && sourceContext)
          parsed.data.requirements = redactSystemRequirements(
            parsed.data.requirements,
            sourceContext.readableDocumentIds,
          );
        (row.jobId ? job : company).push({
          system: row.system,
          spec: parsed.data,
          revision: row.revision,
          updatedAt: row.updatedAt,
        });
      }
      const order = (a: PipeSpecRow, b: PipeSpecRow) =>
        a.system.localeCompare(b.system);
      return {
        company: company.sort(order),
        currentSources:
          sourceContext?.sources.map((s) => ({
            documentId: s.documentId,
            versionId: s.versionId,
          })) ?? [],
        job: job.sort(order),
        canEditCompany: userCan(ctx.user as never, "parts.edit"),
        canEditJob: Boolean(jobId) && userCan(ctx.user as never, "lists.edit"),
      };
    }),

  /** Save a standard. `revision` is what the editor started from; a stale save is refused. */
  save: hasDashboardAccess
    .input(
      z.object({
        system: pipeSystemCode,
        jobId: z.string().uuid().nullable(),
        spec: pipeSpecSchema,
        revision: z.number().int().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCanEdit(ctx, input.jobId);
      if (input.jobId) await requireJob(ctx, input.jobId);
      const organizationId = organizationOf(ctx);
      const scope = and(
        eq(pipeSystemSpecs.organizationId, organizationId),
        eq(pipeSystemSpecs.system, input.system),
        input.jobId
          ? eq(pipeSystemSpecs.jobId, input.jobId)
          : isNull(pipeSystemSpecs.jobId),
      );
      return ctx.db.transaction(async (tx) => {
        // Match assessment serialization so a manual save cannot lose a concurrent assessment.
        if (input.jobId)
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${input.jobId}, 4149))`,
          );
        const [existing] = await tx
          .select()
          .from(pipeSystemSpecs)
          .where(scope)
          .for("update")
          .limit(1);
        if ((existing?.revision ?? 0) !== input.revision)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Someone else changed this pipe standard. Reopen it to see their changes.",
          });
        await validateSpecReferences(tx, organizationId, input.spec);
        if (input.jobId)
          await validateSpecEvidence(
            userIdOf(ctx),
            input.jobId,
            input.spec,
            existing ? pipeSpecSchema.parse(existing.data) : undefined,
            tx,
          );
        else if (input.spec.requirements)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Evidence-backed systems belong to a job, not company standards.",
          });
        const savedSpec = retainManualEdits(
          existing ? pipeSpecSchema.parse(existing.data) : undefined,
          input.spec,
        );
        if (existing) {
          const [row] = await tx
            .update(pipeSystemSpecs)
            .set({
              data: savedSpec,
              revision: sql`${pipeSystemSpecs.revision} + 1`,
              updatedBy: userIdOf(ctx),
              updatedAt: new Date(),
            })
            .where(eq(pipeSystemSpecs.id, existing.id))
            .returning();
          return { revision: row!.revision };
        }
        const [row] = await tx
          .insert(pipeSystemSpecs)
          .values({
            organizationId,
            jobId: input.jobId,
            system: input.system,
            data: savedSpec,
            updatedBy: userIdOf(ctx),
          })
          .onConflictDoNothing()
          .returning();
        if (!row)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Someone else just saved this pipe standard. Reopen it to see their changes.",
          });
        return { revision: row.revision };
      });
    }),

  /** Remove a standard; for a job, the system goes back to the company standard. */
  remove: hasDashboardAccess
    .input(
      z.object({ system: pipeSystemCode, jobId: z.string().uuid().nullable() }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCanEdit(ctx, input.jobId);
      if (input.jobId) await requireJob(ctx, input.jobId);
      await ctx.db.transaction(async (tx) => {
        if (input.jobId)
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${input.jobId}, 4149))`,
          );
        const where = and(
          eq(pipeSystemSpecs.organizationId, organizationOf(ctx)),
          eq(pipeSystemSpecs.system, input.system),
          input.jobId
            ? eq(pipeSystemSpecs.jobId, input.jobId)
            : isNull(pipeSystemSpecs.jobId),
        );
        const [existing] = await tx
          .select()
          .from(pipeSystemSpecs)
          .where(where)
          .for("update")
          .limit(1);
        if (existing && input.jobId) {
          const previous = pipeSpecSchema.parse(existing.data);
          await validateSpecEvidence(
            userIdOf(ctx),
            input.jobId,
            previous,
            previous,
            tx,
          );
        }
        await tx.delete(pipeSystemSpecs).where(where);
      });
      return { ok: true };
    }),
});

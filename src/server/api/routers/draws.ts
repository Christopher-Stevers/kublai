import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import { z } from "zod";

import {
  centsToDecimalString,
  summarizeDraws,
  toCents,
  type DrawStatus,
} from "~/lib/draws";
import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import { assertCanAccessTab } from "~/server/auth/permissions";
import { db } from "~/server/db";
import {
  jobDrawItems,
  jobDrawLines,
  jobDraws,
  jobs,
} from "~/server/db/schema";

// Accepts "1234.56", "1,234.56", "$1234" etc. and stores a 2-decimal string.
const moneyInput = z
  .union([z.string(), z.number()])
  .transform((value) =>
    typeof value === "number" ? value : Number(value.replace(/[$,\s]/g, "")),
  )
  .refine((value) => Number.isFinite(value), "Enter a valid amount")
  .refine((value) => value >= 0, "Amount cannot be negative")
  .refine((value) => value < 1_000_000_000_000, "Amount is too large")
  .transform((value) => centsToDecimalString(Math.round(value * 100)));

const percentInput = z.number().min(0).max(100);

// Draws show billing figures, so every procedure requires the draws tab.
const drawsProcedure = hasDashboardAccess.use(({ ctx, next }) => {
  assertCanAccessTab(ctx.user, "draws");
  return next({
    ctx: { organizationId: ctx.user.organizationId as string },
  });
});

type Db = typeof db;

async function requireJob(db: Db, organizationId: string, jobId: string) {
  const [job] = await db
    .select({ id: jobs.id, name: jobs.name })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, organizationId)))
    .limit(1);
  if (!job) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Job not found." });
  }
  return job;
}

async function requireLine(db: Db, organizationId: string, lineId: string) {
  const [line] = await db
    .select()
    .from(jobDrawLines)
    .where(
      and(
        eq(jobDrawLines.id, lineId),
        eq(jobDrawLines.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!line) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Line item not found." });
  }
  return line;
}

async function requireDraw(db: Db, organizationId: string, drawId: string) {
  const [draw] = await db
    .select()
    .from(jobDraws)
    .where(
      and(eq(jobDraws.id, drawId), eq(jobDraws.organizationId, organizationId)),
    )
    .limit(1);
  if (!draw) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Draw not found." });
  }
  return draw;
}

async function latestDrawNumber(db: Db, jobId: string) {
  const [row] = await db
    .select({ value: max(jobDraws.drawNumber) })
    .from(jobDraws)
    .where(eq(jobDraws.jobId, jobId));
  return row?.value ?? 0;
}

function assertDraft(draw: { status: string }) {
  if (draw.status !== "draft") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Reopen this draw before editing it.",
    });
  }
}

export const drawsRouter = createTRPCRouter({
  /** Every job in the organization with its contract and billing totals. */
  listJobs: drawsProcedure.query(async ({ ctx }) => {
    const jobRows = await ctx.db
      .select({ id: jobs.id, name: jobs.name, status: jobs.status })
      .from(jobs)
      .where(eq(jobs.organizationId, ctx.organizationId))
      .orderBy(desc(jobs.updatedAt));

    const lines = await ctx.db
      .select({
        id: jobDrawLines.id,
        jobId: jobDrawLines.jobId,
        scheduledValue: jobDrawLines.scheduledValue,
      })
      .from(jobDrawLines)
      .where(eq(jobDrawLines.organizationId, ctx.organizationId));

    const draws = await ctx.db
      .select({
        id: jobDraws.id,
        jobId: jobDraws.jobId,
        drawNumber: jobDraws.drawNumber,
        status: jobDraws.status,
        retainagePercent: jobDraws.retainagePercent,
      })
      .from(jobDraws)
      .where(eq(jobDraws.organizationId, ctx.organizationId));

    const items = draws.length
      ? await ctx.db
          .select()
          .from(jobDrawItems)
          .where(
            inArray(
              jobDrawItems.drawId,
              draws.map((draw) => draw.id),
            ),
          )
      : [];

    return jobRows.map((job) => {
      const jobLines = lines.filter((line) => line.jobId === job.id);
      const jobDrawRows = draws.filter((draw) => draw.jobId === job.id);
      const summaries = summarizeDraws(
        jobLines,
        jobDrawRows.map((draw) => ({
          ...draw,
          completedToDate: Object.fromEntries(
            items
              .filter((item) => item.drawId === draw.id)
              .map((item) => [item.lineId, item.completedToDate]),
          ),
        })),
      );
      const latest = summaries.at(-1);
      const latestDraw = jobDrawRows.find(
        (draw) => draw.id === latest?.drawId,
      );
      const contractSumCents = jobLines.reduce(
        (sum, line) => sum + toCents(line.scheduledValue),
        0,
      );
      return {
        id: job.id,
        name: job.name,
        jobStatus: job.status,
        lineCount: jobLines.length,
        drawCount: jobDrawRows.length,
        contractSumCents,
        billedToDateCents: latest?.completedToDateCents ?? 0,
        percentComplete: latest?.percentComplete ?? 0,
        latestDrawNumber: latest?.drawNumber ?? null,
        latestDrawStatus: (latestDraw?.status ?? null) as DrawStatus | null,
      };
    });
  }),

  /** Schedule of values plus every draw, with all derived figures. */
  getJob: drawsProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const job = await requireJob(ctx.db, ctx.organizationId, input.jobId);

      const lines = await ctx.db
        .select()
        .from(jobDrawLines)
        .where(eq(jobDrawLines.jobId, job.id))
        .orderBy(asc(jobDrawLines.sortOrder), asc(jobDrawLines.createdAt));

      const draws = await ctx.db
        .select()
        .from(jobDraws)
        .where(eq(jobDraws.jobId, job.id))
        .orderBy(asc(jobDraws.drawNumber));

      const items = draws.length
        ? await ctx.db
            .select()
            .from(jobDrawItems)
            .where(
              inArray(
                jobDrawItems.drawId,
                draws.map((draw) => draw.id),
              ),
            )
        : [];

      const summaries = summarizeDraws(
        lines,
        draws.map((draw) => ({
          id: draw.id,
          drawNumber: draw.drawNumber,
          retainagePercent: draw.retainagePercent,
          completedToDate: Object.fromEntries(
            items
              .filter((item) => item.drawId === draw.id)
              .map((item) => [item.lineId, item.completedToDate]),
          ),
        })),
      );

      return {
        job,
        lines,
        draws: draws.map((draw, index) => ({
          ...draw,
          status: draw.status as DrawStatus,
          summary: summaries[index]!,
        })),
      };
    }),

  addLine: drawsProcedure
    .input(
      z.object({
        jobId: z.string().uuid(),
        itemNumber: z.string().trim().max(50).optional(),
        description: z.string().trim().min(1, "Description is required").max(500),
        scheduledValue: moneyInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireJob(ctx.db, ctx.organizationId, input.jobId);
      const [last] = await ctx.db
        .select({ value: max(jobDrawLines.sortOrder) })
        .from(jobDrawLines)
        .where(eq(jobDrawLines.jobId, input.jobId));
      const [line] = await ctx.db
        .insert(jobDrawLines)
        .values({
          organizationId: ctx.organizationId,
          jobId: input.jobId,
          itemNumber: input.itemNumber || null,
          description: input.description,
          scheduledValue: input.scheduledValue,
          sortOrder: (last?.value ?? -1) + 1,
        })
        .returning();
      return line;
    }),

  updateLine: drawsProcedure
    .input(
      z.object({
        lineId: z.string().uuid(),
        itemNumber: z.string().trim().max(50).optional(),
        description: z.string().trim().min(1).max(500).optional(),
        scheduledValue: moneyInput.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireLine(ctx.db, ctx.organizationId, input.lineId);
      const [line] = await ctx.db
        .update(jobDrawLines)
        .set({
          ...(input.itemNumber !== undefined
            ? { itemNumber: input.itemNumber || null }
            : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.scheduledValue !== undefined
            ? { scheduledValue: input.scheduledValue }
            : {}),
        })
        .where(eq(jobDrawLines.id, input.lineId))
        .returning();
      return line;
    }),

  moveLine: drawsProcedure
    .input(
      z.object({
        lineId: z.string().uuid(),
        direction: z.enum(["up", "down"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const line = await requireLine(ctx.db, ctx.organizationId, input.lineId);
      const siblings = await ctx.db
        .select({ id: jobDrawLines.id })
        .from(jobDrawLines)
        .where(eq(jobDrawLines.jobId, line.jobId))
        .orderBy(asc(jobDrawLines.sortOrder), asc(jobDrawLines.createdAt));
      const ids = siblings.map((row) => row.id);
      const from = ids.indexOf(line.id);
      const to = input.direction === "up" ? from - 1 : from + 1;
      if (to < 0 || to >= ids.length) return { ok: true };
      [ids[from], ids[to]] = [ids[to]!, ids[from]!];
      await ctx.db.transaction(async (tx) => {
        for (const [sortOrder, id] of ids.entries()) {
          await tx
            .update(jobDrawLines)
            .set({ sortOrder })
            .where(eq(jobDrawLines.id, id));
        }
      });
      return { ok: true };
    }),

  deleteLine: drawsProcedure
    .input(z.object({ lineId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireLine(ctx.db, ctx.organizationId, input.lineId);
      const [billed] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(jobDrawItems)
        .where(
          and(
            eq(jobDrawItems.lineId, input.lineId),
            sql`${jobDrawItems.completedToDate} <> 0`,
          ),
        );
      if ((billed?.count ?? 0) > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This line has been billed on a draw. Set its amounts to zero before deleting it.",
        });
      }
      await ctx.db.delete(jobDrawLines).where(eq(jobDrawLines.id, input.lineId));
      return { ok: true };
    }),

  /** Starts the next draw, carrying forward each line's completed amount. */
  createDraw: drawsProcedure
    .input(
      z.object({
        jobId: z.string().uuid(),
        periodEnd: z.string().date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireJob(ctx.db, ctx.organizationId, input.jobId);

      return ctx.db.transaction(async (tx) => {
        const [previous] = await tx
          .select()
          .from(jobDraws)
          .where(eq(jobDraws.jobId, input.jobId))
          .orderBy(desc(jobDraws.drawNumber))
          .limit(1);
        if (previous?.status === "draft") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Submit draw #${previous.drawNumber} before starting another.`,
          });
        }

        const [draw] = await tx
          .insert(jobDraws)
          .values({
            organizationId: ctx.organizationId,
            jobId: input.jobId,
            drawNumber: (previous?.drawNumber ?? 0) + 1,
            periodEnd: input.periodEnd ?? null,
            retainagePercent: previous?.retainagePercent ?? "10",
            createdByUserId: ctx.userId,
          })
          .returning();

        if (previous) {
          const previousItems = await tx
            .select()
            .from(jobDrawItems)
            .where(eq(jobDrawItems.drawId, previous.id));
          if (previousItems.length) {
            await tx.insert(jobDrawItems).values(
              previousItems.map((item) => ({
                drawId: draw!.id,
                lineId: item.lineId,
                completedToDate: item.completedToDate,
              })),
            );
          }
        }
        return draw!;
      });
    }),

  updateDraw: drawsProcedure
    .input(
      z.object({
        drawId: z.string().uuid(),
        periodEnd: z.string().date().nullable().optional(),
        retainagePercent: percentInput.optional(),
        notes: z.string().max(5000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const draw = await requireDraw(ctx.db, ctx.organizationId, input.drawId);
      if (input.retainagePercent !== undefined) assertDraft(draw);
      const [updated] = await ctx.db
        .update(jobDraws)
        .set({
          ...(input.periodEnd !== undefined
            ? { periodEnd: input.periodEnd }
            : {}),
          ...(input.retainagePercent !== undefined
            ? { retainagePercent: String(input.retainagePercent) }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        })
        .where(eq(jobDraws.id, draw.id))
        .returning();
      return updated;
    }),

  /** Sets a line's cumulative completed amount on a draft draw. */
  setCompleted: drawsProcedure
    .input(
      z.object({
        drawId: z.string().uuid(),
        lineId: z.string().uuid(),
        completedToDate: moneyInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const draw = await requireDraw(ctx.db, ctx.organizationId, input.drawId);
      assertDraft(draw);
      const line = await requireLine(ctx.db, ctx.organizationId, input.lineId);
      if (line.jobId !== draw.jobId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Line item belongs to a different job.",
        });
      }
      if (toCents(input.completedToDate) > toCents(line.scheduledValue)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Completed amount cannot exceed the scheduled value.",
        });
      }
      await ctx.db
        .insert(jobDrawItems)
        .values({
          drawId: draw.id,
          lineId: line.id,
          completedToDate: input.completedToDate,
        })
        .onConflictDoUpdate({
          target: [jobDrawItems.drawId, jobDrawItems.lineId],
          set: { completedToDate: input.completedToDate, updatedAt: new Date() },
        });
      return { ok: true };
    }),

  setStatus: drawsProcedure
    .input(
      z.object({
        drawId: z.string().uuid(),
        status: z.enum(["draft", "submitted", "paid"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const draw = await requireDraw(ctx.db, ctx.organizationId, input.drawId);
      if (
        input.status === "draft" &&
        draw.drawNumber !== (await latestDrawNumber(ctx.db, draw.jobId))
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only the latest draw can be reopened.",
        });
      }
      const now = new Date();
      const [updated] = await ctx.db
        .update(jobDraws)
        .set({
          status: input.status,
          submittedAt:
            input.status === "draft" ? null : (draw.submittedAt ?? now),
          paidAt: input.status === "paid" ? (draw.paidAt ?? now) : null,
        })
        .where(eq(jobDraws.id, draw.id))
        .returning();
      return updated;
    }),

  deleteDraw: drawsProcedure
    .input(z.object({ drawId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const draw = await requireDraw(ctx.db, ctx.organizationId, input.drawId);
      assertDraft(draw);
      if (draw.drawNumber !== (await latestDrawNumber(ctx.db, draw.jobId))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only the latest draw can be deleted.",
        });
      }
      await ctx.db.delete(jobDraws).where(eq(jobDraws.id, draw.id));
      return { ok: true };
    }),
});

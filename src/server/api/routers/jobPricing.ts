import {
  pricingJobs as jobs,
  pricingMaterialLists as materialLists,
  pricingSuppliers as suppliers,
  pricingUsers as users,
} from "~/server/job-pricing-schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import { assertCan, userCan } from "~/server/auth/permissions";
import {
  jobPriceLists,
  jobPriceEntries,
  jobOrderApprovals,
  jobPricingAudit,
  supplierParts,
} from "~/server/db/schema";
import {
  getJobPriceBook,
  lockJobPurchasing,
  loadJobApprovalSnapshot,
} from "~/server/job-pricing";
import { recalculatePurchaseTotals } from "~/server/purchasing";
import { publishMaterialListEvent } from "~/server/material-list-events";
import type { db } from "~/server/db";

async function requireJob(
  database: Pick<typeof db, "select">,
  org: string | null,
  jobId: string,
) {
  if (!org) throw new TRPCError({ code: "FORBIDDEN" });
  const [job] = await database
    .select({ id: jobs.id, name: jobs.name })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, org)))
    .limit(1);
  if (!job)
    throw new TRPCError({ code: "NOT_FOUND", message: "Job not found." });
  return { job, org };
}
const jobInput = z.object({ jobId: z.string().uuid() });
const lineInput = z
  .object({
    entryId: z.string().uuid(),
    unitCost: z
      .number()
      .finite()
      .min(0)
      .max(99999999)
      .multipleOf(0.0001)
      .nullable(),
    priceStatus: z.enum(["none", "estimated", "confirmed"]),
    priceSource: z.string().trim().min(1).max(4000),
  })
  .refine(
    (i) => (i.priceStatus === "none") === (i.unitCost === null),
    "A price is required for estimated or confirmed pricing.",
  );

export const jobPricingRouter = createTRPCRouter({
  summary: hasDashboardAccess.input(jobInput).query(async ({ ctx, input }) => {
    const { org } = await requireJob(
      ctx.db,
      ctx.user.organizationId,
      input.jobId,
    );
    const [row] = await ctx.db
      .select({ pendingCount: sql<number>`count(*)::int` })
      .from(jobOrderApprovals)
      .where(
        and(
          eq(jobOrderApprovals.organizationId, org),
          eq(jobOrderApprovals.jobId, input.jobId),
          eq(jobOrderApprovals.status, "pending"),
        ),
      );
    return { pendingCount: row?.pendingCount ?? 0 };
  }),
  get: hasDashboardAccess.input(jobInput).query(async ({ ctx, input }) => {
    const { job, org } = await requireJob(
      ctx.db,
      ctx.user.organizationId,
      input.jobId,
    );
    const book = await getJobPriceBook(ctx.db, org, job.id);
    const pending = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobOrderApprovals)
      .where(
        and(
          eq(jobOrderApprovals.organizationId, org),
          eq(jobOrderApprovals.jobId, job.id),
          eq(jobOrderApprovals.status, "pending"),
        ),
      );
    return {
      ...book,
      entries: book.entries.map((e) => ({
        ...e,
        priceSource: userCan(ctx.user, "financial.view") ? e.priceSource : null,
      })),
      job,
      pendingCount: pending[0]?.count ?? 0,
      canManage: userCan(ctx.user, "jobPricing.manage"),
      canApprove: userCan(ctx.user, "jobPricing.approve"),
    };
  }),
  savePrices: hasDashboardAccess
    .input(
      jobInput.extend({
        revision: z.number().int(),
        lines: z.array(lineInput).min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.user, "jobPricing.manage");
      assertCan(ctx.user, "financial.view");
      const { org } = await requireJob(
        ctx.db,
        ctx.user.organizationId,
        input.jobId,
      );
      if (
        new Set(input.lines.map((i) => i.entryId)).size !== input.lines.length
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Duplicate pricing rows.",
        });
      const result = await ctx.db.transaction(async (tx) => {
        await lockJobPurchasing(tx, org, input.jobId);
        const book = await getJobPriceBook(tx, org, input.jobId);
        if (book.policy?.revision !== input.revision)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Pricing changed. Reload the list before saving.",
          });
        const owned = new Set(book.entries.map((e) => e.id));
        if (input.lines.some((i) => !owned.has(i.entryId)))
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Pricing entry not found in this job.",
          });
        for (const line of input.lines)
          await tx
            .update(jobPriceEntries)
            .set({
              unitCost:
                line.unitCost === null ? null : line.unitCost.toFixed(4),
              priceStatus: line.priceStatus,
              priceSource: line.priceSource,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(jobPriceEntries.id, line.entryId),
                eq(jobPriceEntries.priceListId, book.policy.id),
              ),
            );
        await tx
          .update(jobPriceLists)
          .set({
            revision: sql`${jobPriceLists.revision}+1`,
            updatedAt: new Date(),
          })
          .where(eq(jobPriceLists.id, book.policy.id));
        await tx.insert(jobPricingAudit).values({
          organizationId: org,
          jobId: input.jobId,
          action: "prices_changed",
          userId: ctx.user.id,
          actorUserId: ctx.actorUser?.id ?? ctx.user.id,
          detail: {
            before: book.entries.filter((e) =>
              input.lines.some((l) => l.entryId === e.id),
            ),
            after: input.lines,
          },
        });
        await tx
          .update(jobOrderApprovals)
          .set({ status: "superseded" })
          .where(
            and(
              eq(jobOrderApprovals.organizationId, org),
              eq(jobOrderApprovals.jobId, input.jobId),
              inArray(jobOrderApprovals.status, ["pending", "approved"]),
              sql`${jobOrderApprovals.usedAt} is null`,
            ),
          );
        const lists = await tx
          .select({ id: materialLists.id, quoteId: materialLists.quoteId })
          .from(materialLists)
          .where(
            and(
              eq(materialLists.jobId, input.jobId),
              eq(materialLists.organizationId, org),
            ),
          );
        for (const list of lists)
          if (list.quoteId) await recalculatePurchaseTotals(tx, list.quoteId);
        return lists;
      });
      for (const list of result)
        publishMaterialListEvent(list.id, "updated", org);
      return { saved: input.lines.length };
    }),
  addListing: hasDashboardAccess
    .input(jobInput.extend({ supplierPartId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.user, "jobPricing.manage");
      const { org } = await requireJob(
        ctx.db,
        ctx.user.organizationId,
        input.jobId,
      );
      return ctx.db.transaction(async (tx) => {
        await lockJobPurchasing(tx, org, input.jobId);
        const [listing] = await tx
          .select()
          .from(supplierParts)
          .where(
            and(
              eq(supplierParts.id, input.supplierPartId),
              eq(supplierParts.organizationId, org),
            ),
          )
          .limit(1);
        if (!listing)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Supplier listing not found.",
          });
        let { policy } = await getJobPriceBook(tx, org, input.jobId);
        if (!policy) {
          const [created] = await tx
            .insert(jobPriceLists)
            .values({
              organizationId: org,
              jobId: input.jobId,
              name: "Job pricing list",
            })
            .returning();
          policy = created ?? null;
        }
        if (!policy) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const inserted = await tx
          .insert(jobPriceEntries)
          .values({
            priceListId: policy.id,
            supplierPartId: listing.id,
            sourceDescription: listing.supplierName,
          })
          .onConflictDoNothing()
          .returning();
        if (inserted.length) {
          await tx
            .update(jobPriceLists)
            .set({
              revision: sql`${jobPriceLists.revision}+1`,
              updatedAt: new Date(),
            })
            .where(eq(jobPriceLists.id, policy.id));
          await tx.insert(jobPricingAudit).values({
            organizationId: org,
            jobId: input.jobId,
            action: "listing_added",
            userId: ctx.user.id,
            actorUserId: ctx.actorUser?.id ?? ctx.user.id,
            detail: { supplierPartId: listing.id },
          });
        }
        return { added: inserted.length };
      });
    }),
  approvals: hasDashboardAccess
    .input(jobInput)
    .query(async ({ ctx, input }) => {
      const { org } = await requireJob(
        ctx.db,
        ctx.user.organizationId,
        input.jobId,
      );
      const rows = await ctx.db
        .select({
          id: jobOrderApprovals.id,
          materialListId: jobOrderApprovals.materialListId,
          supplierId: jobOrderApprovals.supplierId,
          status: jobOrderApprovals.status,
          snapshot: jobOrderApprovals.snapshot,
          requestNote: jobOrderApprovals.requestNote,
          reviewNote: jobOrderApprovals.reviewNote,
          createdAt: jobOrderApprovals.createdAt,
          reviewedAt: jobOrderApprovals.reviewedAt,
          usedAt: jobOrderApprovals.usedAt,
          requestedBy: jobOrderApprovals.requestedBy,
          requesterName: users.name,
          listName: materialLists.name,
          supplierName: suppliers.name,
        })
        .from(jobOrderApprovals)
        .innerJoin(
          materialLists,
          eq(jobOrderApprovals.materialListId, materialLists.id),
        )
        .innerJoin(suppliers, eq(jobOrderApprovals.supplierId, suppliers.id))
        .leftJoin(users, eq(jobOrderApprovals.requestedBy, users.id))
        .where(
          and(
            eq(jobOrderApprovals.organizationId, org),
            eq(jobOrderApprovals.jobId, input.jobId),
            ...(userCan(ctx.user, "jobPricing.approve")
              ? []
              : [eq(jobOrderApprovals.requestedBy, ctx.user.id)]),
          ),
        )
        .orderBy(desc(jobOrderApprovals.createdAt))
        .limit(200);
      return rows;
    }),
  requestApproval: hasDashboardAccess
    .input(
      z.object({
        materialListId: z.string().uuid(),
        supplierId: z.string().uuid(),
        note: z.string().trim().min(3).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.user, "orders.send");
      if (!ctx.user.organizationId) throw new TRPCError({ code: "FORBIDDEN" });
      const org = ctx.user.organizationId;
      const initial = await loadJobApprovalSnapshot(
        ctx.db,
        org,
        input.materialListId,
        input.supplierId,
      );
      return ctx.db.transaction(async (tx) => {
        await lockJobPurchasing(tx, org, initial.list.jobId);
        const current = await loadJobApprovalSnapshot(
          tx,
          org,
          input.materialListId,
          input.supplierId,
        );
        if (!current.approval.required)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "These parts are on the job pricing list. Approval is not required.",
          });
        if (current.approval.status === "pending" || current.approval.allowed)
          return current.approval;
        await tx
          .update(jobOrderApprovals)
          .set({ status: "superseded" })
          .where(
            and(
              eq(jobOrderApprovals.organizationId, org),
              eq(jobOrderApprovals.materialListId, input.materialListId),
              eq(jobOrderApprovals.supplierId, input.supplierId),
              inArray(jobOrderApprovals.status, ["pending", "approved"]),
              sql`${jobOrderApprovals.usedAt} is null`,
            ),
          );
        const values = {
          organizationId: org,
          jobId: current.list.jobId,
          materialListId: input.materialListId,
          supplierId: input.supplierId,
          fingerprint: current.approval.fingerprint,
          snapshot: current.items,
          requestNote: input.note,
          requestedBy: ctx.user.id,
          requestedByActor: ctx.actorUser?.id ?? ctx.user.id,
          status: "pending",
        };
        const [row] = await tx
          .insert(jobOrderApprovals)
          .values(values)
          .onConflictDoUpdate({
            target: [
              jobOrderApprovals.organizationId,
              jobOrderApprovals.materialListId,
              jobOrderApprovals.supplierId,
              jobOrderApprovals.fingerprint,
            ],
            set: {
              ...values,
              usedAt: null,
              reviewedAt: null,
              reviewedBy: null,
              reviewedByActor: null,
              reviewNote: null,
              createdAt: new Date(),
            },
          })
          .returning({ id: jobOrderApprovals.id });
        await tx.insert(jobPricingAudit).values({
          organizationId: org,
          jobId: current.list.jobId,
          action: "approval_requested",
          userId: ctx.user.id,
          actorUserId: ctx.actorUser?.id ?? ctx.user.id,
          detail: { approvalId: row?.id, ...values },
        });
        return {
          ...current.approval,
          status: "pending",
          approvalId: row?.id ?? null,
        };
      });
    }),
  reviewApproval: hasDashboardAccess
    .input(
      z.object({
        approvalId: z.string().uuid(),
        decision: z.enum(["approved", "rejected"]),
        note: z.string().trim().min(3).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.user, "jobPricing.approve");
      if (!ctx.user.organizationId) throw new TRPCError({ code: "FORBIDDEN" });
      const org = ctx.user.organizationId;
      return ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(jobOrderApprovals)
          .where(
            and(
              eq(jobOrderApprovals.id, input.approvalId),
              eq(jobOrderApprovals.organizationId, org),
            ),
          )
          .limit(1);
        if (!row) throw new TRPCError({ code: "NOT_FOUND" });
        await lockJobPurchasing(tx, org, row.jobId);
        const current = await loadJobApprovalSnapshot(
          tx,
          org,
          row.materialListId,
          row.supplierId,
        );
        if (
          current.approval.fingerprint !== row.fingerprint ||
          current.approval.status !== "pending"
        )
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This request changed or was already reviewed. Ask for a fresh approval.",
          });
        await tx
          .update(jobOrderApprovals)
          .set({
            status: input.decision,
            reviewNote: input.note,
            reviewedAt: new Date(),
            reviewedBy: ctx.user.id,
            reviewedByActor: ctx.actorUser?.id ?? ctx.user.id,
          })
          .where(
            and(
              eq(jobOrderApprovals.id, row.id),
              eq(jobOrderApprovals.status, "pending"),
            ),
          );
        await tx.insert(jobPricingAudit).values({
          organizationId: org,
          jobId: row.jobId,
          action: `order_${input.decision}`,
          userId: ctx.user.id,
          actorUserId: ctx.actorUser?.id ?? ctx.user.id,
          detail: {
            approvalId: row.id,
            note: input.note,
            fingerprint: row.fingerprint,
          },
        });
        return { status: input.decision };
      });
    }),
});

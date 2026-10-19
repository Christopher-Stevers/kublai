import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import { assertCan, userCan } from "~/server/auth/permissions";
import {
  supplierPriceBooks,
  supplierPriceBookEntries,
  supplierParts,
  jobSupplierPriceBooks,
} from "~/server/db/schema";
import {
  pricingSuppliers as suppliers,
  pricingJobs as jobs,
} from "~/server/job-pricing-schema";
import {
  refreshSupplierPricingPreference,
  lockPriceBooks,
  syncPriceBook,
  syncSupplierJobBook,
} from "~/server/supplier-price-books";
import {
  publishMaterialListEvent,
  publishOrganizationCatalogueEvent,
} from "~/server/material-list-events";
import type { db } from "~/server/db";
type Reader = Pick<typeof db, "select" | "execute">;
async function supplier(reader: Reader, org: string | null, id: string) {
  if (!org) throw new TRPCError({ code: "FORBIDDEN" });
  const [row] = await reader
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(and(eq(suppliers.id, id), eq(suppliers.organizationId, org)));
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "Supplier not found" });
  return row;
}
async function book(reader: Reader, org: string | null, id: string) {
  if (!org) throw new TRPCError({ code: "FORBIDDEN" });
  const [row] = await reader
    .select()
    .from(supplierPriceBooks)
    .where(
      and(
        eq(supplierPriceBooks.id, id),
        eq(supplierPriceBooks.organizationId, org),
      ),
    );
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "Price book not found" });
  return row;
}
function notify(lists: { id: string }[], org: string) {
  for (const list of lists) publishMaterialListEvent(list.id, "updated", org);
  publishOrganizationCatalogueEvent(org);
}
const supplierInput = z.object({ supplierId: z.string().uuid() });
export const supplierPriceBooksRouter = createTRPCRouter({
  preferences: hasDashboardAccess.query(async ({ ctx }) => {
    const org = ctx.user.organizationId;
    if (!org) throw new TRPCError({ code: "FORBIDDEN" });
    const rows = await ctx.db
      .select({
        supplierId: suppliers.id,
        preferJobPricing: sql<boolean>`coalesce(${suppliers.preferJobPricing},true)`,
      })
      .from(suppliers)
      .where(eq(suppliers.organizationId, org));
    return { rows, canManage: userCan(ctx.user, "jobPricing.manage") };
  }),
  setPreference: hasDashboardAccess
    .input(supplierInput.extend({ preferJobPricing: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.user, "jobPricing.manage");
      const org = ctx.user.organizationId!;
      const lists = await ctx.db.transaction(async (tx) => {
        await lockPriceBooks(tx);
        await supplier(tx, org, input.supplierId);
        await tx.execute(
          sql`update kublai_supplier set "preferJobPricing"=${input.preferJobPricing},"updatedAt"=now() where id=${input.supplierId} and "organizationId"=${org}`,
        );
        return refreshSupplierPricingPreference(tx, org, input.supplierId);
      });
      notify(lists, org);
      return { preferJobPricing: input.preferJobPricing };
    }),
  assignments: hasDashboardAccess
    .input(supplierInput)
    .query(async ({ ctx, input }) => {
      const org = ctx.user.organizationId;
      const owner = await supplier(ctx.db, org, input.supplierId);
      const books = await ctx.db
        .select({ id: supplierPriceBooks.id, name: supplierPriceBooks.name })
        .from(supplierPriceBooks)
        .where(
          and(
            eq(supplierPriceBooks.organizationId, org!),
            eq(supplierPriceBooks.supplierId, input.supplierId),
          ),
        )
        .orderBy(supplierPriceBooks.name);
      const assignments = await ctx.db.execute<{
        id: string;
        name: string;
        bookId: string | null;
      }>(
        sql`select j.id,j.name,a."bookId" from kublai_job j left join kublai_job_supplier_price_book a on a."jobId"=j.id and a."supplierId"=${input.supplierId} where j."organizationId"=${org} order by j.name,j.id`,
      );
      return {
        supplier: owner,
        books,
        jobs: [...assignments],
        canAssign: userCan(ctx.user, "jobPricing.manage"),
      };
    }),
  list: hasDashboardAccess
    .input(
      supplierInput.extend({ supplierPartId: z.string().uuid().optional() }),
    )
    .query(async ({ ctx, input }) => {
      const org = ctx.user.organizationId;
      await supplier(ctx.db, org, input.supplierId);
      if (input.supplierPartId) {
        const [part] = await ctx.db
          .select({ id: supplierParts.id })
          .from(supplierParts)
          .where(
            and(
              eq(supplierParts.id, input.supplierPartId),
              eq(supplierParts.supplierId, input.supplierId),
              eq(supplierParts.organizationId, org!),
            ),
          );
        if (!part) throw new TRPCError({ code: "NOT_FOUND" });
      }
      const books = await ctx.db.execute<{
        id: string;
        name: string;
        revision: number;
        count: number;
      }>(sql`select b.id,b.name,b.revision,count(e.id)::int as count from kublai_supplier_price_book b left join kublai_supplier_price_book_entry e on e."bookId"=b.id where b."organizationId"=${org} and b."supplierId"=${input.supplierId}
    ${input.supplierPartId ? sql`and exists (select 1 from kublai_supplier_price_book_entry x where x."bookId"=b.id and x."supplierPartId"=${input.supplierPartId})` : sql``} group by b.id order by b.name`);
      return {
        books: [...books],
        canManage:
          userCan(ctx.user, "suppliers.edit") &&
          userCan(ctx.user, "financial.view"),
      };
    }),
  get: hasDashboardAccess
    .input(supplierInput.extend({ bookId: z.string().uuid().nullable() }))
    .query(async ({ ctx, input }) => {
      const org = ctx.user.organizationId;
      const owner = await supplier(ctx.db, org, input.supplierId);
      const selected = input.bookId
        ? await book(ctx.db, org, input.bookId)
        : null;
      if (selected && selected.supplierId !== input.supplierId)
        throw new TRPCError({ code: "BAD_REQUEST" });
      const rows = await ctx.db.execute<{
        id: string;
        name: string;
        sku: string | null;
        included: boolean;
        unitCost: string | null;
        priceStatus: string;
        imageUrl: string | null;
      }>(sql`select sp.id,p."displayName" as name,sp."supplierSku" as sku,p."imageUrl",${input.bookId ? sql`(e.id is not null)` : sql`true`} as included,
     ${input.bookId ? sql`e."unitCost"` : sql`sp."lastKnownUnitCost"`} as "unitCost",${input.bookId ? sql`coalesce(e."priceStatus",'none')` : sql`case when sp."lastKnownUnitCost" is null then 'none' else 'standard' end`} as "priceStatus"
    from kublai_supplier_part sp join kublai_part_definition p on p.id=sp."partDefinitionId"
    left join kublai_supplier_price_book_entry e on e."supplierPartId"=sp.id and e."bookId"=${input.bookId}
    where sp."organizationId"=${org} and sp."supplierId"=${input.supplierId} order by p."displayName",sp."supplierSku"`);
      const assignments = await ctx.db.execute<{
        id: string;
        name: string;
        bookId: string | null;
      }>(
        sql`select j.id,j.name,a."bookId" from kublai_job j left join kublai_job_supplier_price_book a on a."jobId"=j.id and a."supplierId"=${input.supplierId} where j."organizationId"=${org} order by j.name`,
      );
      return {
        supplier: owner,
        book: selected,
        rows: rows.map((r) => ({
          ...r,
          unitCost: userCan(ctx.user, "financial.view") ? r.unitCost : null,
        })),
        jobs: [...assignments],
        canManage:
          userCan(ctx.user, "suppliers.edit") &&
          userCan(ctx.user, "financial.view"),
        canAssign: userCan(ctx.user, "jobPricing.manage"),
        showPrices: userCan(ctx.user, "financial.view"),
      };
    }),
  create: hasDashboardAccess
    .input(
      supplierInput.extend({
        name: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .refine(
            (n) => n.toLowerCase() !== "standard",
            "Standard is reserved",
          ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.user, "suppliers.edit");
      await supplier(ctx.db, ctx.user.organizationId, input.supplierId);
      const [created] = await ctx.db
        .insert(supplierPriceBooks)
        .values({
          organizationId: ctx.user.organizationId!,
          supplierId: input.supplierId,
          name: input.name,
        })
        .returning();
      return created!;
    }),
  saveEntry: hasDashboardAccess
    .input(
      z
        .object({
          bookId: z.string().uuid(),
          revision: z.number().int(),
          supplierPartId: z.string().uuid(),
          included: z.boolean(),
          unitCost: z
            .number()
            .finite()
            .min(0)
            .max(99999999)
            .multipleOf(0.0001)
            .nullable(),
          priceStatus: z.enum(["none", "estimated", "confirmed"]),
        })
        .refine(
          (i) =>
            !i.included || (i.unitCost === null) === (i.priceStatus === "none"),
          "Choose a price status matching the amount",
        ),
    )
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.user, "suppliers.edit");
      assertCan(ctx.user, "financial.view");
      const org = ctx.user.organizationId!;
      const lists = await ctx.db.transaction(async (tx) => {
        await lockPriceBooks(tx);
        const b = await book(tx, org, input.bookId);
        if (b.revision !== input.revision)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Price book changed. Reload before saving.",
          });
        const [part] = await tx
          .select()
          .from(supplierParts)
          .where(
            and(
              eq(supplierParts.id, input.supplierPartId),
              eq(supplierParts.supplierId, b.supplierId),
              eq(supplierParts.organizationId, org),
            ),
          );
        if (!part)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This part is not supplied by this supplier.",
          });
        if (input.included)
          await tx
            .insert(supplierPriceBookEntries)
            .values({
              bookId: b.id,
              supplierPartId: part.id,
              unitCost: input.unitCost?.toFixed(4) ?? null,
              priceStatus: input.priceStatus,
              sourceDescription: part.supplierName,
              priceSource: "Edited in supplier price books",
            })
            .onConflictDoUpdate({
              target: [
                supplierPriceBookEntries.bookId,
                supplierPriceBookEntries.supplierPartId,
              ],
              set: {
                unitCost: input.unitCost?.toFixed(4) ?? null,
                priceStatus: input.priceStatus,
                priceSource: "Edited in supplier price books",
              },
            });
        else
          await tx
            .delete(supplierPriceBookEntries)
            .where(
              and(
                eq(supplierPriceBookEntries.bookId, b.id),
                eq(supplierPriceBookEntries.supplierPartId, part.id),
              ),
            );
        await tx
          .update(supplierPriceBooks)
          .set({ revision: b.revision + 1 })
          .where(eq(supplierPriceBooks.id, b.id));
        return syncPriceBook(tx, org, b.id);
      });
      notify(lists, org);
      return { saved: true };
    }),
  assign: hasDashboardAccess
    .input(
      supplierInput.extend({
        bookId: z.string().uuid().nullable(),
        jobId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.user, "jobPricing.manage");
      const org = ctx.user.organizationId!;
      const lists = await ctx.db.transaction(async (tx) => {
        await lockPriceBooks(tx);
        await supplier(tx, org, input.supplierId);
        const [job] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.id, input.jobId), eq(jobs.organizationId, org)));
        if (!job) throw new TRPCError({ code: "NOT_FOUND" });
        if (input.bookId) {
          const b = await book(tx, org, input.bookId);
          if (b.supplierId !== input.supplierId)
            throw new TRPCError({ code: "BAD_REQUEST" });
          await tx
            .insert(jobSupplierPriceBooks)
            .values({
              jobId: input.jobId,
              supplierId: input.supplierId,
              bookId: b.id,
            })
            .onConflictDoUpdate({
              target: [
                jobSupplierPriceBooks.jobId,
                jobSupplierPriceBooks.supplierId,
              ],
              set: { bookId: b.id },
            });
        } else
          await tx
            .delete(jobSupplierPriceBooks)
            .where(
              and(
                eq(jobSupplierPriceBooks.jobId, input.jobId),
                eq(jobSupplierPriceBooks.supplierId, input.supplierId),
              ),
            );
        return syncSupplierJobBook(tx, org, input.jobId, input.supplierId);
      });
      notify(lists, org);
      return { saved: true };
    }),
});

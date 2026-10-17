import {
  pricingMaterialLists as materialLists,
  pricingSuppliers as suppliers,
} from "~/server/job-pricing-schema";
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { db } from "~/server/db";
import {
  jobPriceLists,
  jobPriceEntries,
  jobOrderApprovals,
  supplierParts,
  partDefinitions,
  quoteItems,
} from "~/server/db/schema";
import { findJobPrice, indexJobPrices, type ApprovalSnapshotItem } from "~/lib/job-pricing";

type Database = Pick<typeof db, "select" | "update" | "execute">;

/** Shared with price edits and sending, so approval cannot race a price-list change. */
export async function lockJobPurchasing(
  database: Pick<typeof db, "execute">,
  org: string,
  jobId: string,
) {
  await database.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`${org}:${jobId}:orders`}))`,
  );
}

export async function getJobPriceBook(
  database: Pick<typeof db, "select">,
  organizationId: string,
  jobId: string,
) {
  const [policy] = await database
    .select()
    .from(jobPriceLists)
    .where(
      and(
        eq(jobPriceLists.organizationId, organizationId),
        eq(jobPriceLists.jobId, jobId),
      ),
    )
    .limit(1);
  const entries = policy?.active
    ? await database
        .select({
          id: jobPriceEntries.id,
          supplierPartId: supplierParts.id,
          partDefinitionId: supplierParts.partDefinitionId,
          supplierId: supplierParts.supplierId,
          supplierName: suppliers.name,
          supplierSku: supplierParts.supplierSku,
          unitCost: jobPriceEntries.unitCost,
          priceStatus: jobPriceEntries.priceStatus,
          priceBasis: jobPriceEntries.priceBasis,
          priceSource: jobPriceEntries.priceSource,
          sourceDescription: jobPriceEntries.sourceDescription,
          updatedAt: jobPriceEntries.updatedAt,
          displayName: partDefinitions.displayName,
          imageUrl: partDefinitions.imageUrl,
          bulkUnit: partDefinitions.bulkUnit,
          individualUnit: partDefinitions.individualUnit,
          piecesPerPack: partDefinitions.piecesPerPack,
        })
        .from(jobPriceEntries)
        .innerJoin(
          supplierParts,
          eq(jobPriceEntries.supplierPartId, supplierParts.id),
        )
        .innerJoin(
          partDefinitions,
          eq(supplierParts.partDefinitionId, partDefinitions.id),
        )
        .innerJoin(suppliers, eq(supplierParts.supplierId, suppliers.id))
        .where(
          and(
            eq(jobPriceEntries.priceListId, policy.id),
            eq(supplierParts.organizationId, organizationId),
            eq(jobPriceEntries.active, true),
          ),
        )
    : [];
  return { policy: policy ?? null, entries };
}

type Priceable = {
  id: string;
  partDefinitionId: string | null;
  supplierPartId: string | null;
  selectedSupplierId: string | null;
  supplierPartSupplierId: string | null;
  unitCost: string | null;
  supplierSku: string | null;
  packSize?: string | null;
};
/** Resolve by immutable part ID, supplier and listing. Never by fuzzy description at order time. */
export async function resolveJobOrderItems<T extends Priceable>(
  database: Pick<typeof db, "select">,
  org: string,
  jobId: string,
  items: T[],
) {
  const book = await getJobPriceBook(database, org, jobId);
  const priceIndex = indexJobPrices(book.entries);
  const listingIds = new Set<string>();
  const resolved = items.map((item) => {
    const entry = findJobPrice(
      priceIndex,
      item.partDefinitionId,
      item.selectedSupplierId ?? item.supplierPartSupplierId,
      item.supplierPartId,
    );
    if (!entry)
      return { ...item, jobListed: false, priceStatus: null as string | null };
    listingIds.add(entry.supplierPartId);
    return {
      ...item,
      jobListed: true,
      priceStatus: entry.priceStatus,
      supplierPartId: entry.supplierPartId,
      supplierPartSupplierId: entry.supplierId,
      supplierSku: entry.supplierSku,
      unitCost: entry.unitCost ?? item.unitCost,
    };
  });
  // A catalogue's generic supplier row may have a different order multiple.
  const listings = listingIds.size
    ? await database
        .select({ id: supplierParts.id, packSize: supplierParts.packSize })
        .from(supplierParts)
        .where(inArray(supplierParts.id, [...listingIds]))
    : [];
  const multiples = new Map(listings.map((l) => [l.id, l.packSize]));
  return resolved.map((item) =>
    item.jobListed
      ? { ...item, packSize: multiples.get(item.supplierPartId!) ?? null }
      : item,
  );
}

function decimal(value: string | null | undefined) {
  return Number(value ?? 0).toFixed(6);
}
export function orderApprovalFingerprint(input: {
  organizationId: string;
  jobId: string;
  materialListId: string;
  supplierId: string;
  revision: number;
  items: ApprovalSnapshotItem[];
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...input,
        items: input.items
          .map((i) => ({
            id: i.id,
            part: i.partDefinitionId,
            listing: i.supplierPartId,
            sku: i.supplierSku,
            quantity: decimal(i.quantity),
            requested: decimal(i.requestedQuantity ?? i.quantity),
            cost: decimal(i.unitCost),
            description: i.descriptionSnapshot,
            listed: i.listed,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      }),
    )
    .digest("hex");
}

export async function checkJobOrderApproval(
  database: Pick<typeof db, "select">,
  input: {
    organizationId: string;
    jobId: string;
    materialListId: string;
    supplierId: string;
    items: ApprovalSnapshotItem[];
  },
) {
  const [policy] = await database
    .select()
    .from(jobPriceLists)
    .where(
      and(
        eq(jobPriceLists.organizationId, input.organizationId),
        eq(jobPriceLists.jobId, input.jobId),
      ),
    )
    .limit(1);
  const unlisted = input.items.filter((i) => !i.listed);
  const required =
    !!policy?.active && !!policy.requireApproval && unlisted.length > 0;
  const fingerprint = orderApprovalFingerprint({
    ...input,
    revision: policy?.revision ?? 0,
  });
  const [approval] = required
    ? await database
        .select()
        .from(jobOrderApprovals)
        .where(
          and(
            eq(jobOrderApprovals.organizationId, input.organizationId),
            eq(jobOrderApprovals.materialListId, input.materialListId),
            eq(jobOrderApprovals.supplierId, input.supplierId),
            eq(jobOrderApprovals.fingerprint, fingerprint),
            isNull(jobOrderApprovals.usedAt),
          ),
        )
        .limit(1)
    : [];
  return {
    required,
    allowed: !required || approval?.status === "approved",
    fingerprint,
    unlistedCount: unlisted.length,
    approvalId: approval?.id ?? null,
    status: approval?.status ?? (required ? "needed" : "not_required"),
    reviewNote: approval?.reviewNote ?? null,
  };
}

export function assertJobOrderApproved(approval: { allowed: boolean }) {
  if (!approval.allowed)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This order includes parts outside the job pricing list. Request approval before sending. Changing quantities, supplier or prices requires a new approval.",
    });
}

/** Reprice unsent list rows only. Sent quantities and costs are immutable order snapshots. */
export async function applyJobQuotePrices(database: Database, quoteId: string) {
  const [list] = await database
    .select({
      jobId: materialLists.jobId,
      org: materialLists.organizationId,
      kind: materialLists.kind,
    })
    .from(materialLists)
    .where(eq(materialLists.quoteId, quoteId))
    .limit(1);
  if (!list || list.kind === "tools") return;
  const items = await database
    .select({
      id: quoteItems.id,
      partDefinitionId: quoteItems.partDefinitionId,
      supplierPartId: quoteItems.supplierPartId,
      selectedSupplierId: quoteItems.supplierId,
      supplierPartSupplierId: supplierParts.supplierId,
      unitCost: quoteItems.unitCost,
      supplierSku: supplierParts.supplierSku,
      packSize: supplierParts.packSize,
    })
    .from(quoteItems)
    .leftJoin(supplierParts, eq(quoteItems.supplierPartId, supplierParts.id))
    .where(
      and(eq(quoteItems.quoteId, quoteId), isNull(quoteItems.sentOrderItemId)),
    );
  const resolved = await resolveJobOrderItems(
    database,
    list.org,
    list.jobId,
    items,
  );
  for (const item of resolved) {
    const before = items.find((i) => i.id === item.id)!;
    if (
      item.jobListed &&
      (before.supplierPartId !== item.supplierPartId ||
        Number(before.unitCost) !== Number(item.unitCost))
    )
      await database
        .update(quoteItems)
        .set({
          supplierPartId: item.supplierPartId,
          unitCost: item.unitCost,
          updatedAt: new Date(),
        })
        .where(
          and(eq(quoteItems.id, item.id), isNull(quoteItems.sentOrderItemId)),
        );
  }
}

export async function loadJobApprovalSnapshot(
  database: Pick<typeof db, "select">,
  org: string,
  materialListId: string,
  supplierId: string,
) {
  const [list] = await database
    .select({
      id: materialLists.id,
      jobId: materialLists.jobId,
      organizationId: materialLists.organizationId,
      quoteId: materialLists.quoteId,
      kind: materialLists.kind,
    })
    .from(materialLists)
    .where(
      and(
        eq(materialLists.id, materialListId),
        eq(materialLists.organizationId, org),
      ),
    )
    .limit(1);
  if (!list?.quoteId || list.kind === "tools")
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Material list not found.",
    });
  const rows = await database
    .select({
      id: quoteItems.id,
      partDefinitionId: quoteItems.partDefinitionId,
      supplierPartId: quoteItems.supplierPartId,
      selectedSupplierId: quoteItems.supplierId,
      supplierPartSupplierId: supplierParts.supplierId,
      supplierSku: supplierParts.supplierSku,
      unitCost: quoteItems.unitCost,
      quantity: quoteItems.quantity,
      descriptionSnapshot: quoteItems.descriptionSnapshot,
      displayName: partDefinitions.displayName,
      packSize: supplierParts.packSize,
      piecesPerPack: partDefinitions.piecesPerPack,
    })
    .from(quoteItems)
    .leftJoin(supplierParts, eq(quoteItems.supplierPartId, supplierParts.id))
    .leftJoin(
      partDefinitions,
      eq(quoteItems.partDefinitionId, partDefinitions.id),
    )
    .where(
      and(
        eq(quoteItems.quoteId, list.quoteId),
        isNull(quoteItems.sentOrderItemId),
      ),
    );
  const resolved = await resolveJobOrderItems(database, org, list.jobId, rows);
  const { purchaseQuantity } = await import("~/lib/purchase-quantity");
  const items: ApprovalSnapshotItem[] = resolved
    .filter(
      (i) => (i.selectedSupplierId ?? i.supplierPartSupplierId) === supplierId,
    )
    .map((i) => ({
      id: i.id,
      partDefinitionId: i.partDefinitionId,
      supplierPartId: i.supplierPartId,
      supplierSku: i.supplierSku,
      unitCost: i.unitCost,
      quantity: String(
        purchaseQuantity(i.quantity, i.packSize, i.piecesPerPack),
      ),
      requestedQuantity: i.quantity,
      descriptionSnapshot:
        [i.descriptionSnapshot, i.displayName].find((v) => v?.trim())?.trim() ??
        null,
      listed: i.jobListed,
    }));
  if (!items.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No unsent parts remain for this supplier.",
    });
  const scope = {
    organizationId: org,
    jobId: list.jobId,
    materialListId,
    supplierId,
    items,
  };
  return {
    list,
    items,
    approval: await checkJobOrderApproval(database, scope),
  };
}

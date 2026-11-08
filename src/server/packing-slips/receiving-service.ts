import { withSlipTrace } from "./trace";
import { detectSelectedLine } from "./selected-line";
import { extractSlip } from "./extract";
import { readableVersion } from "~/server/documents/service";
import type { SupplierPartLinkConflict } from "~/lib/supplier-part-link";
import { duplicateList } from "./duplicate-list";
import { splitComparisonLines } from "~/lib/receiving-review";
import { randomUUID, createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, sql, desc } from "drizzle-orm";
import { db } from "~/server/db";
import {
  orders,
  packingSlipJobs,
  orderItems,
  partDefinitions,
  supplierParts,
  suppliers,
  catalogs,
  units,
  materialLists,
  quotes,
  quoteItems,
  packingSlipReviewHistory,
  photoAssets,
} from "~/server/db/schema";
import { userCan } from "~/server/auth/permissions";
import {
  documentActor,
  documentMembers,
  type DocumentAccess,
} from "~/server/documents/access";
import { accessibleDocument, folderRole } from "~/server/documents/domain";
import { renameLinkedSlip } from "~/server/documents/packing-slips";
import { mutateWorkspace, readWorkspace } from "~/server/documents/service";
import type { JobDocument } from "~/server/documents/types";
import {
  initialReview,
  autoConfirmsLine,
  normalizeOrderedQuantity,
  defaultReviewUnit,
  lineKind,
  normalizedIdentity,
  receiptDelta,
  qtyRound,
  type ReceivingReview,
  type ReceivingLine,
} from "~/lib/receiving-review";
import {
  receiptUnit,
  convertSlipQuantity,
  MATCH_ISSUE,
} from "~/lib/packing-slip-review";
import { orderFor, orderSnapshot, orderFingerprint } from "./service";
import { matchLines } from "./match";
import { seedPreviousReceipt } from "./review-draft";
import { trialDocument } from "./trial-store";
import { trialDraft, mergeTrialDraft } from "./trial-draft";
import { canCreateFromSlip } from "./receiving-access";
import { catalogueFor, forgetCatalogue } from "./catalogue-match";
import { applyPartFit, orderPartFacts } from "./part-fit";
import {
  publishMaterialListEvent,
  publishOrganizationCatalogueEvent,
} from "~/server/material-list-events";
import type { ReceivingInput } from "./receiving-input";
import { readersInTrial } from "~/lib/packing-slip-trial";
import { comparisonRows } from "./order-comparison";
import { jobOrders } from "./find-order-service";
import { matchConfidence } from "./match-confidence";
import type { RankedOrderMatch, OrderMatchComparison } from "~/lib/order-match-comparison";
import { slipReceipts, type ItemReceipts } from "~/lib/receipt-sources";
import { slipOrderPairs } from "~/lib/slip-order-pairs";
import { allocationOwnershipValid, assertAllocation, hasActiveAllocationDescendant, invalidateResolution, newResolution, pendingOrderResolutions, receivedLineQuantity, resolutionBlockers, resolutionCounterpartFingerprint, resolutionEvidenceFingerprint } from "~/lib/receiving-resolution";
type Tx = Parameters<Parameters<typeof mutateWorkspace>[2]>[3];
const fail = (
  message: string,
  code: "BAD_REQUEST" | "CONFLICT" | "FORBIDDEN" = "BAD_REQUEST",
): never => {
  throw new TRPCError({ code, message });
};
type CorrectionHistory = {
  operation?: string;
  undoable?: boolean;
  before?: ReceivingReview;
  after?: ReceivingReview;
};
const undoActions = new Set(["splitComparison", "resolve", "allocate", "line", "addLine", "detectLine", "ignore", "restoreLine", "orderDisposition", "note"]);
function correctionCanUndo(data: CorrectionHistory, review: ReceivingReview) {
  if (!data.undoable || !data.operation || !undoActions.has(data.operation) || !data.before || data.after?.revision !== review.revision) return false;
  if (JSON.stringify(data.after.lines) !== JSON.stringify(review.lines.map(({ autoConfirmed: _auto, ...line }) => line))) return false;
  if (JSON.stringify(data.after.orderResolutions) !== JSON.stringify(review.orderResolutions)) return false;
  // Undo is a draft operation, never an implicit receipt reversal.
  const approvals = (r: ReceivingReview) => r.lines.filter(l => l.approved).map(l => [l.id, l.approved]);
  return JSON.stringify(approvals(data.before)) === JSON.stringify(approvals(data.after));
}
async function latestCorrectionUndo(access: DocumentAccess, doc: JobDocument, review: ReceivingReview) {
  const [entry] = await db.select({ requestId: packingSlipReviewHistory.runId, data: packingSlipReviewHistory.data }).from(packingSlipReviewHistory).where(and(eq(packingSlipReviewHistory.organizationId, access.job.organizationId), eq(packingSlipReviewHistory.jobId, access.job.id), eq(packingSlipReviewHistory.documentId, doc.id), eq(packingSlipReviewHistory.kind, "confirmation"))).orderBy(desc(packingSlipReviewHistory.createdAt)).limit(1);
  return entry?.requestId && correctionCanUndo(entry.data as CorrectionHistory, review) ? { requestId: entry.requestId, label: (entry.data as CorrectionHistory).operation! } : null;
}
function receiveAccess(access: DocumentAccess) {
  if (!userCan(access.user, "orders.receive"))
    fail("Order receiving permission is required.", "FORBIDDEN");
}
function ensure(doc: JobDocument, userId: string) {
  if (!doc.currentVersionId) fail("This slip has no source file.");
  if (!doc.receivingReview) {
    doc.receivingReview = initialReview(
      doc.packingSlipAnalysis,
      doc.currentVersionId!,
      userId,
    );
    seedPreviousReceipt(doc);
  }
  return doc.receivingReview;
}
/** The slip's date: as reviewed, or as read. */
const slipDate = (doc: JobDocument) =>
  doc.receivingReview?.deliveryDate?.trim()
    ? doc.receivingReview.deliveryDate
    : (doc.packingSlipAnalysis?.cascade?.document?.deliveryDate ?? null);
/** A slip's supplier order and delivery numbers, as reviewed and as read. */
const slipNumbers = (doc: JobDocument) => {
  const r = doc.receivingReview,
    h = doc.packingSlipAnalysis?.cascade?.document;
  return [
    r?.supplierOrderNumber,
    r?.deliveryNumber,
    h?.supplierOrderNumber,
    h?.deliveryNumber,
  ].filter((n): n is string => !!n?.trim());
};
/** Rank the current saved reading locally; no OCR, model call, or write. */
export async function receivingOrderCandidates(
  access: DocumentAccess,
  documentId: string,
): Promise<RankedOrderMatch[]> {
  receiveAccess(access);
  const state = await readWorkspace(access);
  const doc = accessibleDocument(state, documentActor(access, []), documentId);
  const analysis = doc.packingSlipAnalysis;
  if (analysis?.versionId !== doc.currentVersionId) return [];
  const lines = analysis.status === "processing"
    ? analysis.progress?.lines ?? analysis.lines
    : analysis.lines;
  if (!lines.length) return [];
  const orders = await jobOrders(access);
  const review =
    doc.receivingReview?.versionId === doc.currentVersionId
      ? doc.receivingReview
      : undefined;
  // What this slip has already received must not count against its own order.
  const received: Record<string, number> = {};
  for (const line of review?.lines ?? [])
    if (line.approved?.kind === "delivery")
      received[line.approved.itemId] =
        (received[line.approved.itemId] ?? 0) + line.approved.quantity;
  // Only what was read from the slip is evidence. The currently selected
  // order, and the supplier it sets on the review, must not bias its own rank.
  const ranked = matchConfidence(
    {
      lines,
      supplier: analysis.cascade?.document?.supplierName,
      text: review?.sourceText,
      date: slipDate(doc),
      numbers: slipNumbers(doc),
      earlier: state.documents.flatMap((other) =>
        other.id !== doc.id &&
        !other.deletedAt &&
        other.packingSlip?.orderId &&
        (other.receivingReview?.orderConfirmed ||
          other.packingSlipAnalysis?.applied)
          ? [
              {
                orderId: other.packingSlip.orderId,
                numbers: slipNumbers(other),
              },
            ]
          : [],
      ),
      received,
    },
    orders.map((order) => ({ ...order.slip, sentAt: order.option.sentAt })),
  );
  return ranked.slice(0, 5).map((rank) => {
    const order = orders.find((order) => order.option.id === rank.orderId)!.option;
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      supplier: order.supplier,
      listName: order.materialListName,
      sentAt: order.sentAt,
      found: rank.found,
      weak: rank.found < 1,
      confidence: rank.confidence,
      notes: rank.notes,
    };
  });
}

/** Preview only: never links an order, changes quantities, or invokes a reader. */
export async function receivingOrderComparison(
  access: DocumentAccess,
  documentId: string,
  orderId: string,
): Promise<OrderMatchComparison> {
  receiveAccess(access);
  const state = await readWorkspace(access);
  const doc = accessibleDocument(state, documentActor(access, []), documentId);
  const { order, items } = await db.transaction(async (tx) => {
    const order = await orderFor(tx, access, orderId);
    return { order, items: await orderSnapshot(tx, access, order.id) };
  });
  const analysis = doc.packingSlipAnalysis;
  return {
    orderId: order.id,
    orderNumber: order.orderNumber ?? order.id,
    orderDate: order.sentAt?.toISOString() ?? null,
    slipDate: slipDate(doc),
    rows: comparisonRows(
      items,
      analysis?.versionId === doc.currentVersionId
        ? analysis.status === "processing"
          ? (analysis.progress?.lines ?? analysis.lines)
          : analysis.lines
        : [],
    ),
  };
}

export async function receivingQueue(
  access: DocumentAccess,
  documentId?: string,
  query = "",
) {
  receiveAccess(access);
  const state = await readWorkspace(access),
    actor = documentActor(access, []);
  const folder = state.folders.find(
    (f) =>
      f.parentId === null && f.name.toLowerCase().trim() === "packing slips",
  );
  const visible = state.documents.filter(
    (d) =>
      !d.deletedAt &&
      (!!d.packingSlip || d.folderId === folder?.id) &&
      folderRole(state, actor, d.folderId),
  );
  const docs = visible
    .map((d) => {
      const r = d.receivingReview,
        a = d.packingSlipAnalysis;
      const pending = r
        ? r.lines.filter(
            (l) =>
              !l.ignored &&
              (l.approved?.quantity !== receivedLineQuantity(l) ||
                l.approved.kind !== lineKind(l, r.kind) ||
                (!!r.sourceTrial && l.checked !== true)),
          ).length + pendingOrderResolutions(r)
        : null;
      return {
        id: d.id,
        name: d.name,
        createdAt: d.createdAt,
        createdBy: d.createdBy,
        order: d.packingSlip,
        hasSuggestedOrder:
          !r?.orderConfirmed &&
          !r?.retiredBy &&
          r?.duplicateDecision?.action !== "supporting" &&
          (!!d.packingSlip || !!a?.orderCandidates?.length),
        status: r?.retiredBy
          ? "replaced"
          : r?.duplicateDecision?.action === "supporting"
            ? "supporting"
            : a?.status === "processing"
              ? "processing"
              : r &&
                  pending === 0 &&
                  r.lines.length > 0 &&
                  r.documentChecked &&
                  r.orderConfirmed &&
                  r.versionId === d.currentVersionId
                ? "complete"
                : a?.applied && !r
                  ? "complete"
                  : "review",
        pending,
        approved:
          r?.lines.filter((l) => l.approved).length ??
          (a?.applied ? Object.keys(a.applied.quantities).length : 0),
        reviewTrialRunId: r?.sourceTrial?.runId,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!documentId) return { documents: docs };
  const doc = accessibleDocument(state, actor, documentId),
    review = ensure(doc, access.user.id);
  const linked = doc.packingSlip
    ? await orderSnapshot(db, access, doc.packingSlip.orderId)
    : [];
  for (const line of review.lines) {
    defaultReviewUnit(
      line,
      linked.find((i) => i.id === line.orderItemId)?.unit,
    );
    const analysis = doc.packingSlipAnalysis;
    if (
      review.versionId === doc.currentVersionId &&
      analysis?.versionId === doc.currentVersionId &&
      review.analysisRunId === analysis?.runId &&
      line.sourceIndex !== undefined
    )
      normalizeOrderedQuantity(
        line,
        analysis?.lines[line.sourceIndex],
        linked.find(i => i.id === line.orderItemId),
      );
    line.autoConfirmed = autoConfirmsLine(
      line,
      review,
      doc.packingSlipAnalysis,
      doc.currentVersionId,
      linked,
    );
  }
  const [
    supplierOptions,
    catalogOptions,
    unitOptions,
    listOptions,
    orderOptions,
    mayCreate,
    members,
    orderParts,
  ] = await Promise.all([
    db
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(
        and(
          eq(suppliers.organizationId, access.job.organizationId),
          eq(suppliers.kind, "external"),
        ),
      )
      .orderBy(suppliers.name),
    db
      .select({ id: catalogs.id, name: catalogs.name })
      .from(catalogs)
      .where(
        and(
          eq(catalogs.organizationId, access.job.organizationId),
          eq(catalogs.kind, "materials"),
        ),
      ),
    db.select({ id: units.id, code: units.code }).from(units),
    db
      .select({ id: materialLists.id, name: materialLists.name })
      .from(materialLists)
      .where(
        and(
          eq(materialLists.organizationId, access.job.organizationId),
          eq(materialLists.jobId, access.job.id),
          eq(materialLists.kind, "materials"),
        ),
      ),
    db
      .select({
        id: orders.id,
        name: orders.orderNumber,
        supplierId: orders.supplierId,
        listId: orders.materialListId,
      })
      .from(orders)
      .where(
        and(
          eq(orders.organizationId, access.job.organizationId),
          eq(orders.jobId, access.job.id),
          sql`${orders.status} not in ('draft','cancelled')`,
          sql`coalesce(${orders.fulfillmentStatus},'') <> 'cancelled'`,
        ),
      )
      .orderBy(desc(orders.createdAt)),
    canCreateFromSlip(access, db),
    documentMembers(access),
    doc.packingSlip
      ? orderPartFacts(db, access, doc.packingSlip.orderId)
      : Promise.resolve<Awaited<ReturnType<typeof orderPartFacts>>>({}),
  ]);
  // Likely catalogue parts for lines not on the order: a reviewer who may add
  // parts can put them on the material list, and one that is the part of an
  // order line no slip has is paired with it. Also the typed search.
  const searching = query.trim().length >= 2,
    unmatched =
      doc.packingSlip && (mayCreate || Object.keys(orderParts).length)
        ? review.lines.filter(
            (l) => !l.ignored && !l.approved && !l.orderItemId,
          )
        : [];
  const catalogue =
    searching || unmatched.length
      ? await catalogueFor(
          db,
          access.job.organizationId,
          doc.packingSlip
            ? (orderOptions.find((o) => o.id === doc.packingSlip!.orderId)
                ?.supplierId ?? null)
            : review.supplierId,
        )
      : null;
  const parts = searching
    ? catalogue!(
        { code: "", text: query.trim() },
        { limit: 50, min: 0.15, typed: true },
      )
    : [];
  const likely = Object.fromEntries(
    unmatched.map((l) => {
      const ranked = catalogue!({ code: l.sku, text: l.description }),
        chosen = l.partId ? catalogue!.part(l.partId) : undefined;
      return [
        l.id,
        chosen
          ? [chosen, ...ranked.filter((p) => p.id !== chosen.id)].slice(0, 3)
          : ranked,
      ];
    }),
  );
  const pairs = slipOrderPairs(
    review.lines,
    likely,
    orderParts,
    [...slipReceipts(state.documents)]
      .filter(([, r]) => r.some((x) => x.documentId !== doc.id))
      .map(([id]) => id),
  );
  const photoSuggestions =
    query.trim().length >= 2
      ? await import("~/server/api/routers/catalogue")
          .then((m) =>
            m.getPartImageFamilySuggestionsForSource({
              db,
              organizationId: access.job.organizationId,
              mode: "get",
              sourcePart: {
                displayName: query,
                description: query,
                categoryName: null,
                materialId: undefined,
                materialName: null,
              },
            }),
          )
          .then((r) => r.suggestions.slice(0, 8))
          .catch(() => [])
      : [];
  const [processingJob] = doc.packingSlipAnalysis
    ? await db
        .select({
          status: packingSlipJobs.status,
          updatedAt: packingSlipJobs.updatedAt,
          leaseUntil: packingSlipJobs.leaseUntil,
        })
        .from(packingSlipJobs)
        .where(
          and(
            eq(packingSlipJobs.id, doc.packingSlipAnalysis.runId),
            eq(packingSlipJobs.organizationId, access.job.organizationId),
            eq(packingSlipJobs.documentId, doc.id),
          ),
        )
        .limit(1)
    : [];
  const duplicates = duplicateList(state, doc).map((d) => {
    const other = state.documents.find((v) => v.id === d.id)!;
    const accessible = !!folderRole(state, actor, other.folderId);
    return {
      ...d,
      name: accessible ? d.name : "Another saved slip",
      unavailable: !accessible
        ? "You do not have access to this earlier slip. Ask a job administrator to review the duplicate."
        : other.deletedAt
          ? "This earlier slip is in the recycle bin and has recorded receipts. Restore it in Documents to compare or resolve the duplicate."
          : null,
    };
  });
  // Where each item's received count came from: the slips that received it,
  // and what was counted by hand on the order.
  const fromSlips = slipReceipts(state.documents);
  const receipts: Record<string, ItemReceipts> = {};
  for (const item of linked) {
    const slips = (fromSlips.get(item.id) ?? []).map((r) => {
      const other = state.documents.find((d) => d.id === r.documentId);
      return {
        ...r,
        name:
          r.documentId === doc.id
            ? doc.name
            : other?.deletedAt
              ? "A deleted slip"
              : visible.some((v) => v.id === r.documentId)
                ? other!.name
                : "Another saved slip",
        by: members.find((m) => m.id === r.by)?.name ?? "Organization member",
        self: r.documentId === doc.id,
      };
    });
    const byHand = qtyRound(
      item.received - slips.reduce((n, r) => n + r.quantity, 0),
    );
    if (slips.length || byHand > 0)
      receipts[item.id] = { slips, byHand: Math.max(0, byHand) };
  }
  // Supplier suggestion is never used as an approval.
  if (!review.supplierId && doc.packingSlip) {
    const order = orderOptions.find((o) => o.id === doc.packingSlip!.orderId);
    if (order?.supplierId) {
      review.supplierId = order.supplierId;
      review.supplierName =
        supplierOptions.find((s) => s.id === order.supplierId)?.name ?? "";
    }
  }
  return {
    documents: docs,
    processingJob: processingJob ?? null,
    document: doc,
    canDeleteDocument: access.canWrite && folderRole(state, actor, doc.folderId) !== "viewer" && (!doc.lockedBy || doc.lockedBy === actor.userId),
    review,
    items: linked,
    fingerprint: orderFingerprint(linked),
    duplicates,
    receipts,
    suppliers: supplierOptions,
    catalogs: catalogOptions,
    units: unitOptions,
    lists: listOptions,
    orders: orderOptions,
    parts,
    likely: mayCreate ? likely : {},
    /** Order items that slip lines the matcher missed are likely to be. */
    pairs,
    photoSuggestions,
    canCreate: mayCreate,
    /** The catalogue part behind each order item, for fixes a slip suggests. */
    orderParts,
    canRemoveOrderItems: userCan(access.user, "orders.send"),
    canEditParts: userCan(access.user, "parts.edit") || mayCreate,
    canAcceptSubstitution: userCan(access.user, "orders.send"),
    correctionUndo: await latestCorrectionUndo(access, doc, review),
    scannedBy:
      members.find((m) => m.id === doc.createdBy)?.name ??
      "Organization member",
    /** Who wrote each line's note. */
    noteAuthors: Object.fromEntries(
      review.lines.flatMap((l) =>
        l.note
          ? [[l.note.by, members.find((m) => m.id === l.note!.by)?.name ?? "Organization member"]]
          : [],
      ),
    ),
    sourceMimeType:
      state.versions.find((v) => v.id === doc.currentVersionId)?.mimeType ??
      "application/pdf",
    sourceUrl: `/api/job-documents/files/${doc.currentVersionId}?jobId=${access.job.id}`,
  };
}
async function history(
  tx: Tx,
  access: DocumentAccess,
  doc: JobDocument,
  requestId: string,
  input: ReceivingInput,
  before: ReceivingReview,
  replacedDocument?: {
    id: string;
    before: ReceivingReview;
    after: ReceivingReview;
  },
  developmentImport = false,
  removedOrderItem?: typeof orderItems.$inferSelect,
) {
  const review = doc.receivingReview!;
  const applied = review.lines.filter(
    (l) => l.approved && l.approved.quantity > 0 && !l.ignored,
  );
  const confirmedAnalysis = {
    lines: applied.map((l) => ({
      orderItemId: l.approved!.itemId,
      sku: l.sku,
      proposed: l.approved!.quantity,
      linked: "user",
    })),
    applied: {
      quantities: Object.fromEntries(
        [...new Set(applied.map((l) => l.approved!.itemId))].map((id) => [
          id,
          applied
            .filter((l) => l.approved!.itemId === id)
            .reduce((n, l) => n + receiptDelta(l.approved!.kind, l.approved!.quantity).received, 0),
        ]),
      ),
    },
  };
  await tx.insert(packingSlipReviewHistory).values({
    organizationId: access.job.organizationId,
    jobId: access.job.id,
    documentId: doc.id,
    versionId: review.versionId,
    runId: requestId,
    kind: developmentImport ? "analysis" : "confirmation",
    userId: access.user.id,
    release: process.env.NEXT_PUBLIC_APP_RELEASE ?? "unknown",
    data: {
      schemaVersion: 2,
      operation: developmentImport ? "trial-import" : input.action,
      undoable: !developmentImport && undoActions.has(input.action) && !(input.action === "line" && input.fit),
      initiator: developmentImport ? "development-trial" : "human",
      targetLineId: "lineId" in input ? input.lineId : undefined,
      targetLineIds: "lineIds" in input ? input.lineIds : undefined,
      targetItemId: "itemId" in input ? input.itemId : undefined,
      reason: "reason" in input ? input.reason : undefined,
      undoesRequestId: input.action === "undoCorrection" ? input.requestIdToUndo : undefined,
      requestHash: createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex"),
      packingSlip: doc.packingSlip,
      before,
      after: review,
      replacedDocument,
      removedOrderItem,
      confirmedAnalysis:
        input.action === "approve" ? confirmedAnalysis : undefined,
      source: doc.currentVersionId,
    },
  });
}
/** Fixing a part's pack size or supplier code from a slip: anyone who may
 * edit parts, or add them from a slip. */
const canEditParts = async (
  access: DocumentAccess,
  reader: Pick<Tx, "select">,
) => userCan(access.user, "parts.edit") || canCreateFromSlip(access, reader);
async function requireCreate(access: DocumentAccess, tx: Tx) {
  if (!(await canCreateFromSlip(access, tx)))
    fail(
      "An executive, the foreman or a lead hand must approve new parts, suppliers and reconstructed orders.",
      "FORBIDDEN",
    );
}
async function scopedSupplier(
  tx: Tx,
  access: DocumentAccess,
  id: string | null,
) {
  if (!id) fail("Choose or create the supplier first.");
  const [s] = await tx
    .select()
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, id!),
        eq(suppliers.organizationId, access.job.organizationId),
        eq(suppliers.kind, "external"),
      ),
    )
    .limit(1);
  if (!s) fail("Supplier is unavailable.");
  return s!;
}
export class SupplierPartLinkConflictError extends TRPCError {
  constructor(readonly linkConflict: SupplierPartLinkConflict) {
    super({ code: "CONFLICT", message: "This supplier code is linked to a different catalogue part." });
  }
}
async function addOrderLine(
  tx: Tx,
  access: DocumentAccess,
  doc: JobDocument,
  line: ReceivingLine,
  order: typeof orders.$inferSelect,
  quoteId: string,
  input: ReceivingInput,
) {
  if (!line.partId || line.ordered === null || line.ordered <= 0)
    fail("Choose a catalogue part and confirm the ordered quantity first.");
  const [part] = await tx
    .select()
    .from(partDefinitions)
    .where(
      and(
        eq(partDefinitions.id, line.partId!),
        eq(partDefinitions.organizationId, access.job.organizationId),
        eq(partDefinitions.isActive, true),
        sql`exists (select 1 from ${catalogs} where ${catalogs.id}=${partDefinitions.catalogId} and ${catalogs.kind}='materials')`,
      ),
    )
    .limit(1);
  if (!part) fail("The catalogue part is unavailable.");
  // An unread unit is the part's own, unless the part comes in packs.
  if (
    !receiptUnit(line.unit) &&
    !(part!.piecesPerPack && part!.piecesPerPack > 1) &&
    part!.bulkUnit
  )
    line.unit = part!.bulkUnit;
  const unit = receiptUnit(line.unit);
  if (
    part!.piecesPerPack &&
    part!.piecesPerPack > 1 &&
    unit !== receiptUnit(part!.bulkUnit ?? "pack")
  )
    fail(
      `Confirm whether the slip quantity is in ${part!.bulkUnit ?? "pack"} or ${part!.individualUnit ?? "individual pieces"} before adding this part.`,
    );
  if (!unit) fail("Confirm the quantity unit.");
  const unitRows = await tx.select().from(units);
  const uom = unitRows.find((u) => receiptUnit(u.code) === unit);
  if (!uom) fail("Choose a supported unit.");
  const existing = line.sku
    ? await tx
        .select()
        .from(supplierParts)
        .where(
          and(
            eq(supplierParts.organizationId, access.job.organizationId),
            eq(supplierParts.supplierId, order.supplierId!),
            eq(supplierParts.supplierSku, line.sku),
          ),
        )
        .limit(1)
        .for("update")
    : [];
  let listing = existing[0];
  if (listing && listing.partDefinitionId !== part!.id) {
    const replacementPartId = input.action === "part" && !input.partId ? null : part!.id;
    const approved = input.supplierPartLinkApprovals?.some(a =>
      a.lineId === line.id && a.supplierPartId === listing!.id &&
      a.previousPartId === listing!.partDefinitionId &&
      a.replacementPartId === replacementPartId && a.replacementPartName === part!.displayName);
    if (!approved) {
      const [previous] = await tx.select({ name: partDefinitions.displayName }).from(partDefinitions)
        .where(eq(partDefinitions.id, listing.partDefinitionId)).limit(1);
      const supplier = await scopedSupplier(tx, access, order.supplierId);
      throw new SupplierPartLinkConflictError({
        lineId: line.id, supplierPartId: listing.id, previousPartId: listing.partDefinitionId,
        replacementPartId, replacementPartName: part!.displayName,
        supplierName: supplier.name, supplierCode: line.sku, previousPartName: previous?.name ?? "Previous catalogue part",
      });
    }
    [listing] = await tx.update(supplierParts).set({ partDefinitionId: part!.id })
      .where(and(eq(supplierParts.id, listing.id), eq(supplierParts.organizationId, access.job.organizationId)))
      .returning();
  }
  if (!listing) {
    [listing] = await tx
      .insert(supplierParts)
      .values({
        organizationId: access.job.organizationId,
        supplierId: order.supplierId!,
        partDefinitionId: part!.id,
        supplierSku: line.sku || null,
        supplierName: line.description,
      })
      .returning();
  }
  const [item] = await tx
    .insert(orderItems)
    .values({
      orderId: order.id,
      partDefinitionId: part!.id,
      supplierPartId: listing!.id,
      quantity: String(line.ordered),
      requestedQuantity: doc.packingSlip ? "0" : String(line.ordered),
      uomId: uom!.id,
      unitCostAtOrderTime:
        line.unitPrice === null ? null : String(line.unitPrice),
      priceStatusSnapshot: line.unitPrice === null ? "none" : "confirmed",
      priceBookNameSnapshot: "Packing slip · this job",
      descriptionSnapshot: part!.displayName,
      supplierSkuSnapshot: line.sku || null,
      notes: `Reconstructed from packing slip ${doc.id}; approved by ${access.user.id}.`,
    })
    .returning();
  await tx.insert(quoteItems).values({
    quoteId,
    sentOrderItemId: item!.id,
    partDefinitionId: part!.id,
    supplierPartId: listing!.id,
    supplierId: order.supplierId,
    quantity: String(line.ordered),
    uomId: uom!.id,
    unitCost: line.unitPrice === null ? null : String(line.unitPrice),
    unitPrice: line.unitPrice === null ? null : String(line.unitPrice),
    extendedPrice:
      line.unitPrice === null
        ? null
        : (line.ordered! * line.unitPrice).toFixed(2),
    descriptionSnapshot: part!.displayName,
    addedByUserId: access.user.id,
  });
  const [subtotal] = await tx
    .select({
      value: sql<string>`coalesce(sum(${quoteItems.extendedPrice}),0)::text`,
    })
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quoteId));
  await tx
    .update(quotes)
    .set({
      subtotalMaterials: subtotal!.value,
      total: sql`${subtotal!.value}::numeric*(1+coalesce(${quotes.markupPercent},0)/100)`,
    })
    .where(eq(quotes.id, quoteId));
  line.orderItemId = item!.id;
  line.unit =
    part!.piecesPerPack && part!.piecesPerPack > 1
      ? (part!.bulkUnit ?? line.unit)
      : line.unit;
  // Price stays on the order/list in this job, never supplierParts.lastKnownUnitCost.
  return item!;
}
export async function mutateReceiving(
  access: DocumentAccess,
  input: ReceivingInput,
) {
  if (input.action !== "detectLine") return mutateReceivingImpl(access, input, false);
  receiveAccess(access);
  const current = await receivingQueue(access, input.documentId);
  if (!("review" in current) || !current.review || !current.document || current.review.revision !== input.revision || current.document.currentVersionId !== input.versionId)
    fail("The review changed. Reload before selecting a line.", "CONFLICT");
  const doc = current.document!;
  const item = current.items?.find(i => i.id === input.itemId);
  if (!item || !doc.packingSlip || !current.review!.orderConfirmed) fail("Confirm the order first.");
  if (current.review!.lines.some(l => l.orderItemId === input.itemId && !l.ignored)) fail("This item already has a linked line.", "CONFLICT");
  if (current.review!.lines.some(l => {
    const box = l.sourceBox;
    if (l.ignored || l.page !== input.page || !box) return false;
    const overlap = Math.min(box.y + box.height, input.sourceBox.y + input.sourceBox.height) - Math.max(box.y, input.sourceBox.y);
    return overlap > Math.min(box.height, input.sourceBox.height) * 0.5;
  })) fail("That area already belongs to a slip line. Move the existing slip card to this item instead.", "CONFLICT");
  const { version } = await readableVersion(access, input.versionId);
  const extracted = await extractSlip(access.job.organizationId, version.sha256, version.mimeType);
  const detected = await withSlipTrace(access.job.organizationId, input.requestId, () => detectSelectedLine(extracted.pages, input.page, input.sourceBox, doc.packingSlip!.orderId, item!));
  return mutateReceivingImpl(access, input, false, detected);
}

/** Development-only ingestion. Not exposed as an API action or human approval. */
export async function importTrialReview(
  access: DocumentAccess,
  input: Extract<ReceivingInput, { action: "trialDraft" }>,
) {
  return mutateReceivingImpl(access, input, true);
}

async function mutateReceivingImpl(
  access: DocumentAccess,
  input: ReceivingInput,
  developmentImport: boolean,
  detected?: Awaited<ReturnType<typeof detectSelectedLine>>,
) {
  receiveAccess(access);
  const result = await mutateWorkspace(
    access.user.id,
    access.job.id,
    async (state, actor, fresh, tx) => {
      receiveAccess(fresh);
      const doc = accessibleDocument(
        state,
        { ...actor, canWrite: true },
        input.documentId,
        { write: true },
      );
      if (developmentImport) {
        if (input.action !== "trialDraft")
          return fail("Only trial drafts can be imported.");
        const saved = doc.receivingReview;
        if (
          doc.packingSlipAnalysis?.applied ||
          saved?.retiredBy ||
          saved?.humanReviewed ||
          saved?.orderConfirmed ||
          saved?.documentChecked ||
          saved?.duplicateDecision ||
          saved?.lines.some(
            (l) =>
              !!l.approved ||
              l.checked === true ||
              l.humanEdited === true ||
              !!l.ignored ||
              !!l.partId ||
              !!l.note,
          )
        )
          return {
            replayed: false,
            skipped: "Saved human decisions were preserved.",
            materialListId: undefined,
          };
        if (
          saved?.sourceTrial?.runId === input.runId &&
          saved?.sourceTrial?.reader === input.reader
        )
          return {
            replayed: true,
            skipped: "This trial draft is already imported.",
            materialListId: undefined,
          };
      }
      const review = ensure(doc, fresh.user.id);
      const [prior] = await tx
        .select({
          data: packingSlipReviewHistory.data,
          documentId: packingSlipReviewHistory.documentId,
          jobId: packingSlipReviewHistory.jobId,
        })
        .from(packingSlipReviewHistory)
        .where(
          and(
            eq(
              packingSlipReviewHistory.organizationId,
              fresh.job.organizationId,
            ),
            eq(packingSlipReviewHistory.runId, input.requestId),
            eq(
              packingSlipReviewHistory.kind,
              developmentImport ? "analysis" : "confirmation",
            ),
          ),
        )
        .limit(1);
      if (prior) {
        const h = prior.data as { requestHash?: string };
        if (
          prior.jobId !== fresh.job.id ||
          prior.documentId !== doc.id ||
          h.requestHash !==
            createHash("sha256").update(JSON.stringify(input)).digest("hex")
        )
          fail(
            "This request ID was already used for another operation.",
            "CONFLICT",
          );
        return {
          replayed: true,
          materialListId: doc.packingSlip?.materialListId,
        };
      }
      if (review.revision !== input.revision)
        fail(
          "Someone changed this review. Reload it before continuing.",
          "CONFLICT",
        );
      if (review.retiredBy)
        fail("This slip was replaced. Open its replacement.", "CONFLICT");
      if (
        input.action !== "adoptSource" &&
        review.versionId !== doc.currentVersionId
      )
        fail(
          "The source file changed. Review the new version before approving.",
          "CONFLICT",
        );
      let removedOrderItem: typeof orderItems.$inferSelect | undefined;
      let replacedDocument:
        | { id: string; before: ReceivingReview; after: ReceivingReview }
        | undefined;
      const before = structuredClone(review),
        now = new Date().toISOString();
      const lineFor = (id: string) => {
        const l = review.lines.find((l) => l.id === id);
        if (!l) fail("Slip line no longer exists.", "CONFLICT");
        return l!;
      };
      const capturePaper = (line: ReceivingLine) => {
        if (line.paper) return;
        const source = review.versionId === doc.packingSlipAnalysis?.versionId && review.analysisRunId === doc.packingSlipAnalysis?.runId && line.sourceIndex !== undefined ? doc.packingSlipAnalysis.lines[line.sourceIndex] : undefined;
        line.paper = source
          ? { quantity: source.shipped, ordered: source.ordered ?? null, unit: source.unit ?? "", description: source.description ?? line.description, sku: source.sku ?? "" }
          : { quantity: line.quantity, ordered: line.ordered, unit: line.unit, description: line.description, sku: line.sku };
      };
      // Puts a slip line's catalogue part on the linked order and its
      // material list.
      const addToOrder = async (l: ReceivingLine) => {
        if (!doc.packingSlip) fail("Choose an order first.");
        if (l.orderItemId || l.approved)
          fail("This line already belongs to the order.");
        const order = await orderFor(tx, fresh, doc.packingSlip!.orderId);
        await scopedSupplier(tx, fresh, order.supplierId);
        const [list] = await tx
          .select()
          .from(materialLists)
          .where(eq(materialLists.id, order.materialListId!))
          .for("update");
        if (!list?.quoteId) fail("The material list has no item container.");
        // When the ordered count was not read, the order asked for what came.
        if (l.ordered === null && l.quantity !== null && l.quantity > 0)
          l.ordered = l.quantity;
        await addOrderLine(tx, fresh, doc, l, order, list!.quoteId!, input);
      };
      if (input.action === "orderDisposition") {
        if (!doc.packingSlip) fail("Choose an order first.");
        const items = await orderSnapshot(tx, fresh, doc.packingSlip!.orderId);
        if (!items.some(i => i.id === input.itemId)) fail("Choose an item on this job’s linked order.");
        if (review.lines.some(l => !l.ignored && l.orderItemId === input.itemId)) fail("This item has a linked slip line. Resolve the linked line instead.");
        if (input.disposition === "cancel-requested" && input.note.trim().length < 3) fail("Explain the cancellation request. The order is unchanged until an authorized correction.");
        review.orderResolutions ??= {};
        review.orderResolutions[input.itemId] = { disposition: input.disposition, note: input.note, by: fresh.user.id, at: now };
        review.documentChecked = false;
      } else if (input.action === "note") {
        // Words only: a note never confirms, clears or reopens a check.
        const line = lineFor(input.lineId);
        if (input.note) line.note = { text: input.note, by: fresh.user.id, at: now };
        else delete line.note;
      } else if (input.action === "resolve") {
        const line = lineFor(input.lineId);
        if (line.ignored) fail("Restore this excluded line before resolving it.");
        if (input.evidenceFingerprint !== resolutionEvidenceFingerprint(line)) fail("This line changed. Reload its evidence before resolving.", "CONFLICT");
        if (input.specification === "substitution-accepted" && !userCan(fresh.user, "orders.send")) fail("Order permission is required to accept a substitute.", "FORBIDDEN");
        if (input.match === "confirmed" && !line.orderItemId) fail("Choose an order item before confirming the match.");
        const items = doc.packingSlip ? await orderSnapshot(tx, fresh, doc.packingSlip.orderId) : [];
        const counterpart = items.find(item => item.id === line.orderItemId);
        if (line.orderItemId && !counterpart) fail("The matching item is no longer on this order.", "CONFLICT");
        const counterpartFingerprint = counterpart ? resolutionCounterpartFingerprint(counterpart) : undefined;
        if (input.counterpartFingerprint !== undefined && input.counterpartFingerprint !== (counterpartFingerprint ?? null)) fail("The order item or package changed while this line was open. Reload its details before confirming.", "CONFLICT");
        capturePaper(line);
        const previous = line.resolution?.evidenceFingerprint === input.evidenceFingerprint && line.resolution?.counterpartFingerprint === counterpartFingerprint ? line.resolution : newResolution(line, fresh.user.id, now);
        line.resolution = { ...previous, counterpartFingerprint, by: fresh.user.id, at: now };
        for (const key of ["materialIssue", "match", "specification", "quantity", "delivery", "siteQuantity", "acceptedQuantity", "remainder", "excess", "skipped", "note"] as const) {
          if (input[key] !== undefined) Object.assign(line.resolution, { [key]: input[key] });
        }
        const r = line.resolution;
        if (r.acceptedQuantity != null && r.siteQuantity == null) fail("Record the actual site count before the accepted quantity.");
        if (r.acceptedQuantity != null && r.siteQuantity != null && r.acceptedQuantity > r.siteQuantity) fail("Accepted quantity cannot exceed the actual site count.");
        line.humanEdited = true;
        line.checked = resolutionBlockers(line).length === 0;
        review.documentChecked = false;
      } else if (input.action === "splitComparison") {
        const lines = [...new Set(input.lineIds)].map(lineFor);
        for (const line of lines) capturePaper(line);
        try { splitComparisonLines(lines); } catch (error) { fail(error instanceof Error ? error.message : "Cannot split this comparison."); }
        review.documentChecked = false;
      } else if (input.action === "allocate") {
        const sources = input.lineIds.map(lineFor);
        try { assertAllocation(sources, input.outputs, review.kind); } catch (error) { fail(error instanceof Error ? error.message : "Invalid allocation."); }
        if (review.lines.length + input.outputs.length > 200) fail("This review has reached the 200-line limit.");
        if (!doc.packingSlip) fail("Choose an order first.");
        const items = await orderSnapshot(tx, fresh, doc.packingSlip!.orderId);
        for (const output of input.outputs) {
          if (!output.orderItemId) continue;
          const item = items.find(i => i.id === output.orderItemId);
          if (!item) fail("Choose an item on this job’s linked order.");
          if (receiptUnit(item!.unit) !== receiptUnit(output.unit)) fail(`Allocate this item in ${item!.unit}. Convert the source first.`);
        }
        for (const source of sources) {
          capturePaper(source);
          source.ignored = { reason: `Allocated into corrected lines: ${input.reason}`, by: fresh.user.id, at: now };
          source.allocatedTo = input.requestId;
        }
        const first = sources[0]!;
        for (const output of input.outputs) {
          const line: ReceivingLine = { id: randomUUID(), page: first.page, sourceBox: sources.length === 1 ? first.sourceBox : undefined, evidence: sources.map(l => l.evidence).join("\n"), description: output.description, sku: output.sku, quantity: output.quantity, ordered: null, unit: output.unit, unitPrice: null, orderItemId: output.orderItemId, kind: first.kind, issues: ["Reviewer allocation: confirm specification, quantity and actual delivery."], humanEdited: true, checked: false, allocation: { sourceLineIds: sources.map(l => l.id), operationId: input.requestId } };
          line.resolution = newResolution(line, fresh.user.id, now);
          line.resolution.note = input.reason;
          review.lines.push(line);
          if (line.orderItemId && review.orderResolutions) delete review.orderResolutions[line.orderItemId];
        }
        review.documentChecked = false;
      } else if (input.action === "undoCorrection") {
        const [entry] = await tx.select({ data: packingSlipReviewHistory.data }).from(packingSlipReviewHistory).where(and(eq(packingSlipReviewHistory.organizationId, fresh.job.organizationId), eq(packingSlipReviewHistory.jobId, fresh.job.id), eq(packingSlipReviewHistory.documentId, doc.id), eq(packingSlipReviewHistory.runId, input.requestIdToUndo), eq(packingSlipReviewHistory.kind, "confirmation"))).limit(1);
        const data = entry?.data as CorrectionHistory | undefined;
        if (!data || !correctionCanUndo(data, review)) fail("This correction can no longer be undone safely. Reload the review; later decisions and approved receipts are preserved.", "CONFLICT");
        review.lines = structuredClone(data!.before!.lines);
        if (data!.before!.orderResolutions) review.orderResolutions = structuredClone(data!.before!.orderResolutions);
        else delete review.orderResolutions;
        review.documentChecked = false;
      } else if (input.action === "trialDraft") {
        const trial = await trialDocument(fresh, doc.id, input.runId, state);
        if (!trial || trial.stale)
          fail(
            "This comparison is not for the current source file.",
            "CONFLICT",
          );
        if (
          developmentImport &&
          readersInTrial(trial!.entry?.readers).some(
            (r) => trial!.results[r]?.status !== "complete",
          )
        )
          fail(
            "All readers in this trial must finish before importing the trial draft.",
            "CONFLICT",
          );
        const prediction = trial!.results[input.reader];
        if (prediction?.status !== "complete")
          fail("This reader has not completed the slip.");
        const chosenOrderId = doc.packingSlip?.orderId ?? prediction!.orderId;
        const order = chosenOrderId
          ? await orderFor(tx, fresh, chosenOrderId)
          : null;
        if (order && !doc.packingSlip) {
          const [list] = await tx
            .select()
            .from(materialLists)
            .where(
              and(
                eq(materialLists.id, order.materialListId!),
                eq(materialLists.jobId, fresh.job.id),
                eq(materialLists.organizationId, fresh.job.organizationId),
              ),
            )
            .limit(1);
          if (!list) fail("Material list unavailable.");
          doc.packingSlip = {
            orderId: order.id,
            orderNumber: order.orderNumber ?? order.id,
            materialListId: list!.id,
            materialListName: list!.name,
          };
        }
        const items = order ? await orderSnapshot(tx, fresh, order.id) : [];
        const prepared = trialDraft({
          results: trial!.results,
          reader: input.reader,
          runId: trial!.runId,
          versionId: doc.currentVersionId!,
          userId: fresh.user.id,
          items,
        });
        prepared.review.supplierId = order?.supplierId ?? null;
        if (prediction!.orderId && order && prediction!.orderId !== order.id)
          prepared.review.warnings.push(
            "This reader suggests a different order. The existing link was preserved; resolve the order before approving.",
          );
        const revision = review.revision;
        const merged = mergeTrialDraft(review, prepared.review);
        Object.assign(review, merged, {
          revision,
          sourceTrial: prepared.review.sourceTrial,
        });
        doc.packingSlipAnalysis = {
          ...prepared.analysis,
          applied: doc.packingSlipAnalysis?.applied,
          confirmedItems: doc.packingSlipAnalysis?.confirmedItems,
        };
      } else if (input.action === "reopen") {
        delete review.duplicateDecision;
        delete review.duplicateChecked;
        review.documentChecked = false;
      } else if (input.action === "restoreLine") {
        const l = lineFor(input.lineId);
        if (hasActiveAllocationDescendant(review.lines, l.id)) fail("Undo the allocation before restoring its source line. The same printed quantity cannot be received twice.");
        if (!allocationOwnershipValid(review.lines, l)) fail("This allocation was replaced or its source was restored. Restore the current allocation instead of receiving the same source twice.");
        delete l.ignored;
        delete l.allocatedTo;
        l.checked = false;
        l.humanEdited = true;
        review.documentChecked = false;
      } else if (input.action === "adoptSource") {
        if (
          doc.packingSlipAnalysis?.versionId !== doc.currentVersionId ||
          doc.packingSlipAnalysis?.status !== "ready"
        )
          fail("Read the current source before adopting it.");
        review.versionId = doc.currentVersionId!;
        review.orderConfirmed = false;
        review.documentChecked = false;
        review.warnings.push(
          "Source replaced. Check every page against the preserved receipt and correct any changed quantities explicitly.",
        );
        for (const l of review.lines) {
          l.checked = false;
          delete l.sourceIndex;
          delete l.sourceBox;
          l.evidence =
            "Preserved from the prior source. Compare with the current document.";
        }
      } else if (input.action === "header") {
        if (input.supplierId) await scopedSupplier(tx, fresh, input.supplierId);
        Object.assign(review, {
          kind: input.kind,
          kindConfirmed: true,
          documentChecked: input.documentChecked,
          supplierId: input.supplierId,
          supplierName: input.supplierName,
          deliveryNumber: input.deliveryNumber,
          supplierOrderNumber: input.supplierOrderNumber,
          deliveryDate: input.deliveryDate,
          orderConfirmed: !!doc.packingSlip,
        });
        if (before.kind !== input.kind) for (const line of review.lines) if (!line.kind) invalidateResolution(line);
        if (
          before.supplierId !== input.supplierId ||
          before.deliveryNumber !== input.deliveryNumber
        ) {
          delete review.duplicateDecision;
          delete review.duplicateChecked;
        }
      } else if (input.action === "line") {
        const l = lineFor(input.lineId);
        capturePaper(l);
        const previousEvidence = resolutionEvidenceFingerprint(l);
        if (l.ignored) fail("This line has already been excluded.");
        if (l.approved && input.orderItemId !== l.approved.itemId)
          fail(
            "An approved line cannot be moved to another product. Correct its quantity to zero, then add the correct line.",
          );
        let quantityUnit = input.unit;
        if (input.orderItemId) {
          if (!doc.packingSlip) fail("Choose an order first.");
          const items = await orderSnapshot(
            tx,
            fresh,
            doc.packingSlip!.orderId,
          );
          const item = items.find((i) => i.id === input.orderItemId);
          if (!item) fail("Choose a line on this job’s linked order.");
          quantityUnit = input.unit.trim() || item!.unit;
          if (receiptUnit(quantityUnit) !== receiptUnit(item!.unit))
            fail(
              `Enter the quantity in ${item!.unit}, the order’s unit. Convert packs or lengths explicitly.`,
            );
          if (input.fit) {
            if (!(await canEditParts(fresh, tx)))
              fail("You do not have permission to edit parts.", "FORBIDDEN");
            await applyPartFit(
              tx,
              fresh,
              doc.packingSlip!.orderId,
              item!.id,
              item!.unit,
              input.fit,
            );
          }
        } else if (input.fit) fail("Match an order part first.");
        if (!input.unit.trim()) {
          l.unit = "";
          defaultReviewUnit(l, quantityUnit);
        }
        if (input.kind === null) delete l.kind;
        else if (input.kind !== undefined) l.kind = input.kind;
        Object.assign(l, {
          humanEdited: true,
          description: input.description,
          sku: input.sku,
          quantity: input.quantity,
          ordered: input.ordered,
          unit: quantityUnit,
          unitPrice: input.unitPrice,
          orderItemId: input.orderItemId,
          pairingDismissed: !input.orderItemId,
          checked: input.checked,
        });
        if (previousEvidence !== resolutionEvidenceFingerprint(l)) invalidateResolution(l);
        if (l.orderItemId && review.orderResolutions) delete review.orderResolutions[l.orderItemId];
      } else if (input.action === "detectLine") {
        if (!detected || !review.orderConfirmed || doc.currentVersionId !== input.versionId) fail("The source or order changed. Reload and try again.", "CONFLICT");
        const items = await orderSnapshot(tx, fresh, doc.packingSlip!.orderId);
        if (!items.some(i => i.id === input.itemId) || review.lines.some(l => l.orderItemId === input.itemId && !l.ignored)) fail("This item changed or already has a match.", "CONFLICT");
        if (review.lines.length >= 200) fail("This review has reached the 200-line limit.");
        const found = detected!.line;
        review.documentChecked = false;
        if (review.orderResolutions) delete review.orderResolutions[input.itemId];
        review.lines.push({
          id: randomUUID(), page: input.page, sourceBox: detected!.band,
          selectedReading: { ...found, confidence: undefined, source: "terra", box: detected!.band, proposed: null, quantityClear: false, confidenceDetails: { ...found.confidence, basis: "model_estimate" } },
          evidence: found.evidence, description: found.description, sku: found.sku ?? "",
          unit: found.unit ?? "", quantity: found.shipped, ordered: found.ordered,
          unitPrice: null, orderItemId: input.itemId, checked: false,
          readingSource: { analysisRunId: input.requestId, reader: "terra", confidence: { ...found.confidence, basis: "model_estimate" } },
          issues: [...found.issues, "Selected from the slip; confirm the part and quantities.", ...(found.backordered !== null ? [`Printed backorder: ${found.backordered}`] : [])],
        });
      } else if (input.action === "addLine") {
        review.documentChecked = false;
        if (review.lines.length >= 200)
          fail("This review has reached the 200-line limit.");
        review.lines.push({
          id: randomUUID(),
          page: input.page,
          sourceBox: input.sourceBox,
          evidence: "Added by reviewer from the source document",
          humanEdited: true,
          description: input.description,
          sku: "",
          unit: "",
          quantity: null,
          ordered: null,
          unitPrice: null,
          orderItemId: null,
          issues: [
            "Reviewer added this line; confirm product, quantity and unit.",
          ],
          checked: false,
        });
      } else if (input.action === "removeOrderItem") {
        if (!userCan(fresh.user, "orders.send")) fail("You do not have permission to change orders.", "FORBIDDEN");
        if (!doc.packingSlip || !review.orderConfirmed) fail("Confirm the linked order first.");
        const order = await orderFor(tx, fresh, doc.packingSlip!.orderId);
        const rows = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id)).for("update");
        if (orderFingerprint(await orderSnapshot(tx, fresh, order.id)) !== input.fingerprint) fail("The order changed. Reload before removing an item.", "CONFLICT");
        const item = rows.find(i => i.id === input.itemId);
        if (!item) fail("This item is no longer on the order.");
        if (Number(item!.receivedQuantity) || Number(item!.returnedQuantity) || Number(item!.creditedQuantity) || Number(item!.fulfilledQuantity)) fail("An item with receiving, return or fulfilment records cannot be removed.");
        if (review.lines.some(l => l.orderItemId === input.itemId && !l.ignored)) fail("This item is matched to a slip line. Resolve that line before removing it.");
        if ((slipReceipts(state.documents).get(input.itemId) ?? []).length) fail("Another slip has receipt records for this item.");
        removedOrderItem = item;
        if (review.orderResolutions) delete review.orderResolutions[input.itemId];
        // Keep the material-list entry, but return it to an editable, unordered
        // state before deleting the order line referenced by its restrictive FK.
        await tx.update(quoteItems)
          .set({ sentOrderItemId: null, updatedAt: new Date() })
          .where(eq(quoteItems.sentOrderItemId, input.itemId));
        await tx.delete(orderItems).where(and(eq(orderItems.id, input.itemId), eq(orderItems.orderId, order.id)));
      } else if (input.action === "ignore") {
        const l = lineFor(input.lineId);
        if (l.approved && l.approved.quantity !== 0)
          fail("Correct an approved quantity to zero before excluding a line.");
        l.ignored = { reason: input.reason, by: fresh.user.id, at: now };
      } else if (input.action === "link") {
        if (review.lines.some((l) => l.approved && l.approved.quantity !== 0))
          fail(
            "An approved receipt cannot be moved to another order. Correct it first.",
          );
        const order = await orderFor(tx, fresh, input.orderId);
        if (doc.packingSlip?.orderId !== input.orderId) delete review.orderResolutions;
        const [list] = await tx
          .select()
          .from(materialLists)
          .where(
            and(
              eq(materialLists.id, order.materialListId!),
              eq(materialLists.jobId, fresh.job.id),
              eq(materialLists.organizationId, fresh.job.organizationId),
            ),
          )
          .limit(1);
        if (!list) fail("Material list unavailable.");
        doc.packingSlip = {
          orderId: order.id,
          orderNumber: order.orderNumber ?? order.id,
          materialListId: list!.id,
          materialListName: list!.name,
        };
        const freshItems = await orderSnapshot(tx, fresh, order.id);
        const matches = matchLines(
          freshItems,
          review.lines.map((l) => ({
            code: l.sku,
            text: l.description + " " + l.evidence,
          })),
        );
        review.lines.forEach((l, index) => {
          capturePaper(l);
          const previousEvidence = resolutionEvidenceFingerprint(l);
          delete l.approved;
          // Confirming the suggested order keeps valid saved detections. Only
          // re-align a line locally when its old item belongs to another order.
          const retainedItem = freshItems.find(
            (item) => item.id === l.orderItemId,
          );
          if (!retainedItem)
            l.orderItemId =
              matches[index]?.confidence === "high"
                ? matches[index].itemId
                : null;
          l.checked = false;
          const item = freshItems.find((i) => i.id === l.orderItemId);
          if (item && !retainedItem) {
            const converted =
              l.quantity === null
                ? null
                : convertSlipQuantity(
                    l.quantity,
                    l.unit,
                    item,
                    `${l.description} ${l.evidence}`,
                  );
            if (converted !== null) {
              l.quantity = converted;
              l.unit = item.unit;
            }
            l.issues = l.issues.filter((issue) => !MATCH_ISSUE.test(issue));
            l.issues.push(
              "Matched to the selected order. Check the product, quantity and any unit conversion.",
            );
          }
          if (previousEvidence !== resolutionEvidenceFingerprint(l)) invalidateResolution(l);
        });
        if (doc.packingSlipAnalysis) doc.packingSlipAnalysis.items = freshItems;
        review.orderConfirmed = true;
        review.supplierId = order.supplierId;
      } else if (input.action === "duplicate") {
        const other = accessibleDocument(state, actor, input.otherDocumentId),
          otherReview = ensure(other, fresh.user.id);
        if (other.id === doc.id) fail("Choose another slip.");
        const collisions = duplicateList(state, doc);
        if (!collisions.some((c) => c.id === other.id))
          fail(
            "The duplicate candidates changed. Reload the review.",
            "CONFLICT",
          );
        if (input.decision === "replace") {
          if (
            !doc.packingSlip ||
            doc.packingSlip.orderId !== other.packingSlip?.orderId
          )
            fail("A replacement must be linked to the same order.");
          if (review.lines.some((l) => l.approved) || otherReview.retiredBy)
            fail(
              "This replacement would repeat an existing receipt.",
              "CONFLICT",
            );
          const oldLines = otherReview.lines.filter((l) => l.approved);
          const used = new Set<string>();
          for (const old of oldLines) {
            const candidates = review.lines.filter(
              (l) => l.orderItemId === old.approved!.itemId && !used.has(l.id),
            );
            if (candidates.length !== 1)
              fail(
                "The replacement lines cannot be paired safely. Correct the original receipt, then keep this file as supporting documentation.",
              );
            const l = candidates[0]!;
            l.approved = structuredClone(old.approved);
            l.checked = false;
            l.issues.push(
              "Replacement: check the change from the previously approved quantity.",
            );
            used.add(l.id);
          }
          const otherBefore = structuredClone(otherReview);
          otherReview.retiredBy = doc.id;
          otherReview.revision++;
          review.replaces = other.id;
          replacedDocument = {
            id: other.id,
            before: otherBefore,
            after: structuredClone(otherReview),
          };
        } else if (
          input.decision === "supporting" &&
          review.lines.some((l) => l.approved && l.approved.quantity !== 0)
        )
          fail(
            "Correct approved quantities to zero before making this a supporting document.",
          );
        review.duplicateDecision = {
          action: input.decision === "supporting" ? "supporting" : "additional",
          reason: input.reason,
          by: fresh.user.id,
          at: now,
          documentId: other.id,
        };
        review.duplicateChecked = [
          ...new Set([
            ...(review.duplicateChecked ?? []),
            ...collisions.filter((c) => c.id === other.id).map((c) => c.key),
          ]),
        ];
      } else if (input.action === "supplier") {
        await requireCreate(fresh, tx);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${fresh.job.organizationId},4150))`,
        );
        const all = await tx
          .select({ id: suppliers.id, name: suppliers.name })
          .from(suppliers)
          .where(eq(suppliers.organizationId, fresh.job.organizationId));
        if (
          all.some(
            (s) =>
              normalizedIdentity(s.name) === normalizedIdentity(input.name),
          )
        )
          fail("That supplier already exists. Select it instead.", "CONFLICT");
        const [s] = await tx
          .insert(suppliers)
          .values({
            organizationId: fresh.job.organizationId,
            name: input.name,
            contactEmail: input.email || null,
            contactPhone: input.phone || null,
            kind: "external",
          })
          .returning();
        review.supplierId = s!.id;
        review.supplierName = s!.name;
      } else if (input.action === "part") {
        await requireCreate(fresh, tx);
        const l = lineFor(input.lineId);
        if (l.approved) fail("An approved part cannot be replaced.");
        l.humanEdited = true;
        if (input.partId) {
          const [p] = await tx
            .select()
            .from(partDefinitions)
            .where(
              and(
                eq(partDefinitions.id, input.partId),
                eq(partDefinitions.organizationId, fresh.job.organizationId),
                eq(partDefinitions.isActive, true),
                sql`exists (select 1 from ${catalogs} where ${catalogs.id}=${partDefinitions.catalogId} and ${catalogs.kind}='materials')`,
              ),
            )
            .limit(1);
          if (!p) fail("Catalogue part unavailable.");
          if (input.packageUnitConfirmed) {
            if (
              !input.addToOrder ||
              receiptUnit(l.unit) !== "ea" ||
              !p!.piecesPerPack ||
              p!.piecesPerPack <= 1 ||
              !p!.bulkUnit ||
              receiptUnit(p!.bulkUnit) === "ea" ||
              receiptUnit(input.unit) !== receiptUnit(p!.bulkUnit) ||
              input.piecesPerPack !== p!.piecesPerPack ||
              receiptUnit(input.individualUnit) !==
                receiptUnit(p!.individualUnit)
            )
              fail(
                "The part or slip unit changed. Review the package size and confirm again.",
              );
            // Explicitly confirmed EA means one complete package. Preserve the
            // ordered/delivered counts and price; do not multiply by pack size.
            l.unit = p!.bulkUnit!;
          }
          l.partId = p!.id;
          l.photoUrl = p!.imageUrl;
        } else {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${fresh.job.organizationId},4150))`,
          );
          const [cat] = await tx
            .select()
            .from(catalogs)
            .where(
              and(
                eq(catalogs.id, input.catalogId),
                eq(catalogs.organizationId, fresh.job.organizationId),
                eq(catalogs.kind, "materials"),
              ),
            )
            .limit(1);
          if (!cat) fail("Choose a catalogue in your organization.");
          const supportedUnits = await tx
            .select({ code: units.code })
            .from(units);
          if (
            !supportedUnits.some(
              (u) => receiptUnit(u.code) === receiptUnit(input.unit),
            )
          )
            fail("Choose a supported quantity unit.");
          // Only already-hosted catalogue images can be reused. External photos must be uploaded through the normal image pipeline.
          const [photo] = input.photoUrl
            ? await tx
                .select()
                .from(photoAssets)
                .where(
                  and(
                    eq(photoAssets.organizationId, fresh.job.organizationId),
                    eq(photoAssets.url, input.photoUrl),
                  ),
                )
                .limit(1)
            : [];
          const [existingPhoto] =
            input.photoUrl && !photo
              ? await tx
                  .select({ id: partDefinitions.id })
                  .from(partDefinitions)
                  .where(
                    and(
                      eq(
                        partDefinitions.organizationId,
                        fresh.job.organizationId,
                      ),
                      eq(partDefinitions.imageUrl, input.photoUrl),
                    ),
                  )
                  .limit(1)
              : [];
          if (input.photoUrl && !photo && !existingPhoto)
            fail(
              "Choose an existing organization photo or upload it through Catalogue first.",
            );
          const same = await tx
            .select({ id: partDefinitions.id })
            .from(partDefinitions)
            .where(
              and(
                eq(partDefinitions.organizationId, fresh.job.organizationId),
                sql`lower(${partDefinitions.displayName})=lower(${input.name})`,
              ),
            )
            .limit(1);
          if (same.length)
            fail(
              "A part with this name already exists. Search the catalogue and select it.",
              "CONFLICT",
            );
          const [p] = await tx
            .insert(partDefinitions)
            .values({
              organizationId: fresh.job.organizationId,
              catalogId: input.catalogId,
              displayName: input.name,
              description: input.description || null,
              bulkUnit: input.unit,
              individualUnit: input.individualUnit || null,
              piecesPerPack: input.piecesPerPack,
              imageUrl: input.photoUrl,
              imageAssetId: photo?.id ?? null,
            })
            .returning();
          l.partId = p!.id;
          l.photoUrl = p!.imageUrl;
        }
        if (input.addToOrder) await addToOrder(l);
      } else if (input.action === "reconstruct") {
        await requireCreate(fresh, tx);
        if (review.lines.some((line) => line.approved) || doc.packingSlipAnalysis?.applied)
          fail("Correct existing receipts before moving this slip to a new list.");
        if (
          review.kind !== "delivery" ||
          review.lines.some((l) => l.kind && l.kind !== "delivery")
        )
          fail("Returns must be linked to the original order.");
        const supplier = await scopedSupplier(tx, fresh, input.supplierId ?? review.supplierId);
        let list = input.materialListId
          ? (
              await tx
                .select()
                .from(materialLists)
                .where(
                  and(
                    eq(materialLists.id, input.materialListId),
                    eq(materialLists.organizationId, fresh.job.organizationId),
                    eq(materialLists.jobId, fresh.job.id),
                    eq(materialLists.kind, "materials"),
                  ),
                )
                .for("update")
            )[0]
          : undefined;
        if (input.materialListId && !list) fail("Material list unavailable.");
        if (!list) {
          [list] = await tx
            .insert(materialLists)
            .values({
              organizationId: fresh.job.organizationId,
              jobId: fresh.job.id,
              name: input.listName,
              createdByUserId: fresh.user.id,
            })
            .returning();
        }
        let quoteId = list!.quoteId;
        if (!quoteId) {
          const [q] = await tx
            .insert(quotes)
            .values({
              organizationId: fresh.job.organizationId,
              jobId: fresh.job.id,
              materialListId: list!.id,
              createdByUserId: fresh.user.id,
            })
            .returning();
          quoteId = q!.id;
          await tx
            .update(materialLists)
            .set({ quoteId })
            .where(eq(materialLists.id, list!.id));
        }
        const [order] = await tx
          .insert(orders)
          .values({
            organizationId: fresh.job.organizationId,
            jobId: fresh.job.id,
            materialListId: list!.id,
            orderNumber: input.orderNumber,
            supplierId: supplier.id,
            createdByUserId: fresh.user.id,
            status: "sent",
            sentVia: "packing-slip",
            sentAt: new Date(),
            notes: `Reconstructed from saved packing slip ${doc.id}. No order was sent to the supplier.`,
          })
          .returning();
        delete doc.packingSlip;
        // A reviewer can choose a new list instead of an incorrect suggested order.
        // No old order lines or receipts are changed; clear their review links.
        for (const line of review.lines) {
          line.orderItemId = null;
          invalidateResolution(line);
        }
        for (const id of new Set(input.lineIds))
          await addOrderLine(tx, fresh, doc, lineFor(id), order!, quoteId, input);
        doc.packingSlip = {
          orderId: order!.id,
          orderNumber: input.orderNumber,
          materialListId: list!.id,
          materialListName: list!.name,
        };
        review.supplierId = supplier.id;
        review.supplierName = supplier.name;
        review.orderConfirmed = true;
      } else if (input.action === "extra") {
        await requireCreate(fresh, tx);
        await addToOrder(lineFor(input.lineId));
      } else if (input.action === "approve") {
        if (!doc.packingSlip || !review.orderConfirmed)
          fail("Confirm the linked order first.");
        if (!review.kindConfirmed)
          fail(
            "Confirm whether this is a delivery, return for replacement or return for credit.",
          );
        if (review.duplicateDecision?.action === "supporting")
          fail("Supporting documents cannot receive quantities.");
        const outstandingDuplicates = duplicateList(state, doc).filter(
          (d) => !review.duplicateChecked?.includes(d.key),
        );
        if (outstandingDuplicates.length)
          fail("Review the possible duplicate before posting quantities.");
        const order = await orderFor(tx, fresh, doc.packingSlip!.orderId);
        if (order.supplierId !== review.supplierId)
          fail(
            "The slip supplier and linked order supplier do not match. Check the order.",
          );
        const snapshot = await orderSnapshot(tx, fresh, order.id);
        if (orderFingerprint(snapshot) !== input.fingerprint)
          fail(
            "The order changed while this review was open. Reload to see the latest quantities.",
            "CONFLICT",
          );
        const selected = [...new Set(input.lineIds)].map(lineFor);
        // Snapshot all planned allocations before any selected line is posted.
        const resolutionLines = structuredClone(review.lines);
        const rows = await tx
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id))
          .for("update");
        // What each item has counted by hand, not from any slip, which this
        // slip may take over as the same parts.
        const fromSlips = slipReceipts(state.documents);
        const hand = new Map(
          rows.map((row) => [
            row.id,
            input.fromHandCount
              ? qtyRound(
                  Number(row.receivedQuantity) -
                    (fromSlips.get(row.id) ?? []).reduce(
                      (n, r) => n + r.quantity,
                      0,
                    ),
                )
              : 0,
          ]),
        );
        for (const l of selected) {
          defaultReviewUnit(
            l,
            snapshot.find((i) => i.id === l.orderItemId)?.unit,
          );
          const quantity = receivedLineQuantity(l);
          if (l.ignored || !l.orderItemId || quantity === null)
            fail("Every selected line needs a matched part and a quantity.");
          if (
            !l.checked &&
            l.issues.length &&
            !autoConfirmsLine(
              l,
              review,
              doc.packingSlipAnalysis,
              doc.currentVersionId,
              snapshot,
            )
          )
            fail(
              "Check the flagged lines against the source before approving.",
            );
          const row = rows.find((i) => i.id === l.orderItemId),
            item = snapshot.find((i) => i.id === l.orderItemId);
          if (!row || !item) fail("A selected part is not on this order.");
          const blockers = resolutionBlockers(l, item, resolutionLines, review.kind);
          if (blockers.length) fail(blockers.join(" "));
          if (l.allocation && !allocationOwnershipValid(review.lines, l)) fail("This allocation no longer owns its source quantity. Resolve the current allocation before approval.", "CONFLICT");
          if (receiptUnit(l.unit) !== receiptUnit(item!.unit))
            fail(`Confirm the quantity in ${item!.unit}.`);
          if (l.approved && !input.reason.trim())
            fail(
              "Describe why the previously approved receipt is being corrected.",
            );
          if (!l.approved && quantity === 0 && !l.resolution)
            fail(
              "Exclude a zero-delivery line with a reason, or leave it in the queue.",
            );
          const delta = receiptDelta(
            lineKind(l, review.kind),
            quantity!,
            l.approved,
          );
          // A hand count of the same parts that the slip takes over instead
          // of adding to. A correction keeps what the slip still covers and
          // gives the rest back to the hand count.
          const handBefore = l.approved?.fromHand ?? 0;
          const fromHand = l.approved
            ? Math.min(
                handBefore,
                lineKind(l, review.kind) === "delivery" ? quantity! : 0,
              )
            : Math.max(0, Math.min(hand.get(row!.id)!, delta.received));
          if (!l.approved)
            hand.set(row!.id, qtyRound(hand.get(row!.id)! - fromHand));
          const received = qtyRound(
              Number(row!.receivedQuantity) +
                delta.received -
                fromHand +
                handBefore,
            ),
            credit = qtyRound(Number(row!.creditedQuantity) + delta.credit);
          const returned = qtyRound(
            Number(row!.returnedQuantity) +
              (["return-credit", "return-replacement"].includes(lineKind(l, review.kind)) ? quantity! : 0) -
              (l.approved && ["return-credit", "return-replacement"].includes(l.approved.kind)
                ? l.approved.quantity
                : 0),
          );
          if (
            received < 0 ||
            credit < 0 ||
            returned < 0 ||
            credit > Number(row!.quantity)
          )
            fail(
              "This return or correction exceeds the recorded delivery or ordered quantity. Resolve the original receipt first.",
            );
          if (
            received > Number(row!.quantity) - credit &&
            lineKind(l, review.kind) !== "credit-only" &&
            !input.allowOverDelivery
          )
            fail(
              "This exceeds the quantity due. Explicitly approve the over-delivery or correct the quantity.",
            );
          if (received > 999999 || credit > 999999 || returned > 999999)
            fail("The resulting total exceeds the supported quantity limit.");
          const status =
            received >= Number(row!.quantity) - credit
              ? "complete"
              : received > 0
                ? "partial"
                : "pending";
          await tx
            .update(orderItems)
            .set({
              receivedQuantity: String(received),
              creditedQuantity: String(credit),
              returnedQuantity: String(returned),
              verificationStatus: status,
            })
            .where(eq(orderItems.id, row!.id));
          row!.receivedQuantity = String(received);
          row!.creditedQuantity = String(credit);
          row!.returnedQuantity = String(returned);
          l.approved = {
            itemId: l.orderItemId!,
            quantity: quantity!,
            kind: lineKind(l, review.kind),
            by: fresh.user.id,
            at: now,
            ...(fromHand > 0 ? { fromHand } : {}),
          };
          l.checked = true;
        }
        if (input.documentChecked) review.documentChecked = true;
        // Compatibility for old status displays. Approved lines remain separately recorded in the review.
        if (doc.packingSlipAnalysis) {
          doc.packingSlipAnalysis.applied = {
            at: now,
            by: fresh.user.id,
            quantities: Object.fromEntries(
              [
                ...new Set(
                  review.lines.flatMap((l) =>
                    l.approved ? [l.approved.itemId] : [],
                  ),
                ),
              ].map((id) => [
                id,
                review.lines
                  .filter((l) => l.approved?.itemId === id)
                  .reduce(
                    (n, l) =>
                      n +
                      receiptDelta(l.approved!.kind, l.approved!.quantity).received,
                    0,
                  ),
              ]),
            ),
          };
          doc.packingSlipAnalysis.confirmedItems = snapshot;
        }
      }
      // Suggestions and reader imports must never rename a source. Confirming
      // the order, including a previously suggested link, uses the scanner's
      // naming rule in the same transaction as the human decision.
      if (
        doc.packingSlip &&
        review.orderConfirmed &&
        ["header", "link", "reconstruct", "approve"].includes(input.action)
      )
        renameLinkedSlip(state, doc, doc.packingSlip);
      if (!developmentImport) review.humanReviewed = true;
      review.revision++;
      doc.updatedAt = now;
      await history(
        tx,
        fresh,
        doc,
        input.requestId,
        input,
        before,
        replacedDocument,
        developmentImport,
        removedOrderItem,
      );
      return {
        replayed: false,
        materialListId: doc.packingSlip?.materialListId,
      };
    },
  );
  if (result.materialListId)
    publishMaterialListEvent(
      result.materialListId,
      "updated",
      access.job.organizationId,
    );
  // New parts and supplier listings change the likely parts.
  if (["part", "extra", "reconstruct"].includes(input.action)) {
    forgetCatalogue(access.job.organizationId);
    if (input.supplierPartLinkApprovals?.length) publishOrganizationCatalogueEvent(access.job.organizationId);
  }
  if (input.action === "line" && input.fit) {
    forgetCatalogue(access.job.organizationId);
    publishOrganizationCatalogueEvent(access.job.organizationId);
  }
  return result;
}

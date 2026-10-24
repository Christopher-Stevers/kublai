import { getJobPriceBook } from "~/server/job-pricing";
import { jobPriceStatus } from "~/lib/job-price-status";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import {
  orders,
  orderItems,
  partDefinitions,
  supplierParts,
  partSynonyms,
  units,
  packingSlipReviewHistory,
} from "~/server/db/schema";
import { userCan } from "~/server/auth/permissions";
import { mutateWorkspace } from "~/server/documents/service";
import {
  accessibleDocument,
  assertStateBounds,
} from "~/server/documents/domain";
import { publishMaterialListEvent } from "~/server/material-list-events";
import type { DocumentAccess } from "~/server/documents/access";
import {
  convertSlipQuantity,
  type ReceiptOrderItem,
  type SlipAnalysis,
} from "~/lib/packing-slip-review";
import { extractSlip } from "./extract";
import { analyzeSlip } from "./analyze";
import { supplierMemory } from "./memory";
type Tx = Parameters<Parameters<typeof mutateWorkspace>[2]>[3];
/** Written in the same transaction as the result/receipt: never lose the original matches. */
async function recordReviewHistory(
  tx: Tx,
  access: DocumentAccess,
  doc: { id: string; packingSlip?: unknown },
  analysis: SlipAnalysis,
  kind: "analysis" | "failure" | "confirmation",
  data: Record<string, unknown>,
) {
  await tx
    .insert(packingSlipReviewHistory)
    .values({
      organizationId: access.job.organizationId,
      jobId: access.job.id,
      documentId: doc.id,
      versionId: analysis.versionId,
      runId: analysis.runId,
      kind,
      userId: access.user.id,
      release: process.env.NEXT_PUBLIC_APP_RELEASE ?? "unknown",
      data: { schemaVersion: 1, packingSlip: doc.packingSlip, ...data },
    })
    .onConflictDoNothing();
}
async function orderFor(tx: Tx, access: DocumentAccess, orderId: string) {
  const [order] = await tx
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.jobId, access.job.id),
        eq(orders.organizationId, access.job.organizationId),
      ),
    )
    .for("update");
  if (!order?.materialListId)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "The linked order is no longer available.",
    });
  if (
    order.status === "draft" ||
    order.status === "cancelled" ||
    order.fulfillmentStatus === "cancelled"
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Only sent, active orders can be received.",
    });
  if (!userCan(access.user, "orders.receive"))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Order receiving permission is required.",
    });
  return order;
}
async function orderSnapshot(
  tx: Pick<Tx, "select">,
  access: DocumentAccess,
  orderId: string,
): Promise<ReceiptOrderItem[]> {
  const rows = await tx
    .select({
      id: orderItems.id,
      partId: orderItems.partDefinitionId,
      supplierId: supplierParts.supplierId,
      supplierPartId: orderItems.supplierPartId,
      description: orderItems.descriptionSnapshot,
      displayName: partDefinitions.displayName,
      sku: orderItems.supplierSkuSnapshot,
      currentSku: supplierParts.supplierSku,
      supplierDescription: supplierParts.supplierName,
      quantity: orderItems.quantity,
      received: orderItems.receivedQuantity,
      verificationStatus: orderItems.verificationStatus,
      piecesPerPack: partDefinitions.piecesPerPack,
      bulkUnit: partDefinitions.bulkUnit,
      individualUnit: partDefinitions.individualUnit,
      uom: units.code,
    })
    .from(orderItems)
    .innerJoin(
      partDefinitions,
      and(
        eq(partDefinitions.id, orderItems.partDefinitionId),
        eq(partDefinitions.organizationId, access.job.organizationId),
      ),
    )
    .leftJoin(
      supplierParts,
      and(
        eq(supplierParts.id, orderItems.supplierPartId),
        eq(supplierParts.organizationId, access.job.organizationId),
      ),
    )
    .leftJoin(units, eq(units.id, orderItems.uomId))
    .where(eq(orderItems.orderId, orderId))
    .orderBy(orderItems.id);
  const aliases = rows.length
    ? await tx
        .select()
        .from(partSynonyms)
        .where(
          inArray(
            partSynonyms.partDefinitionId,
            rows.map((r) => r.partId),
          ),
        )
    : [];
  const book = await getJobPriceBook(tx, access.job.organizationId, access.job.id);
  return rows.map((r) => ({
    jobPriceStatus: jobPriceStatus(book, r.partId, r.supplierId, r.supplierPartId),
    id: r.id,
    description: r.description?.trim() ? r.description : r.displayName,
    sku: r.sku?.trim() ? r.sku : r.currentSku,
    aliases: [
      ...(r.supplierDescription ? [r.supplierDescription] : []),
      ...aliases
        .filter((a) => a.partDefinitionId === r.partId)
        .map((a) => a.synonym),
    ].slice(0, 20),
    ordered: Number(r.quantity),
    received: Number(r.received),
    verificationStatus: r.verificationStatus,
    unit:
      r.piecesPerPack && r.piecesPerPack > 1
        ? (r.bulkUnit ?? "pack")
        : (r.uom ?? "ea"),
    piecesPerPack: r.piecesPerPack,
    individualUnit: r.individualUnit,
  }));
}
/** Current received totals for the delivery tracker; read-only. */
export async function liveOrderItems(access: DocumentAccess, orderId: string) {
  if (!userCan(access.user, "orders.receive")) return null;
  // Loaded here so upload routes importing this module stay free of the pool.
  const { db } = await import("~/server/db");
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.jobId, access.job.id),
        eq(orders.organizationId, access.job.organizationId),
      ),
    )
    .limit(1);
  return order ? orderSnapshot(db, access, order.id) : null;
}
export function orderFingerprint(
  items: ReceiptOrderItem[],
  includeReceipt = true,
) {
  return JSON.stringify(
    [...items]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((i) => [
        i.id,
        i.description,
        i.sku,
        [...i.aliases].sort(),
        i.ordered,
        i.unit,
        i.piecesPerPack,
        i.individualUnit,
        ...(includeReceipt ? [i.received, i.verificationStatus] : []),
      ]),
  );
}
/** Take back what a confirmed slip added, so clearing or rerunning detection
 * starts clean. Items untouched since get their earlier total and status
 * back; items changed since only lose this slip's quantity. */
async function undoSlipReceipt(
  tx: Tx,
  orderId: string,
  analysis: SlipAnalysis,
) {
  if (!analysis.applied) return false;
  const rows = await tx
    .select({
      id: orderItems.id,
      ordered: orderItems.quantity,
      received: orderItems.receivedQuantity,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .for("update");
  const before = new Map(
    (analysis.confirmedItems ?? analysis.items).map((i) => [i.id, i]),
  );
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  for (const [itemId, added] of Object.entries(analysis.applied.quantities)) {
    const row = rows.find((r) => r.id === itemId);
    if (!row) continue;
    const received = Number(row.received),
      ordered = Number(row.ordered),
      prior = before.get(itemId);
    const untouched =
      prior && Math.abs(round(prior.received + added) - received) < 1e-6;
    const total = untouched
      ? prior.received
      : Math.max(0, round(received - added));
    await tx
      .update(orderItems)
      .set({
        receivedQuantity: String(total),
        verificationStatus: untouched
          ? prior.verificationStatus
          : total > ordered + 1e-6
            ? "problem"
            : total >= ordered
              ? "complete"
              : total > 0
                ? "partial"
                : "pending",
      })
      .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)));
  }
  return true;
}
const inflight = new Map<string, Promise<void>>();
let tail: Promise<void> = Promise.resolve();
/** Persist first, then run bounded background work. Interrupted runs can be retried after the lease expires. */
export async function startSlipAnalysis(
  access: DocumentAccess,
  documentId: string,
  force = false,
  expectedRunId?: string,
) {
  if (inflight.size >= 8)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message:
        "Packing-slip analysis is busy. Your file is saved; retry shortly.",
    });
  const task = await mutateWorkspace(
    access.user.id,
    access.job.id,
    async (state, actor, fresh, tx) => {
      const doc = accessibleDocument(state, actor, documentId);
      if (!doc.packingSlip)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This document is not a linked packing slip.",
        });
      const order = await orderFor(tx, fresh, doc.packingSlip.orderId);
      if (order.materialListId !== doc.packingSlip.materialListId)
        throw new TRPCError({
          code: "CONFLICT",
          message: "The material list link changed.",
        });
      if (expectedRunId && doc.packingSlipAnalysis?.runId !== expectedRunId)
        throw new TRPCError({ code: "CONFLICT", message: "Detection changed. Reopen this packing slip." });
      if (doc.packingSlipAnalysis?.applied && !force) return null;
      if (
        doc.packingSlipAnalysis?.status === "processing" &&
        Date.now() - Date.parse(doc.packingSlipAnalysis.startedAt) < 15 * 60_000
      )
        return null;
      if (
        !force &&
        doc.packingSlipAnalysis?.status === "ready" &&
        doc.packingSlipAnalysis.versionId === doc.currentVersionId
      )
        return null;
      const version = state.versions.find((v) => v.id === doc.currentVersionId);
      if (!version)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Packing slip file unavailable.",
        });
      const previous = doc.packingSlipAnalysis;
      // Reading a confirmed slip again is a clean start: its receipt comes off.
      const undone =
        force && previous ? await undoSlipReceipt(tx, order.id, previous) : false;
      if (previous && previous.status !== "cleared") {
        const previousVersion = state.versions.find(
          (v) => v.id === previous.versionId,
        );
        await recordReviewHistory(
          tx,
          fresh,
          doc,
          previous,
          previous.status === "ready" ? "analysis" : "failure",
          {
            analysis:
              previous.status === "processing"
                ? {
                    ...previous,
                    status: "failed",
                    error:
                      "Previous analysis was interrupted or exceeded its lease before retry.",
                  }
                : previous,
            source: previousVersion
              ? {
                  sha256: previousVersion.sha256,
                  mimeType: previousVersion.mimeType,
                }
              : null,
            archivedBeforeRetry: true,
            originalReleaseUnknown: true,
            ...(undone ? { receiptUndone: previous.applied } : {}),
          },
        );
      }
      const analysis: SlipAnalysis = {
        runId: randomUUID(),
        versionId: version.id,
        status: "processing",
        startedAt: new Date().toISOString(),
        items: await orderSnapshot(tx, fresh, order.id),
        lines: [],
        warnings: [],
      };
      doc.packingSlipAnalysis = analysis;
      if (undone)
        state.activity.push({
          id: randomUUID(),
          documentId: doc.id,
          folderId: doc.folderId,
          action: "undoPackingSlipReceipt",
          detail: `Reran packing slip detection and took back its confirmed receipt for ${order.orderNumber ?? order.id}`,
          createdBy: fresh.user.id,
          createdAt: analysis.startedAt,
        });
      assertStateBounds(state);
      return {
        analysis,
        version,
        orderId: order.id,
        materialListId: undone ? order.materialListId : null,
      };
    },
  );
  if (!task) return;
  if (task.materialListId)
    publishMaterialListEvent(
      task.materialListId,
      "updated",
      access.job.organizationId,
    );
  const work = tail
    .catch(() => undefined)
    .then(async () => {
      try {
        const extracted = await extractSlip(
          access.job.organizationId,
          task.version.sha256,
          task.version.mimeType,
        );
        const memory = extracted.pages.length
          ? await import("~/server/db")
              .then(({ db }) =>
                supplierMemory(db, access.job.organizationId, task.orderId),
              )
              .catch(() => undefined)
          : undefined;
        const result = await analyzeSlip(
          extracted.rows,
          task.analysis.items,
          undefined,
          { pages: extracted.pages, memory },
        );
        await mutateWorkspace(
          access.user.id,
          access.job.id,
          async (state, actor, fresh, tx) => {
            const doc = accessibleDocument(state, actor, documentId);
            await orderFor(tx, fresh, doc.packingSlip!.orderId);
            if (
              doc.currentVersionId !== task.version.id ||
              doc.packingSlipAnalysis?.runId !== task.analysis.runId
            )
              return;
            doc.packingSlipAnalysis = {
              ...task.analysis,
              ...result,
              warnings: [
                ...extracted.warnings,
                ...result.warnings,
                ...(!task.analysis.applied && task.analysis.items.some((i) => i.received > 0)
                  ? [
                      "Previous receipts exist. Check that this is a new delivery before adding quantities.",
                    ]
                  : []),
              ],
              status: "ready",
              completedAt: new Date().toISOString(),
            };
            await recordReviewHistory(
              tx,
              fresh,
              doc,
              doc.packingSlipAnalysis,
              "analysis",
              {
                analysis: doc.packingSlipAnalysis,
                source: {
                  sha256: task.version.sha256,
                  mimeType: task.version.mimeType,
                },
              },
            );
            assertStateBounds(state);
          },
        );
      } catch (error) {
        await mutateWorkspace(
          access.user.id,
          access.job.id,
          async (state, actor, fresh, tx) => {
            const doc = accessibleDocument(state, actor, documentId);
            if (doc.packingSlipAnalysis?.runId === task.analysis.runId) {
              doc.packingSlipAnalysis = {
                ...task.analysis,
                status: "failed",
                error:
                  error instanceof Error
                    ? error.message.slice(0, 250)
                    : "Analysis failed. Retry or verify manually.",
              };
              await recordReviewHistory(
                tx,
                fresh,
                doc,
                doc.packingSlipAnalysis,
                "failure",
                {
                  analysis: doc.packingSlipAnalysis,
                  source: {
                    sha256: task.version.sha256,
                    mimeType: task.version.mimeType,
                  },
                },
              );
            }
          },
        ).catch((persistError) =>
          console.error(
            "[packing-slip] Could not persist failed analysis",
            persistError,
          ),
        );
      }
    });
  inflight.set(task.analysis.runId, work);
  tail = work;
  void work.finally(() => inflight.delete(task.analysis.runId));
}
/** Clear the current detection and take back its confirmed receipt. Keep the
 * file and audit history. */
export async function clearSlipAnalysis(
  access: DocumentAccess,
  documentId: string,
  runId: string,
) {
  const result = await mutateWorkspace(access.user.id, access.job.id, async (state, actor, fresh, tx) => {
    const doc = accessibleDocument(state, actor, documentId);
    if (!doc.packingSlip)
      throw new TRPCError({ code: "BAD_REQUEST", message: "Not a packing slip." });
    const order = await orderFor(tx, fresh, doc.packingSlip.orderId);
    if (order.materialListId !== doc.packingSlip.materialListId)
      throw new TRPCError({ code: "CONFLICT", message: "The material list link changed." });
    const previous = doc.packingSlipAnalysis;
    if (previous?.runId !== runId)
      throw new TRPCError({ code: "CONFLICT", message: "Detection changed. Reopen this packing slip." });
    if (previous.status === "cleared" && !previous.applied)
      return { analysis: previous, materialListId: null };
    const undone = await undoSlipReceipt(tx, order.id, previous);
    if (previous.status !== "cleared") await recordReviewHistory(tx, fresh, doc, previous,
      previous.status === "ready" ? "analysis" : "failure", {
        analysis: previous.status === "processing"
          ? { ...previous, status: "failed", error: "Detection was cleared by the user." }
          : previous,
        archivedBeforeClear: true,
        ...(undone ? { receiptUndone: previous.applied } : {}),
      });
    doc.packingSlipAnalysis = {
      runId: randomUUID(),
      versionId: previous.versionId,
      status: "cleared",
      startedAt: new Date().toISOString(),
      items: [], lines: [], warnings: [],
    };
    state.activity.push({
      id: randomUUID(), documentId: doc.id, folderId: doc.folderId,
      action: "clearPackingSlipDetection",
      detail: undone
        ? `Cleared packing slip detection and took back its confirmed receipt for ${order.orderNumber ?? order.id}. File kept.`
        : "Cleared packing slip detection. File kept.",
      createdBy: fresh.user.id, createdAt: new Date().toISOString(),
    });
    assertStateBounds(state);
    return {
      analysis: doc.packingSlipAnalysis,
      materialListId: undone ? order.materialListId : null,
    };
  });
  if (result.materialListId)
    publishMaterialListEvent(
      result.materialListId,
      "updated",
      access.job.organizationId,
    );
  return result.analysis;
}
export async function refreshSlipReview(
  access: DocumentAccess,
  documentId: string,
  runId: string,
) {
  return mutateWorkspace(
    access.user.id,
    access.job.id,
    async (state, actor, fresh, tx) => {
      const doc = accessibleDocument(state, actor, documentId),
        a = doc.packingSlipAnalysis;
      if (
        a?.runId !== runId ||
        a.status !== "ready" ||
        a.applied ||
        a.versionId !== doc.currentVersionId
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "Reopen the packing slip review.",
        });
      const order = await orderFor(tx, fresh, doc.packingSlip!.orderId);
      const latest = await orderSnapshot(tx, fresh, order.id);
      if (orderFingerprint(latest, false) !== orderFingerprint(a.items, false))
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "The order or catalogue details changed. Use Reanalyze slip before confirming.",
        });
      a.items = latest;
      a.runId = randomUUID();
      a.warnings = [
        ...new Set([
          ...a.warnings,
          "Receipt totals refreshed. Check all delivery quantities again before confirming.",
        ]),
      ];
      return a;
    },
  );
}
export async function confirmSlipReceipt(
  access: DocumentAccess,
  documentId: string,
  runId: string,
  quantities: Record<string, number>,
  /** Slip line index → order item chosen by the user (null: not on order). */
  links: Record<string, string | null> = {},
) {
  const result = await mutateWorkspace(
    access.user.id,
    access.job.id,
    async (state, actor, fresh, tx) => {
      const doc = accessibleDocument(state, actor, documentId),
        a = doc.packingSlipAnalysis;
      if (!doc.packingSlip)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Not a packing slip.",
        });
      const order = await orderFor(tx, fresh, doc.packingSlip.orderId);
      if (
        a?.runId !== runId ||
        a.status !== "ready" ||
        a.versionId !== doc.currentVersionId
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "This review is stale. Reopen the packing slip.",
        });
      // An uncertain client retry must never count the same delivery twice.
      if (a.applied)
        return { materialListId: order.materialListId, alreadyApplied: true };
      await tx
        .select({ id: orderItems.id })
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id))
        .for("update");
      const current = await orderSnapshot(tx, fresh, order.id);
      if (orderFingerprint(current) !== orderFingerprint(a.items))
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This order or its received quantities changed. Refresh totals and check this delivery again.",
        });
      if (
        !Object.keys(quantities).length ||
        Object.keys(quantities).some((id) => !current.some((i) => i.id === id))
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose order items to confirm.",
        });
      const originalAnalysis = structuredClone(a);
      for (const [key, itemId] of Object.entries(links)) {
        const line = a.lines[Number(key)];
        const item = current.find((i) => i.id === itemId);
        if (!line || (itemId !== null && !item))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A linked slip line or order item no longer exists.",
          });
        line.orderItemId = item?.id ?? null;
        line.linked = "user";
        // A clearly read quantity still counts as the slip's figure.
        line.proposed =
          item && line.quantityClear && line.shipped !== null
            ? convertSlipQuantity(
                line.shipped,
                line.unit ??
                  (item.piecesPerPack && item.piecesPerPack > 1
                    ? null
                    : item.unit),
                item,
              )
            : null;
      }
      for (const item of current) {
        const quantity = quantities[item.id];
        if (quantity === undefined) continue;
        if (
          !Number.isFinite(quantity) ||
          quantity < 0 ||
          quantity > 999999 ||
          Math.abs(quantity * 1e6 - Math.round(quantity * 1e6)) > 0.001
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid received quantity.",
          });
        const total = Math.round((item.received + quantity) * 1e6) / 1e6;
        if (total > 999999.999999)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Received quantity exceeds the supported range.",
          });
        const discrepancy = a.lines
          .filter((l) => l.orderItemId === item.id && l.proposed !== null)
          .reduce((sum, l) => sum + l.proposed!, 0);
        const fromSlip = a.lines.some(
          (l) => l.orderItemId === item.id && l.proposed !== null,
        );
        const problem =
          item.verificationStatus === "problem" ||
          total > item.ordered + 1e-6 ||
          (fromSlip && Math.abs(discrepancy - quantity) > 1e-6);
        await tx
          .update(orderItems)
          .set({
            receivedQuantity: String(total),
            verificationStatus: problem
              ? "problem"
              : total >= item.ordered
                ? "complete"
                : total > 0
                  ? "partial"
                  : "pending",
          })
          .where(
            and(eq(orderItems.id, item.id), eq(orderItems.orderId, order.id)),
          );
      }
      a.applied = {
        at: new Date().toISOString(),
        by: fresh.user.id,
        quantities,
        ...(Object.keys(links).length ? { links } : {}),
      };
      const source = state.versions.find((v) => v.id === a.versionId);
      await recordReviewHistory(tx, fresh, doc, a, "confirmation", {
        originalAnalysis,
        confirmedAnalysis: a,
        source: source
          ? { sha256: source.sha256, mimeType: source.mimeType }
          : null,
        // Received quantities are physical receipt observations, not corrected OCR ground truth.
        quantityMeaning: "physically_received_not_transcribed_shipped",
      });
      state.activity.push({
        id: randomUUID(),
        documentId: doc.id,
        folderId: doc.folderId,
        action: "packingSlipReceipt",
        detail: `Confirmed delivery quantities for ${order.orderNumber ?? order.id}`,
        createdBy: fresh.user.id,
        createdAt: a.applied.at,
      });
      assertStateBounds(state);
      return { materialListId: order.materialListId, alreadyApplied: false };
    },
  );
  publishMaterialListEvent(
    result.materialListId!,
    "updated",
    access.job.organizationId,
  );
  return result;
}

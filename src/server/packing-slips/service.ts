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
type Tx = Parameters<Parameters<typeof mutateWorkspace>[2]>[3];
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
  return rows.map((r) => ({
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
const inflight = new Map<string, Promise<void>>();
let tail: Promise<void> = Promise.resolve();
/** Persist first, then run bounded background work. Interrupted runs can be retried after the lease expires. */
export async function startSlipAnalysis(
  access: DocumentAccess,
  documentId: string,
  force = false,
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
      if (doc.packingSlipAnalysis?.applied) return null;
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
      assertStateBounds(state);
      return { analysis, version };
    },
  );
  if (!task) return;
  const work = tail
    .catch(() => undefined)
    .then(async () => {
      try {
        const extracted = await extractSlip(
          access.job.organizationId,
          task.version.sha256,
          task.version.mimeType,
        );
        const result = await analyzeSlip(extracted.rows, task.analysis.items);
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
                ...(task.analysis.items.some((i) => i.received > 0)
                  ? [
                      "Previous receipts exist. Check that this is a new delivery before adding quantities.",
                    ]
                  : []),
              ],
              status: "ready",
              completedAt: new Date().toISOString(),
            };
            assertStateBounds(state);
          },
        );
      } catch (error) {
        await mutateWorkspace(access.user.id, access.job.id, (state, actor) => {
          const doc = accessibleDocument(state, actor, documentId);
          if (doc.packingSlipAnalysis?.runId === task.analysis.runId)
            doc.packingSlipAnalysis = {
              ...task.analysis,
              status: "failed",
              error:
                error instanceof Error
                  ? error.message.slice(0, 250)
                  : "Analysis failed. Retry or verify manually.",
            };
        }).catch(() => undefined);
      }
    });
  inflight.set(task.analysis.runId, work);
  tail = work;
  void work.finally(() => inflight.delete(task.analysis.runId));
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

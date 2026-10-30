import {
  withSlipTrace,
  traceUsage,
  READER_VERSION,
  captureDetectionInput,
  recordPipelineStage,
} from "./trace";
import { blindItems } from "./detection-record";
import {
  draftReceiving,
  mergeReading,
  seedPreviousReceipt,
} from "./review-draft";
import { separateBackground } from "~/server/background/mode";
import { packingSlipJobs } from "~/server/background/packing-schema";
import {
  claimPackingSlip,
  ownsPackingSlip,
  heartbeatPackingSlip,
  finishPackingSlip,
  failPackingSlip,
  type SlipClaim,
} from "~/server/background/packing-queue";
import { assertDocumentAccess } from "~/server/documents/access";
import type { DocumentVersion } from "~/server/documents/types";
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
  type SlipProgress,
} from "~/lib/packing-slip-review";
import { extractSlip } from "./extract";
import { analyzeSlip } from "./analyze";
import { supplierMemory } from "./memory";
import { productionCascade } from "./production-cascade";
import { escalationPlan } from "./cascade-policy";
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
export async function orderFor(
  tx: Tx,
  access: DocumentAccess,
  orderId: string,
) {
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
export async function orderSnapshot(
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
      returned: orderItems.returnedQuantity,
      credited: orderItems.creditedQuantity,
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
  const book = await getJobPriceBook(
    tx,
    access.job.organizationId,
    access.job.id,
  );
  return rows.map((r) => ({
    jobPriceStatus: jobPriceStatus(
      book,
      r.partId,
      r.supplierId,
      r.supplierPartId,
    ),
    id: r.id,
    description: r.description?.trim() ? r.description : r.displayName,
    sku: r.sku?.trim() ? r.sku : r.currentSku,
    aliases: [
      ...(r.supplierDescription ? [r.supplierDescription] : []),
      ...aliases
        .filter((a) => a.partDefinitionId === r.partId)
        .map((a) => a.synonym),
    ].slice(0, 20),
    ordered: Number(r.quantity) - Number(r.credited),
    originalOrdered: Number(r.quantity),
    returned: Number(r.returned),
    credited: Number(r.credited),
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
  expectedRunId?: string,
) {
  if (!separateBackground() && inflight.size >= 8)
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
      if (!userCan(fresh.user, "orders.receive"))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Order receiving permission is required.",
        });
      const order = doc.packingSlip
        ? await orderFor(tx, fresh, doc.packingSlip.orderId)
        : null;
      if (order && order.materialListId !== doc.packingSlip?.materialListId)
        throw new TRPCError({
          code: "CONFLICT",
          message: "The material list link changed.",
        });
      if (expectedRunId && doc.packingSlipAnalysis?.runId !== expectedRunId)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Detection changed. Reopen this packing slip.",
        });
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
      const same = force
        ? undefined
        : state.documents.find(
            (d) =>
              d.id !== doc.id &&
              d.packingSlipAnalysis?.status === "ready" &&
              state.versions.some(
                (v) =>
                  v.id === d.currentVersionId && v.sha256 === version.sha256,
              ) &&
              d.packingSlip?.orderId === doc.packingSlip?.orderId,
          );
      if (same?.packingSlipAnalysis) {
        const copy = structuredClone(same.packingSlipAnalysis);
        delete copy.applied;
        delete copy.confirmedItems;
        copy.usage = {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          unknownCalls: 0,
          estimatedUsd: 0,
          pricingAsOf: "2026-10-27",
          pricingSource:
            "https://typesafe.ai/blog/introducing-system-one-models-and-jev",
        };
        copy.runId = randomUUID();
        copy.versionId = version.id;
        copy.startedAt = new Date().toISOString();
        copy.completedAt = copy.startedAt;
        copy.activity = [
          {
            at: copy.startedAt,
            message:
              "Reused a previous reading of this file. No new model processing was needed.",
          },
        ];
        copy.items = order ? await orderSnapshot(tx, fresh, order.id) : [];
        copy.warnings.push(
          "Repeated source file: review the duplicate before receiving.",
        );
        doc.packingSlipAnalysis = copy;
        const { initialReview } = await import("~/lib/receiving-review");
        const cachedReview = initialReview(
          copy,
          version.id,
          fresh.user.id,
          same.receivingReview?.sourceText ?? "",
        );
        doc.receivingReview = doc.receivingReview
          ? mergeReading(doc.receivingReview, cachedReview)
          : cachedReview;
        await recordReviewHistory(tx, fresh, doc, copy, "analysis", {
          analysis: copy,
          reusedFromDocument: same.id,
          source: { sha256: version.sha256, mimeType: version.mimeType },
        });
        return {
          analysis: copy,
          version,
          orderId: order?.id ?? null,
          materialListId: null,
          cachedFrom: {
            documentId: same.id,
            runId: same.packingSlipAnalysis.runId,
          },
        };
      }
      // Detection is read-only with respect to receiving. A reviewed adjustment
      // is the only operation allowed to change an already approved receipt.

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
          },
        );
      }
      const analysis: SlipAnalysis = {
        runId: randomUUID(),
        versionId: version.id,
        status: "processing",
        startedAt: new Date().toISOString(),
        items: order ? await orderSnapshot(tx, fresh, order.id) : [],
        lines: [],
        warnings: [],
        ...(previous?.applied
          ? {
              applied: previous.applied,
              confirmedItems: previous.confirmedItems ?? previous.items,
            }
          : {}),
      };
      doc.packingSlipAnalysis = analysis;
      if (separateBackground())
        await tx.insert(packingSlipJobs).values({
          id: analysis.runId,
          organizationId: fresh.job.organizationId,
          jobId: fresh.job.id,
          documentId: doc.id,
          orderId: order?.id ?? null,
          versionId: version.id,
          userId: fresh.user.id,
        });
      assertStateBounds(state);
      return {
        analysis,
        version,
        orderId: order?.id ?? null,
        materialListId: null,
        cachedFrom: null,
      };
    },
  );
  if (!task) return;
  if (task.cachedFrom) {
    await withSlipTrace(
      access.job.organizationId,
      task.analysis.runId,
      async () => {
        await captureDetectionInput(
          {
            organizationId: access.job.organizationId,
            jobId: access.job.id,
            documentId,
            versionId: task.version.id,
            source: {
              sha256: task.version.sha256,
              mimeType: task.version.mimeType,
              name: task.version.name,
            },
            sourceWarnings: [
              "Reused prediction: follow reusedFrom to the original evidence. No new extraction or model call.",
            ],
            candidatePoolComplete: false,
            orders: [],
            provenance: "cached-reading",
            reusedFrom: task.cachedFrom,
          },
          [],
        );
        await recordPipelineStage("final-reading", task.analysis);
      },
    );
    return;
  }
  if (task.materialListId)
    publishMaterialListEvent(
      task.materialListId,
      "updated",
      access.job.organizationId,
    );
  if (separateBackground()) return;
  const work = tail
    .catch(() => undefined)
    .then(async () => {
      await runSlipTask(access, documentId, task);
    });
  inflight.set(task.analysis.runId, work);
  tail = work;
  void work.finally(() => inflight.delete(task.analysis.runId));
}
async function runSlipTask(
  access: DocumentAccess,
  documentId: string,
  task: {
    analysis: SlipAnalysis;
    version: DocumentVersion;
    orderId: string | null;
  },
  claim?: SlipClaim,
) {
  return withSlipTrace(access.job.organizationId, task.analysis.runId, () =>
    performSlipTask(access, documentId, task, claim),
  );
}
async function performSlipTask(
  access: DocumentAccess,
  documentId: string,
  task: {
    analysis: SlipAnalysis;
    version: DocumentVersion;
    orderId: string | null;
  },
  claim?: SlipClaim,
) {
  try {
    if (claim && claim.attempts > 3)
      throw Error(
        "Analysis was interrupted repeatedly. Retry or verify manually.",
      );
    let progressTail = Promise.resolve();
    const report = (progress: SlipProgress, orderCandidates?: string[]) => {
      const snapshot = structuredClone(progress);
      progressTail = progressTail.then(async () => {
        await mutateWorkspace(
          access.user.id,
          access.job.id,
          async (state, actor, fresh, tx) => {
            if (claim && !(await ownsPackingSlip(tx, claim))) return;
            const doc = accessibleDocument(state, actor, documentId);
            if (
              (doc.packingSlip?.orderId ?? null) !== task.orderId ||
              doc.currentVersionId !== task.version.id ||
              doc.packingSlipAnalysis?.runId !== task.analysis.runId ||
              doc.packingSlipAnalysis.status !== "processing"
            )
              return;
            if (task.orderId) await orderFor(tx, fresh, task.orderId);
            doc.packingSlipAnalysis.progress = snapshot;
            if (orderCandidates !== undefined)
              doc.packingSlipAnalysis.orderCandidates = [...orderCandidates];
            const { message, completed, total } = snapshot;
            const activity = doc.packingSlipAnalysis.activity ?? [];
            const previous = activity.at(-1);
            if (
              previous?.message !== message ||
              previous?.completed !== completed ||
              previous?.total !== total
            )
              activity.push({
                at: new Date().toISOString(),
                message,
                completed,
                total,
              });
            doc.packingSlipAnalysis.activity = activity.slice(-120);
            assertStateBounds(state);
          },
        );
      });
      return progressTail;
    };
    await report({
      stage: "extracting",
      message: "Reading the scanned pages…",
    });
    const extracted = await extractSlip(
      access.job.organizationId,
      task.version.sha256,
      task.version.mimeType,
    );
    const { jobOrders, identifySlipOrder } =
      await import("./find-order-service");
    const options = await jobOrders(access);
    await captureDetectionInput(
      {
        organizationId: access.job.organizationId,
        jobId: access.job.id,
        documentId,
        versionId: task.version.id,
        source: {
          sha256: task.version.sha256,
          mimeType: task.version.mimeType,
          name: task.version.name,
        },
        sourceWarnings: extracted.warnings,
        candidatePoolComplete: options.length < 2000,
        orders: options.map((o) => ({
          id: o.option.id,
          orderNumber: o.option.orderNumber,
          supplier: o.option.supplier,
          items: blindItems(
            o.option.id === task.orderId ? task.analysis.items : o.slip.items,
          ),
        })),
        provenance: "captured-before-reading",
      },
      extracted.pages,
    );
    await recordPipelineStage("extraction", {
      rows: extracted.rows,
      warnings: extracted.warnings,
      pageCount: extracted.pages.length,
    });
    await report({
      stage: "matching",
      message: "OCR finished. Checking the text against this job’s orders…",
    });
    const identified = !task.orderId
      ? await identifySlipOrder(access, documentId, undefined, {
          orders: options,
          extracted,
          onProgress: (message) => report({ stage: "matching", message }),
        })
      : null;
    await recordPipelineStage("order-match", {
      linkedOrderId: task.orderId,
      identified,
    });
    let suggested = identified?.orders.find(
      (o) =>
        o.id ===
        (identified.match ??
          ("suggestion" in identified ? identified.suggestion : null)),
    );
    const orderLabel = task.orderId
      ? `linked order ${options.find((o) => o.option.id === task.orderId)?.option.orderNumber ?? ""}`.trim()
      : suggested
        ? `suggested order ${suggested.orderNumber}`
        : null;
    // Publish the suggestion before line checking, without linking or confirming it.
    await report(
      {
        stage: "matching",
        message: orderLabel
          ? `Checking product rows and quantities against ${orderLabel}${task.orderId ? "…" : ". Order confirmation is still required."}`
          : "No order suggestion yet. Reading printed rows and quantities…",
      },
      identified?.candidates,
    );
    if (suggested) {
      const { db } = await import("~/server/db");
      task.analysis.items = await orderSnapshot(db, access, suggested.id);
    }
    const readingOrderId = task.orderId ?? suggested?.id;
    const unresolvedOrder =
      !task.orderId && !identified?.match && !!identified?.orders.length;
    const memory =
      readingOrderId && extracted.pages.length
        ? await import("~/server/db")
            .then(({ db }) =>
              supplierMemory(db, access.job.organizationId, readingOrderId),
            )
            .catch(() => undefined)
        : undefined;
    // Retained for reproducing the production cascade, excluded from the
    // independent reader input. Receipt history is operational context.
    await recordPipelineStage("operational-context", {
      items: task.analysis.items,
      memory,
    });
    const cheap = await analyzeSlip(
      extracted.rows,
      task.analysis.items,
      undefined,
      {
        pages: extracted.pages,
        memory,
        onProgress: (progress) =>
          report({
            ...progress,
            message: progress.message.includes("the order")
              ? orderLabel
                ? progress.message.replaceAll("the order", orderLabel)
                : "Reading printed lines and quantities; no order selected…"
              : progress.message,
          }),
      },
    ).catch(async () => {
      const fallback = await analyzeSlip(
        extracted.rows,
        task.analysis.items,
        undefined,
        { pages: [], models: false },
      );
      fallback.warnings.push(
        "Jev could not finish the image reading; the OCR result was preserved.",
      );
      return fallback;
    });
    await report({
      stage: "checking",
      message: `Row checks finished using ${cheap.model || "OCR"}. Checking whether any uncertainty needs a higher-tier reader…`,
    });
    const result = await productionCascade({
      scope: {
        runId: task.analysis.runId,
        organizationId: access.job.organizationId,
        jobId: access.job.id,
        documentId,
        versionId: task.version.id,
        sourceHash: task.version.sha256,
      },
      base: cheap,
      pages: extracted.pages,
      unresolvedOrder,
      assertCurrent: async () => {
        const current = await mutateWorkspace(
          access.user.id,
          access.job.id,
          async (state, actor, fresh, tx) => {
            if (!userCan(fresh.user, "orders.receive")) return false;
            const doc = accessibleDocument(state, actor, documentId);
            return (
              (!claim || (await ownsPackingSlip(tx, claim))) &&
              doc.currentVersionId === task.version.id &&
              doc.packingSlipAnalysis?.runId === task.analysis.runId &&
              (doc.packingSlip?.orderId ?? null) === task.orderId
            );
          },
        );
        if (!current)
          throw Error("The source, access, or processing owner changed.");
      },
      progress: (message) =>
        report({ stage: "checking", message, lines: cheap.lines }),
      context: async () => {
        const ids =
          readingOrderId && !unresolvedOrder
            ? [readingOrderId]
            : (identified?.candidates ?? []);
        // Include all candidates when bounded; otherwise use the cheap reader's
        // shortlist and explicitly permit abstention for an incomplete pool.
        let candidates =
          readingOrderId && !unresolvedOrder
            ? options.filter((o) => ids.includes(o.option.id))
            : options;
        const data = () =>
          candidates.map((o) => ({
            id: o.option.id,
            orderNumber: o.option.orderNumber,
            supplier: o.option.supplier,
            items: (o.option.id === readingOrderId
              ? task.analysis.items
              : o.slip.items
            ).map(({ id, description, sku, aliases, ordered, unit }) => ({
              id,
              description,
              sku,
              aliases,
              ordered,
              unit,
            })),
          }));
        if (JSON.stringify(data()).length > 85000)
          candidates = candidates.filter((o) => ids.includes(o.option.id));
        return {
          orders: data(),
          candidatePoolComplete: candidates.length === options.length,
          linkedOrderId: unresolvedOrder ? null : (readingOrderId ?? null),
          reasons: escalationPlan(cheap, unresolvedOrder).reasons,
          earlierLines: cheap.lines.map(
            ({
              page,
              evidence,
              orderItemId,
              shipped,
              backordered,
              unit,
              box,
              issues,
              confidenceDetails,
            }) => ({
              page,
              evidence,
              orderItemId,
              shipped,
              backordered,
              unit,
              box,
              issues,
              confidenceDetails,
            }),
          ),
        };
      },
    });
    if (!task.orderId && result.suggestedOrderId) {
      suggested = identified?.orders.find(
        (o) => o.id === result.suggestedOrderId,
      );
      if (suggested) {
        const { db } = await import("~/server/db");
        task.analysis.items = await orderSnapshot(db, access, suggested.id);
        // An order-only answer cannot carry item IDs from a different order.
        const allowed = new Set(task.analysis.items.map((i) => i.id));
        for (const line of result.lines) {
          if (line.orderItemId && !allowed.has(line.orderItemId)) {
            line.orderItemId = null;
            line.proposed = null;
            line.issues.push(
              "Order suggestion changed. Match this product to the suggested order before approving.",
            );
          }
        }
        result.warnings.push(
          "Terra suggested this order. Confirm the order identity against the source before approving.",
        );
      }
    }
    if (
      suggested &&
      !task.orderId &&
      !identified?.match &&
      !result.suggestedOrderId
    )
      result.warnings.push(
        `Suggested order: ${suggested.orderNumber}. Confirm the order in Slip details; item discrepancies remain separate review flags.`,
      );
    await recordPipelineStage("final-reading", result);
    await mutateWorkspace(
      access.user.id,
      access.job.id,
      async (state, actor, fresh, tx) => {
        if (claim && !(await ownsPackingSlip(tx, claim))) return;
        if (!userCan(fresh.user, "orders.receive")) return;
        const doc = accessibleDocument(state, actor, documentId);
        if (doc.packingSlip) await orderFor(tx, fresh, doc.packingSlip.orderId);
        if (
          (doc.packingSlip?.orderId ?? null) !== task.orderId ||
          doc.currentVersionId !== task.version.id ||
          doc.packingSlipAnalysis?.runId !== task.analysis.runId
        )
          return;
        if (
          suggested &&
          (identified?.match === suggested.id ||
            result.suggestedOrderId === suggested.id)
        ) {
          const chosen = await orderFor(tx, fresh, suggested.id);
          doc.packingSlip = {
            orderId: chosen.id,
            orderNumber: suggested.orderNumber,
            materialListId: suggested.materialListId,
            materialListName: suggested.materialListName,
          };
        }
        doc.packingSlipAnalysis = {
          ...task.analysis,
          ...result,
          activity: [
            ...(doc.packingSlipAnalysis.activity ?? []),
            {
              at: new Date().toISOString(),
              message: "Processing finished. Results are ready for review.",
            },
          ].slice(-120),
          readerVersion: READER_VERSION,
          usage: traceUsage(),
          orderCandidates: identified?.candidates,
          warnings: [
            ...extracted.warnings,
            ...result.warnings,
            ...(!task.analysis.applied &&
            task.analysis.items.some((i) => i.received > 0)
              ? [
                  "Previous receipts exist. Check that this is a new delivery before adding quantities.",
                ]
              : []),
          ],
          status: "ready",
          completedAt: new Date().toISOString(),
        };
        // Rereading never replaces a human decision or an approved receipt.
        if (!doc.receivingReview) {
          doc.receivingReview = draftReceiving(
            doc.packingSlipAnalysis,
            fresh.user.id,
            extracted.rows,
          );
          if (doc.packingSlipAnalysis.applied) {
            seedPreviousReceipt(doc);
          }
        } else {
          doc.receivingReview = mergeReading(
            doc.receivingReview,
            draftReceiving(
              doc.packingSlipAnalysis,
              fresh.user.id,
              extracted.rows,
            ),
          );
        }
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
    return false;
  } catch (error) {
    await recordPipelineStage("failure", {
      message:
        error instanceof Error
          ? error.message.slice(0, 250)
          : "Analysis failed",
    });
    await mutateWorkspace(
      access.user.id,
      access.job.id,
      async (state, actor, fresh, tx) => {
        if (claim && !(await ownsPackingSlip(tx, claim))) return;
        const doc = accessibleDocument(state, actor, documentId);
        if (
          doc.packingSlipAnalysis?.runId === task.analysis.runId &&
          doc.currentVersionId === task.version.id &&
          (doc.packingSlip?.orderId ?? null) === task.orderId
        ) {
          doc.packingSlipAnalysis = {
            ...task.analysis,
            activity: [
              ...(doc.packingSlipAnalysis.activity ?? []),
              {
                at: new Date().toISOString(),
                message: "Processing failed. See the error below.",
              },
            ].slice(-120),
            status: "failed",
            completedAt: new Date().toISOString(),
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
    ).catch((persistError) => {
      if (claim) throw persistError;
      console.error(
        "[packing-slip] Could not persist failed analysis",
        persistError,
      );
    });
    return true;
  }
}
/** One durable claim per dispatch. Reading never confirms received quantities. */
export async function dispatchPackingSlips() {
  const claim = await claimPackingSlip();
  if (!claim) return;
  const heartbeat = setInterval(
    () => void heartbeatPackingSlip(claim).catch(() => undefined),
    15_000,
  );
  heartbeat.unref();
  try {
    const access = await assertDocumentAccess(claim.userId, claim.jobId);
    if (access.job.organizationId !== claim.organizationId)
      throw Error("Packing slip access changed");
    const task = await mutateWorkspace(
      claim.userId,
      claim.jobId,
      async (state, actor, fresh, tx) => {
        if (!(await ownsPackingSlip(tx, claim))) return null;
        if (!userCan(fresh.user, "orders.receive"))
          throw Error("Receiving access changed");
        const doc = accessibleDocument(state, actor, claim.documentId);
        const analysis = doc.packingSlipAnalysis;
        if (analysis?.runId !== claim.id || analysis.status !== "processing")
          return null;
        if (
          (doc.packingSlip?.orderId ?? null) !== claim.orderId ||
          doc.currentVersionId !== claim.versionId ||
          analysis.versionId !== doc.currentVersionId
        )
          throw Error("Packing slip source changed");
        const order = doc.packingSlip
          ? await orderFor(tx, fresh, doc.packingSlip.orderId)
          : null;
        const version = state.versions.find((v) => v.id === analysis.versionId);
        if (!version) throw Error("Packing slip version unavailable");
        return { analysis, version, orderId: order?.id ?? null };
      },
    );
    const failed = task
      ? await runSlipTask(access, claim.documentId, task, claim)
      : false;
    await finishPackingSlip(claim, failed);
  } catch {
    // Permission loss must not let a service account read or overwrite the document.
    await failPackingSlip(claim);
  } finally {
    clearInterval(heartbeat);
  }
}
/** Clear detection only; preserve the receipt and its audit trail. */
export async function clearSlipAnalysis(
  access: DocumentAccess,
  documentId: string,
  runId: string,
) {
  const result = await mutateWorkspace(
    access.user.id,
    access.job.id,
    async (state, actor, fresh, tx) => {
      const doc = accessibleDocument(state, actor, documentId);
      if (!userCan(fresh.user, "orders.receive"))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Order receiving permission is required.",
        });
      if (doc.packingSlip) await orderFor(tx, fresh, doc.packingSlip.orderId);
      const previous = doc.packingSlipAnalysis;
      if (previous?.applied && !doc.receivingReview) {
        const { initialReview } = await import("~/lib/receiving-review");
        doc.receivingReview = initialReview(
          previous,
          previous.versionId,
          fresh.user.id,
        );
        seedPreviousReceipt(doc);
      }
      if (previous?.runId !== runId)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Detection changed. Reopen this packing slip.",
        });
      if (previous.status === "cleared" && !previous.applied)
        return { analysis: previous, materialListId: null };

      if (previous.status !== "cleared")
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
                    error: "Detection was cleared by the user.",
                  }
                : previous,
            archivedBeforeClear: true,
          },
        );
      if (doc.receivingReview) {
        doc.receivingReview.lines = doc.receivingReview.lines.filter(
          (l) =>
            !!l.approved ||
            !!l.ignored ||
            l.humanEdited === true ||
            l.checked === true,
        );
        doc.receivingReview.revision++;
        doc.receivingReview.documentChecked = false;
      }
      doc.packingSlipAnalysis = {
        runId: randomUUID(),
        versionId: previous.versionId,
        status: "cleared",
        startedAt: new Date().toISOString(),
        items: [],
        lines: [],
        warnings: [],
        ...(previous.applied
          ? {
              applied: previous.applied,
              confirmedItems: previous.confirmedItems ?? previous.items,
            }
          : {}),
      };
      state.activity.push({
        id: randomUUID(),
        documentId: doc.id,
        folderId: doc.folderId,
        action: "clearPackingSlipDetection",
        detail: "Cleared packing slip detection. Approved receipts preserved.",
        createdBy: fresh.user.id,
        createdAt: new Date().toISOString(),
      });
      assertStateBounds(state);
      return {
        analysis: doc.packingSlipAnalysis,
        materialListId: null,
      };
    },
  );
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

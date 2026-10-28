import { randomUUID } from "node:crypto";
import { initialReview, type ReceivingReview } from "~/lib/receiving-review";
import { mergeReading } from "./review-draft";
import {
  convertSlipQuantity,
  type ReceiptOrderItem,
  type SlipAnalysis,
} from "~/lib/packing-slip-review";
import {
  alignTrialLines,
  trialDisagreements,
  readerLabels,
  type TrialReader,
  type TrialResults,
} from "~/lib/packing-slip-trial";

/** Immutable predictions become an editable draft; this function never approves a receipt. */
export function trialDraft(input: {
  results: TrialResults;
  reader: TrialReader;
  runId: string;
  versionId: string;
  userId: string;
  items: ReceiptOrderItem[];
}) {
  const result = input.results[input.reader];
  if (result?.status !== "complete")
    throw Error("This reader has not completed the slip.");
  const issues = new Map<string, string[]>();
  for (const row of alignTrialLines(input.results)) {
    const own = row.lines[input.reader];
    if (own) issues.set(own.lineId, trialDisagreements(row, input.results));
  }
  const analysis: SlipAnalysis = {
    runId: randomUUID(),
    versionId: input.versionId,
    status: "ready",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    readerVersion: "independent-reader-trial.2",
    model: readerLabels[input.reader],
    items: input.items,
    orderCandidates: result.orderId ? [result.orderId] : [],
    warnings: [
      ...result.warnings,
      "Development comparison: every line requires human verification. Confidence scores have not been calibrated against your reviews.",
    ],
    lines: result.lines.map((l) => {
      const item = input.items.find((i) => i.id === l.orderItemId);
      const converted =
        l.shipped !== null && item
          ? convertSlipQuantity(Math.abs(l.shipped), l.unit, item)
          : null;
      return {
        page: l.page,
        evidence: l.evidence,
        description: l.description,
        sku: l.sku,
        shipped: l.shipped,
        ordered: l.ordered,
        backordered: l.backordered,
        unit: l.unit,
        orderItemId: item?.id ?? null,
        proposed: converted,
        box: l.box ?? undefined,
        issues: [
          ...l.issues,
          ...(issues.get(l.lineId) ?? []),
          "Verify the part, quantity and unit against the source before approval.",
          ...(!item ? ["No verified item on the linked order."] : []),
        ],
      };
    }),
  };
  const review = initialReview(analysis, input.versionId, input.userId);
  review.kind =
    result.documentKind === "credit"
      ? "return-credit"
      : result.documentKind === "return"
        ? "return-replacement"
        : "delivery";
  review.kindConfirmed = false;
  review.orderConfirmed = false;
  review.documentChecked = false;
  review.supplierName = result.supplierName ?? "";
  review.deliveryNumber = result.deliveryNumber ?? "";
  review.supplierOrderNumber = result.supplierOrderNumber ?? "";
  review.deliveryDate = result.deliveryDate ?? "";
  review.sourceTrial = { runId: input.runId, reader: input.reader };
  review.sourceText = result.lines
    .map((l) => l.evidence)
    .join("\n")
    .slice(0, 48000);
  review.lines.forEach((l, i) => {
    const prediction = result.lines[i]!;
    l.id = `${analysis.runId}:${i}`;
    l.unitPrice =
      prediction.unitPrice === null ? null : Math.abs(prediction.unitPrice);
    l.predictionSource = {
      trialRunId: input.runId,
      reader: input.reader,
      lineId: prediction.lineId,
      artifactSha256: result.artifactSha256,
      confidence: prediction.confidence,
    };
    if (prediction.shipped !== null && prediction.shipped < 0) {
      l.kind =
        result.documentKind === "credit"
          ? "return-credit"
          : "return-replacement";
      l.issues.push(
        "Negative shipped quantity: confirm return and credit or replacement.",
      );
    }
  });
  if (!review.lines.length)
    review.warnings.push(
      "This reader found no product lines. Compare the other readers or add missing lines manually.",
    );
  return { analysis, review };
}

/** A fresh reader must never create another receipt line for a previously received item. */
export function mergeTrialDraft(
  previous: ReceivingReview,
  fresh: ReceivingReview,
) {
  const merged = mergeReading(structuredClone(previous), fresh);
  const existingLines = new Set(previous.lines.map((l) => l.id));
  const received = new Set(
    previous.lines.flatMap((l) => (l.approved ? [l.approved.itemId] : [])),
  );
  if (received.size) {
    merged.lines = merged.lines.filter(
      (l) =>
        !!l.approved ||
        existingLines.has(l.id) ||
        !l.orderItemId ||
        !received.has(l.orderItemId),
    );
    for (const line of merged.lines.filter((l) => !!l.approved)) {
      const candidates = fresh.lines.filter(
        (l) => l.orderItemId === line.approved!.itemId,
      );
      const previousLines = previous.lines.filter(
        (l) => l.approved?.itemId === line.approved!.itemId,
      );
      line.checked = false;
      line.issues = [
        ...line.issues,
        "Previously received: recheck the fresh comparison. Edit this existing receipt to correct its quantity; approval applies only the difference.",
      ];
      if (candidates.length === 1 && previousLines.length === 1) {
        const proposal = candidates[0]!;
        line.predictionSource = proposal.predictionSource;
        line.issues.push(
          `Fresh reading proposes ${proposal.quantity ?? "an unread quantity"} ${proposal.unit}. The saved receipt is ${line.approved!.quantity} ${line.unit}.`,
        );
      } else
        line.issues.push(
          "Fresh rows cannot be paired safely with the saved receipt. Check all source rows for this item before correcting its total.",
        );
    }
    merged.warnings.push(
      "Fresh readings for previously received items are shown in the comparison. Their saved receipt lines were kept for correction, preventing another count of the same delivery.",
    );
  }
  merged.documentChecked = false;
  return merged;
}

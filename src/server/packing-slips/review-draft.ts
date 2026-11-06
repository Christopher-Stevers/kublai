import type { JobDocument } from "~/server/documents/types";
import { createHash } from "node:crypto";
import {
  initialReview,
  normalizedIdentity,
  type ReceivingReview,
  type ReceivingLine,
} from "~/lib/receiving-review";
import type { SlipAnalysis } from "~/lib/packing-slip-review";
import type { SlipRow } from "./ocr-rows";
import { readSlipTable } from "./read-table";
import { readQuantity } from "./analyze";
/** Proposals only. A reviewer confirms identity and return disposition before posting. */
export function draftReceiving(
  analysis: SlipAnalysis,
  userId: string,
  rows: SlipRow[],
): ReceivingReview {
  const text = rows.map((r) => r.text).join("\n");
  const review = initialReview(analysis, analysis.versionId, userId, text);
  review.sourceText = text.slice(0, 48000);
  review.evidenceFingerprint =
    text.trim().length >= 30
      ? createHash("sha256").update(normalizedIdentity(text)).digest("hex")
      : undefined;
  const take = (rx: RegExp) => text.match(rx)?.[1]?.trim().slice(0, 150) ?? "";
  review.deliveryNumber = take(
    /(?:packing\s*(?:slip|list)|delivery\s*(?:note|number)|ticket)\s*(?:no\.?|number|#|:)\s*([A-Z0-9][A-Z0-9\-/]{2,30})/i,
  );
  review.supplierOrderNumber = take(
    /(?:order\s*(?:no\.?|number|#)|sales\s*order)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{2,30})/i,
  );
  review.supplierEmail = take(/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i);
  review.supplierPhone = take(/(?:tel|phone)\s*[:.]?\s*([+\d() -]{10,24})/i);
  const header = analysis.cascade?.document;
  if (header) {
    review.supplierName = header.supplierName ?? review.supplierName;
    review.deliveryNumber = header.deliveryNumber ?? review.deliveryNumber;
    review.supplierOrderNumber = header.supplierOrderNumber ?? review.supplierOrderNumber;
    review.deliveryDate = header.deliveryDate ?? review.deliveryDate;
    review.kind = header.kind === "credit" ? "credit-only" : header.kind === "return" ? "return-replacement" : review.kind;
    review.kindConfirmed = false;
    review.orderConfirmed = false;
    review.documentChecked = false;
    review.warnings.push("Terra assisted the reading. Verify the document type, order, and printed quantities against the original.");
  }
  const table = readSlipTable(rows);
  if (
    review.kind !== "return-credit" && review.kind !== "credit-only" &&
    table.lines.some(
      (l) => (readQuantity(l.cells.shipped ?? l.cells.qty).value ?? 0) < 0,
    )
  ) {
    review.kind = "return-replacement";
    review.kindConfirmed = false;
  }
  // The positioned text provides descriptions for unmatched Jev rows, without fabricating a product.
  for (const line of review.lines) {
    const source = table.lines.find(
      (l) =>
        l.page === line.page &&
        (l.text === line.evidence || line.evidence.includes(l.text)),
    );
    if (source) {
      const price = readQuantity(source.cells.price);
      if (price.value !== null && price.confidence >= 90)
        line.unitPrice = price.value;
    }
    if (review.kind !== "delivery")
      line.issues = [
        ...new Set([
          ...line.issues,
          review.kind === "credit-only" ? "Confirm the credited quantity. A credit does not record a physical return." : "Confirm the returned quantity and whether replacement or credit is expected.",
        ]),
      ];
  }
  if (!review.lines.length) {
    review.warnings.push(
      "No reliable item rows were found. Add missing lines from the source, or retry with a clearer scan.",
    );
  }
  return review;
}

/** Rereads update predictions, while preserving saved decisions and their original source crops. */
export function mergeReading(review: ReceivingReview, fresh: ReceivingReview) {
  if (review.retiredBy || review.versionId !== fresh.versionId) return review;
  if (
    !review.humanReviewed &&
    !review.lines.some((l) => !!l.approved || l.checked === true)
  )
    return { ...fresh, revision: review.revision + 1 };
  const kept = review.lines.filter(
    (l) =>
      l.humanEdited === true ||
      !!l.approved ||
      !!l.ignored ||
      l.checked === true ||
      !!l.partId,
  );
  const sameRow = (
    a: ReceivingReview["lines"][number],
    b: ReceivingReview["lines"][number],
  ) => {
    if (a.page !== b.page) return false;
    const x = a.sourceBox,
      y = b.sourceBox;
    if (x && y) {
      const overlap = Math.max(
        0,
        Math.min(x.y + x.height, y.y + y.height) - Math.max(x.y, y.y),
      );
      if (overlap >= Math.min(x.height, y.height) * 0.5) return true;
    }
    return (
      a.evidence.length > 10 &&
      normalizedIdentity(a.evidence) === normalizedIdentity(b.evidence)
    );
  };
  const predictions = fresh.lines
    .filter((l) => !kept.some((k) => sameRow(k, l)))
    .map((l, i) => ({
      ...l,
      id: `${fresh.analysisRunId ?? "reread"}:${i}`,
      issues: kept.length
        ? [
            ...l.issues,
            "New reading: compare with preserved lines before approving to avoid repeating a receipt.",
          ]
        : l.issues,
    }));
  return {
    ...review,
    revision: review.revision + 1,
    analysisRunId: fresh.analysisRunId,
    sourceText: fresh.sourceText,
    evidenceFingerprint: fresh.evidenceFingerprint,
    lines: [...kept, ...predictions],
    warnings: [
      ...fresh.warnings,
      ...(kept.length
        ? [
            "Saved line decisions and original source crops were preserved during rereading.",
          ]
        : []),
    ],
    documentChecked: predictions.length ? false : review.documentChecked,
  };
}

export function seedPreviousReceipt(doc: JobDocument) {
  const a = doc.packingSlipAnalysis,
    r = doc.receivingReview;
  if (!a?.applied || !r || r.lines.some((l) => l.approved)) return;
  // Legacy confirmations were per order item, not per printed row. Preserve those totals exactly.
  r.lines = Object.entries(a.applied.quantities).map(
    ([itemId, quantity], i) => {
      const item = (a.confirmedItems ?? a.items).find((x) => x.id === itemId),
        source = a.lines.find((l) => l.orderItemId === itemId);
      return {
        id: `legacy-${i}`,
        page: source?.page ?? 1,
        evidence: source?.evidence ?? "Previously approved receipt",
        description: item?.description ?? "Previously received part",
        sku: item?.sku ?? "",
        unit: item?.unit ?? "ea",
        quantity,
        ordered: item?.ordered ?? null,
        unitPrice: null,
        orderItemId: itemId,
        issues: [],
        checked: true,
        approved: {
          itemId,
          quantity,
          kind: "delivery",
          by: a.applied!.by,
          at: a.applied!.at,
        },
      } satisfies ReceivingLine;
    },
  );
  r.kindConfirmed = true;
  r.orderConfirmed = true;
  r.documentChecked = true;
}

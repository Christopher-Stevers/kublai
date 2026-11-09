import type { SlipAnalysis, SlipLine, SlipBox } from "./packing-slip-review";
import { receivedLineQuantity, resolutionBlockers, type ReceivingResolution } from "./receiving-resolution";
import {
  convertSlipQuantity,
  lineReadings,
  orderPack,
  receiptUnit,
  type ReceiptOrderItem,
} from "./packing-slip-review";

export type ReceiptKind = "delivery" | "return-replacement" | "return-credit" | "credit-only";
export type ReceivingLine = {
  /** Original model evidence from a reviewer-selected full-width row. */
  selectedReading?: SlipLine;
  /** The source quantity is retained when a reviewer records a different site count. */
  paper?: { quantity: number | null; ordered: number | null; unit: string; description: string; sku: string };
  resolution?: ReceivingResolution;
  /** What a reviewer says is needed to fix this line, in their own words.
   * Saving it changes no decision. */
  note?: { text: string; by: string; at: string };
  allocation?: { sourceLineIds: string[]; operationId: string };
  /** Current allocation operation owning this excluded source's quantity. */
  allocatedTo?: string;
  readingSource?: {
    analysisRunId: string;
    reader: "ocr" | "jev" | "terra";
    confidence?: SlipLine["confidenceDetails"];
  };
  predictionSource?: {
    trialRunId: string;
    reader: import("./packing-slip-trial").TrialReader;
    lineId: string;
    artifactSha256?: string;
    confidence: import("./packing-slip-trial").TrialLine["confidence"];
  };
  kind?: ReceiptKind;
  humanEdited?: boolean;
  /** Reviewer separated this line; do not suggest it back into a comparison. */
  pairingDismissed?: boolean;
  id: string;
  page: number;
  sourceIndex?: number;
  sourceBox?: SlipBox;
  evidence: string;
  description: string;
  sku: string;
  unit: string;
  quantity: number | null;
  ordered: number | null;
  unitPrice: number | null;
  orderItemId: string | null;
  partId?: string | null;
  issues: string[];
  photoUrl?: string | null;
  approved?: {
    quantity: number;
    itemId: string;
    kind: ReceiptKind;
    by: string;
    at: string;
    /** Of the quantity, what was already counted by hand on the order and
     * taken over by this slip rather than added. */
    fromHand?: number;
  };
  ignored?: { reason: string; by: string; at: string };
  checked?: boolean;
  /** Response-only confirmation, recalculated from current saved reader evidence. */
  autoConfirmed?: boolean;
};
export type ReceivingReview = {
  /** Notes for an order item with no linked slip row. These never post receipt quantities. */
  orderResolutions?: Record<string, { disposition: "outstanding" | "backordered" | "cancel-requested" | "unresolved"; note: string; by: string; at: string }>;
  sourceTrial?: {
    runId: string;
    reader: import("./packing-slip-trial").TrialReader;
  };
  revision: number;
  humanReviewed?: boolean;
  versionId: string;
  analysisRunId?: string;
  kind: ReceiptKind;
  kindConfirmed: boolean;
  supplierName: string;
  supplierId: string | null;
  deliveryNumber: string;
  supplierOrderNumber: string;
  deliveryDate: string;
  lines: ReceivingLine[];
  warnings: string[];
  duplicateDecision?: {
    action: "additional" | "supporting";
    reason: string;
    by: string;
    at: string;
    documentId?: string;
  };
  sourceText?: string;
  preparedAt: string;
  preparedBy: string;
  evidenceFingerprint?: string;
  orderConfirmed?: boolean;
  documentChecked?: boolean;
  retiredBy?: string;
  replaces?: string;
  duplicateChecked?: string[];
  supplierEmail?: string;
  supplierPhone?: string;
  /** Received without a check, because the supplier's recent slips needed
   * no corrections. */
  autopilot?: {
    at: string;
    requestId: string;
    /** The review as it was received; Undo only works while it still is. */
    revision: number;
    lines: number;
    /** Slips in a row from the supplier a person checked first. */
    trustedAfter: number;
    /** What it confirmed, so Undo can put it back. */
    before: Pick<
      ReceivingReview,
      "orderConfirmed" | "documentChecked" | "supplierId"
    >;
    undone?: { by: string; at: string };
  };
};
export const lineKind = (line: ReceivingLine, fallback: ReceiptKind) =>
  line.kind ?? fallback;
export const qtyRound = (n: number) => Math.round(n * 1e6) / 1e6;
export const normalizedIdentity = (s: string) =>
  s
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
export function hasReturnEvidence(text: string) {
  return (
    /\b(return\s+merch|return(?:ed)?\s+(?:goods|material|packing)|credit\s+(?:note|memo)|rma)\b/i.test(
      text,
    ) || /(?:^|\s)-\d+(?:\.\d+)?\s*(?:EA|FT|PCS|BOX)\b/im.test(text)
  );
}
export function initialReview(
  analysis: SlipAnalysis | undefined,
  versionId: string,
  userId: string,
  text = "",
): ReceivingReview {
  return {
    revision: 1,
    versionId,
    analysisRunId: analysis?.runId,
    kind: /\bcredit\s+(?:note|memo)\b/i.test(text) ? "credit-only" : hasReturnEvidence(text) ? "return-replacement" : "delivery",
    kindConfirmed: !hasReturnEvidence(text),
    supplierName: "",
    supplierId: null,
    deliveryNumber: "",
    supplierOrderNumber: "",
    deliveryDate: "",
    lines: (analysis?.lines ?? []).map((l, i) => {
      const draft = reviewLine(l, i),
        item = analysis?.items.find((x) => x.id === l.orderItemId);
      if (analysis)
        draft.readingSource = {
          analysisRunId: analysis.runId,
          reader:
            l.source === "terra"
              ? "terra"
              : l.source === "vision" || l.source === "assistant"
                ? "jev"
                : "ocr",
          confidence: l.confidenceDetails,
        };
      if (l.proposed !== null && item) draft.unit = item.unit;
      defaultReviewUnit(draft, item?.unit);
      if (l.proposed !== null && l.shipped !== null)
        draft.ordered = convertedOrderedQuantity(
          draft.ordered,
          Math.abs(l.shipped),
          l.proposed,
        );
      if (
        (analysis?.lines.some((line) => (line.shipped ?? 0) < 0) ?? false) &&
        (l.shipped ?? 0) > 0
      ) {
        draft.kind = "delivery";
        draft.issues.push(
          "This slip contains signed quantities. Check this line’s delivery or return type.",
        );
      }
      return draft;
    }),
    warnings: [...(analysis?.warnings ?? [])],
    preparedAt: new Date().toISOString(),
    preparedBy: userId,
  };
}
export function reviewLine(line: SlipLine, i: number): ReceivingLine {
  return {
    id: String(i),
    sourceIndex: i,
    sourceBox: line.box,
    page: line.page,
    evidence: line.evidence,
    description: line.description ?? line.evidence,
    sku: line.sku ?? "",
    unit: line.unit ?? "",
    quantity:
      line.proposed ?? (line.shipped === null ? null : Math.abs(line.shipped)),
    ordered:
      line.ordered === undefined || line.ordered === null
        ? null
        : Math.abs(line.ordered),
    unitPrice: null,
    orderItemId: line.orderItemId,
    issues: [...line.issues],
    checked: false,
  };
}
/** A reviewer quantity is in the matched order's unit unless explicitly changed.
 * This defaults a missing unit; it never converts a supplied unit or quantity. */
export function defaultReviewUnit(
  line: ReceivingLine,
  orderUnit: string | undefined,
) {
  if (line.unit.trim() || !line.orderItemId || !orderUnit?.trim()) return;
  // A raw count with no printed unit might be pieces, feet, or whole packs.
  // Only a reviewer-confirmed quantity may inherit a bulk order unit.
  if (receiptUnit(orderUnit) !== "ea" && !line.humanEdited && !line.checked && !line.approved) {
    const issue = `Confirm the slip quantity in ${orderUnit}; the printed unit is missing.`;
    if (!line.issues.includes(issue)) line.issues.push(issue);
    return;
  }
  line.unit = orderUnit;
  line.issues = line.issues.filter(
    (issue) =>
      issue !== `Confirm the slip quantity in ${orderUnit}; the printed unit is missing.` &&
      !/^(?:Earlier reading: )?(?:No unit could be read on the slip\.|Quantity unit is not printed\.|Printed unit is missing or unclear\.|Quantity unit missing or ambiguous\.?$)/i.test(
        issue,
      ),
  );
}
/** An accepted quantity conversion applies to both columns of the same slip row. */
export function convertedOrderedQuantity(
  ordered: number | null,
  fromQuantity: number | null,
  toQuantity: number | null,
) {
  if (
    ordered === null ||
    fromQuantity === null ||
    toQuantity === null ||
    !Number.isFinite(ordered) ||
    !Number.isFinite(fromQuantity) ||
    !Number.isFinite(toQuantity) ||
    fromQuantity <= 0 ||
    toQuantity <= 0
  )
    return ordered;
  return qtyRound((ordered * toQuantity) / fromQuantity);
}

/** Older reviews converted shipped pieces to packs but kept the raw ordered count.
 * Repair only an unchanged source count with the same proven pack conversion. */
export function normalizeOrderedQuantity(
  line: ReceivingLine,
  source: SlipLine | undefined,
  item: ReceiptOrderItem | undefined,
) {
  if (
    !source ||
    !item ||
    source.orderItemId !== line.orderItemId ||
    line.orderItemId !== item.id ||
    source.ordered == null ||
    source.shipped === null ||
    line.ordered !== Math.abs(source.ordered) ||
    line.quantity === null ||
    !(line.checked || line.approved || source.proposed === line.quantity) ||
    receiptUnit(line.unit) !== receiptUnit(item.unit) ||
    (source.unit?.trim() && receiptUnit(source.unit) === receiptUnit(item.unit))
  )
    return;
  const pack = orderPack(item, source.evidence);
  if (
    !pack ||
    pack <= 1 ||
    Math.abs(source.shipped) <= 0 ||
    qtyRound(Math.abs(source.shipped) / pack) !== line.quantity
  )
    return;
  line.ordered = convertedOrderedQuantity(
    line.ordered,
    Math.abs(source.shipped),
    line.quantity,
  );
}
export function readyLine(l: ReceivingLine) {
  const quantity = receivedLineQuantity(l);
  return (
    !l.approved &&
    !l.ignored &&
    !!l.orderItemId &&
    quantity !== null &&
    Number.isFinite(quantity) &&
    (quantity > 0 || (!!l.resolution && quantity === 0 && l.resolution.delivery !== "confirmed")) &&
    resolutionBlockers(l).length === 0 &&
    (l.checked === true || l.autoConfirmed === true || l.issues.length === 0)
  );
}

/** One reader must support both the displayed part and quantity at 90% or more.
 * This confirms a proposal, never posts a receipt or replaces a human decision. */
export function autoConfirmsLine(
  line: ReceivingLine,
  review: ReceivingReview,
  analysis: SlipAnalysis | undefined,
  currentVersionId: string | null | undefined,
  items: ReceiptOrderItem[],
) {
  if (
    line.humanEdited ||
    line.ignored ||
    line.approved ||
    review.retiredBy ||
    analysis?.status !== "ready" ||
    review.versionId !== currentVersionId ||
    analysis.versionId !== currentVersionId ||
    review.analysisRunId !== analysis.runId ||
    (line.readingSource?.analysisRunId ?? analysis.runId) !== analysis.runId ||
    line.sourceIndex === undefined ||
    line.quantity === null ||
    !Number.isFinite(line.quantity) ||
    line.quantity <= 0
  )
    return false;
  const source = analysis.lines[line.sourceIndex];
  const item = items.find((i) => i.id === line.orderItemId);
  if (
    !item ||
    !source ||
    receiptUnit(line.unit) !== receiptUnit(item.unit)
  )
    return false;
  // Imported trial readers keep their original confidence on the review line.
  // Pair it with the immutable source quantity, never with a reviewer-edited value.
  const prediction = line.predictionSource;
  const savedPrediction = prediction &&
    prediction.trialRunId === review.sourceTrial?.runId &&
    prediction.reader === review.sourceTrial.reader &&
    /^[a-f0-9]{64}$/i.test(prediction.artifactSha256 ?? "")
      ? [{
          orderItemId: source.orderItemId,
          shipped: source.shipped,
          unit: source.unit,
          match: prediction.confidence.match.value,
          quantity: prediction.confidence.quantity.value,
        }]
      : [];
  return [...lineReadings(source), ...savedPrediction].some((reading) => {
    if (
      reading.orderItemId !== item.id ||
      reading.shipped === null ||
      reading.match === null ||
      reading.match < 0.9 ||
      reading.match > 1 ||
      reading.quantity === null ||
      reading.quantity < 0.9 ||
      reading.quantity > 1 ||
      !Number.isFinite(reading.match) ||
      !Number.isFinite(reading.quantity)
    )
      return false;
    // A missing unit cannot establish whether 100 means pieces or boxes.
    if (!reading.unit?.trim() && receiptUnit(item.unit) !== "ea") return false;
    const quantity = convertSlipQuantity(
      Math.abs(reading.shipped),
      reading.unit?.trim() ? reading.unit : item.unit,
      item,
      source.evidence,
    );
    return quantity !== null && qtyRound(quantity) === qtyRound(line.quantity!);
  });
}

export function receiptDelta(
  kind: ReceiptKind,
  quantity: number,
  before?: ReceivingLine["approved"],
) {
  if (
    !Number.isFinite(quantity) ||
    quantity < 0 ||
    quantity > 999999 ||
    qtyRound(quantity) !== quantity
  )
    throw Error("Enter a nonnegative quantity with at most six decimals.");
  const impact = (k: ReceiptKind, q: number) => ({
    received: k === "delivery" ? q : k === "credit-only" ? 0 : -q,
    credit: k === "return-credit" || k === "credit-only" ? q : 0,
  });
  const now = impact(kind, quantity),
    old = before
      ? impact(before.kind, before.quantity)
      : { received: 0, credit: 0 };
  return {
    received: qtyRound(now.received - old.received),
    credit: qtyRound(now.credit - old.credit),
  };
}
export function duplicateEvidence(
  a: {
    hash: string;
    review?: ReceivingReview;
    analysis?: SlipAnalysis;
    orderId?: string;
  },
  b: {
    hash: string;
    review?: ReceivingReview;
    analysis?: SlipAnalysis;
    orderId?: string;
  },
) {
  if (a.hash && a.hash === b.hash) return "The uploaded file is identical.";
  const x = a.review,
    y = b.review;
  if (x && y) {
    const supplier =
      (!!x.supplierId && x.supplierId === y.supplierId) ||
      (normalizedIdentity(x.supplierName).length > 3 &&
        normalizedIdentity(x.supplierName) ===
          normalizedIdentity(y.supplierName));
    if (
      supplier &&
      normalizedIdentity(x.deliveryNumber).length >= 3 &&
      normalizedIdentity(x.deliveryNumber) ===
        normalizedIdentity(y.deliveryNumber)
    )
      return "The supplier and delivery number match.";
    if (
      supplier &&
      x.evidenceFingerprint &&
      x.evidenceFingerprint === y.evidenceFingerprint
    )
      return "The extracted document contents match.";
  }
  // A possible repeat must still be reviewed: equal quantities alone do not prove duplication.
  if (
    a.orderId &&
    a.orderId === b.orderId &&
    a.analysis?.lines.length &&
    b.analysis?.lines.length
  ) {
    const signature = (s: SlipAnalysis) =>
      s.lines
        .map((l) => [
          normalizedIdentity(l.sku ?? l.description ?? l.evidence),
          l.shipped,
          l.backordered,
        ])
        .sort()
        .map((l) => JSON.stringify(l))
        .join("|");
    if (signature(a.analysis) === signature(b.analysis))
      return "The same order, products and printed quantities appeared on another slip.";
  }
  return null;
}

/** Split the comparison without changing order contents or received quantities. */
export function splitComparisonLines(lines: ReceivingLine[]) {
  if (lines.some(line => line.approved)) throw new Error("Approved receipts cannot be split. Correct the receipt first.");
  if (lines.some(line => line.ignored)) throw new Error("Restore excluded lines before splitting.");
  for (const line of lines) {
    line.orderItemId = null;
    line.pairingDismissed = true;
    line.humanEdited = true;
    line.checked = false;
    delete line.resolution;
  }
}

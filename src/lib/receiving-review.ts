import type { SlipAnalysis, SlipLine, SlipBox } from "./packing-slip-review";
import { receiptUnit } from "./packing-slip-review";
export type ReceiptKind = "delivery" | "return-replacement" | "return-credit";
export type ReceivingLine = {
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
  };
  ignored?: { reason: string; by: string; at: string };
  checked?: boolean;
};
export type ReceivingReview = {
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
    kind: hasReturnEvidence(text) ? "return-replacement" : "delivery",
    kindConfirmed: !hasReturnEvidence(text),
    supplierName: "",
    supplierId: null,
    deliveryNumber: "",
    supplierOrderNumber: "",
    deliveryDate: "",
    lines: (analysis?.lines ?? []).map((l, i) => {
      const draft = reviewLine(l, i),
        item = analysis?.items.find((x) => x.id === l.orderItemId);
      if (analysis) draft.readingSource = { analysisRunId: analysis.runId, reader: l.source === "terra" ? "terra" : l.source === "vision" || l.source === "assistant" ? "jev" : "ocr", confidence: l.confidenceDetails };
      if (l.proposed !== null && item) draft.unit = item.unit;
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
export function readyLine(l: ReceivingLine) {
  return (
    !l.approved &&
    !l.ignored &&
    !!l.orderItemId &&
    l.quantity !== null &&
    Number.isFinite(l.quantity) &&
    l.quantity > 0 &&
    !!receiptUnit(l.unit) &&
    (l.checked === true || l.issues.length === 0)
  );
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
    received: k === "delivery" ? q : -q,
    credit: k === "return-credit" ? q : 0,
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

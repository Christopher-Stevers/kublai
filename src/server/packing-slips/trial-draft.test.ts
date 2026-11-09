import { describe, expect, it } from "vitest";
import { trialDraft, mergeTrialDraft } from "./trial-draft";
import { mergeReading } from "./review-draft";
import { autoConfirmsLine } from "~/lib/receiving-review";
import type { TrialResult } from "~/lib/packing-slip-trial";
import type { ReceiptOrderItem } from "~/lib/packing-slip-review";
const id = "00000000-0000-4000-8000-000000000001";
const score = { value: 0.98, basis: "self_assessed", reason: "Source visible" };
const item: ReceiptOrderItem = {
  id,
  description: "Pipe",
  sku: "P1",
  aliases: [],
  ordered: 20,
  received: 0,
  verificationStatus: "pending",
  unit: "ea",
  piecesPerPack: null,
  individualUnit: null,
};
const result: TrialResult = {
  schemaVersion: 1,
  caseId: "case-001",
  reader: "astra",
  model: "gpt-6-astra",
  status: "complete",
  sourceSha256: "a".repeat(64),
  documentKind: "delivery",
  warnings: [],
  lines: [
    {
      lineId: "p1-l1",
      page: 1,
      box: { x: 0, y: 0.3, width: 1, height: 0.03 },
      evidence: "P1 PIPE 10 EA",
      description: "Pipe",
      sku: "P1",
      ordered: 20,
      shipped: 10,
      backordered: 10,
      unit: "ea",
      unitPrice: null,
      orderItemId: id,
      confidence: {
        part: score,
        quantity: score,
        match: score,
        overall: score,
      },
      issues: [],
    },
  ],
};
const draft = (r = result, items = [item]) =>
  trialDraft({
    results: { astra: r },
    reader: "astra",
    runId: "trial-test-001",
    versionId: id,
    userId: "reviewer",
    items,
  });
describe("comparison proposals", () => {
  it("keeps every completed reader's part and quantity evidence for the 90% rule", () => {
    const astra = { ...result, lines: [{ ...result.lines[0]!, orderItemId: null }] };
    const terra: TrialResult = { ...result, reader: "terra", model: "terra", lines: [{ ...result.lines[0]!, confidence: { ...result.lines[0]!.confidence, match: { ...score, value: .90 }, quantity: { ...score, value: .90 } } }] };
    const { review, analysis } = trialDraft({ results: { astra, terra }, reader: "astra", runId: "trial-test-001", versionId: id, userId: "reviewer", items: [item] });
    const line = review.lines[0]!;
    expect(analysis.lines[0]!.readings?.map(r => r.reader)).toEqual(["astra", "terra"]);
    line.orderItemId = item.id;
    expect(autoConfirmsLine(line, review, analysis, id, [item])).toBe(true);
    expect(line.checked).toBe(false);
    expect(line.approved).toBeUndefined();
    line.humanEdited = true;
    expect(autoConfirmsLine(line, review, analysis, id, [item])).toBe(false);
  });
  it("never turns a high confidence result into an approved receipt", () => {
    const { review } = draft();
    expect(review.lines[0]!.approved).toBeUndefined();
    expect(review.lines[0]!.checked).toBe(false);
    expect(review.lines[0]!.issues).not.toHaveLength(0);
    expect(review.orderConfirmed).toBe(false);
    expect(review.documentChecked).toBe(false);
    expect(review.lines[0]!.predictionSource?.confidence).toEqual(
      result.lines[0]!.confidence,
    );
  });
  it("does not borrow confidence from a similar product without source-row evidence", () => {
    const astra: TrialResult = { ...result, lines: [{ ...result.lines[0]!, box: null, sku: "P1", description: "Black steel pipe 1 inch", confidence: { ...result.lines[0]!.confidence, match: { ...score, value: .4 } } }] };
    const terra: TrialResult = { ...result, reader: "terra", lines: [{ ...result.lines[0]!, box: null, sku: "P2", description: "Black steel pipe 2 inch" }] };
    const { review, analysis } = trialDraft({ results: { astra, terra }, reader: "astra", runId: "trial-test-001", versionId: id, userId: "reviewer", items: [item] });
    expect(analysis.lines[0]!.readings?.map(r => r.reader)).toEqual(["astra"]);
    expect(autoConfirmsLine(review.lines[0]!, review, analysis, id, [item])).toBe(false);
  });
  it("does not borrow confidence from another source PDF", () => {
    const astra: TrialResult = { ...result, lines: [{ ...result.lines[0]!, confidence: { ...result.lines[0]!.confidence, match: { ...score, value: .4 } } }] };
    const terra: TrialResult = { ...result, reader: "terra", sourceSha256: "b".repeat(64) };
    const { review, analysis } = trialDraft({ results: { astra, terra }, reader: "astra", runId: "trial-test-001", versionId: id, userId: "reviewer", items: [item] });
    expect(analysis.lines[0]!.readings?.map(r => r.reader)).toEqual(["astra"]);
    expect(autoConfirmsLine(review.lines[0]!, review, analysis, id, [item])).toBe(false);
  });
  it("refuses to trust an item from outside the linked order", () => {
    const { review } = draft(result, []);
    expect(review.lines[0]!.orderItemId).toBeNull();
    expect(review.lines[0]!.quantity).toBe(10);
    expect(review.lines[0]!.issues).toContain(
      "No verified item on the linked order.",
    );
  });
  it("preserves negative shipped quantities as return proposals", () => {
    const { review } = draft({
      ...result,
      lines: [{ ...result.lines[0]!, shipped: -3 }],
    });
    expect(review.lines[0]!.quantity).toBe(3);
    expect(review.lines[0]!.kind).toBe("return-replacement");
    expect(review.kindConfirmed).toBe(false);
  });
  it("preserves a human correction and approved quantity when switching readers", () => {
    const previous = draft().review;
    previous.humanReviewed = true;
    previous.lines[0]!.quantity = 8;
    previous.lines[0]!.checked = true;
    previous.lines[0]!.approved = {
      itemId: id,
      quantity: 8,
      kind: "delivery",
      by: "reviewer",
      at: "2026-10-27T10:00:00Z",
    };
    const merged = mergeReading(previous, draft().review);
    expect(merged.lines).toHaveLength(1);
    expect(merged.lines[0]!.approved!.quantity).toBe(8);
    expect(merged.lines[0]!.quantity).toBe(8);
  });
  it("does not conceal an empty detection", () => {
    expect(draft({ ...result, lines: [] }).review.warnings.join(" ")).toContain(
      "no product lines",
    );
  });
  it("does not append another receipt when a fresh transcription differs from a saved approval", () => {
    const previous = draft().review;
    previous.humanReviewed = true;
    previous.documentChecked = true;
    previous.lines[0]!.quantity = 8;
    previous.lines[0]!.approved = {
      itemId: id,
      quantity: 8,
      kind: "delivery",
      by: "reviewer",
      at: "2026-10-20T00:00:00Z",
    };
    const fresh = draft({
      ...result,
      lines: [
        {
          ...result.lines[0]!,
          box: null,
          evidence: "Different fresh transcription",
          shipped: 10,
        },
      ],
    }).review;
    const merged = mergeTrialDraft(previous, fresh);
    expect(merged.lines).toHaveLength(1);
    expect(merged.lines[0]!.quantity).toBe(8);
    expect(merged.lines[0]!.approved!.quantity).toBe(8);
    expect(merged.lines[0]!.checked).toBe(false);
    expect(merged.lines[0]!.issues.join(" ")).toContain(
      "Fresh reading proposes 10",
    );
    expect(merged.documentChecked).toBe(false);
  });
  it("requires manual reconciliation when multiple new rows describe an already received item", () => {
    const previous = draft().review;
    previous.lines[0]!.approved = {
      itemId: id,
      quantity: 8,
      kind: "delivery",
      by: "reviewer",
      at: "2026-10-20T00:00:00Z",
    };
    const fresh = draft({
      ...result,
      lines: [
        result.lines[0]!,
        {
          ...result.lines[0]!,
          lineId: "two",
          box: null,
          evidence: "Additional source row",
        },
      ],
    }).review;
    const merged = mergeTrialDraft(previous, fresh);
    expect(merged.lines).toHaveLength(1);
    expect(merged.lines[0]!.issues.join(" ")).toContain(
      "cannot be paired safely",
    );
  });
});

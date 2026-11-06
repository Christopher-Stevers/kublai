import type { ReceiptOrderItem, SlipAnalysis } from "./packing-slip-review";
import { describe, it, expect } from "vitest";
import {
  autoConfirmsLine,
  convertedOrderedQuantity,
  normalizeOrderedQuantity,
  receiptDelta,
  duplicateEvidence,
  hasReturnEvidence,
  initialReview,
  readyLine,
  defaultReviewUnit,
} from "./receiving-review";
describe("receiving accounting", () => {
  it("keeps return credit separate from physical receiving", () => {
    expect(receiptDelta("delivery", 6)).toEqual({ received: 6, credit: 0 });
    expect(receiptDelta("return-replacement", 2)).toEqual({
      received: -2,
      credit: 0,
    });
    expect(receiptDelta("return-credit", 2)).toEqual({
      received: -2,
      credit: 2,
    });
    expect(receiptDelta("credit-only", 2)).toEqual({ received: 0, credit: 2 });
  });
  it("applies a correction as the difference, not another receipt", () => {
    const before = {
      quantity: 6,
      itemId: "a",
      kind: "delivery" as const,
      by: "u",
      at: "now",
    };
    expect(receiptDelta("delivery", 8, before)).toEqual({
      received: 2,
      credit: 0,
    });
    expect(receiptDelta("delivery", 6, before)).toEqual({
      received: 0,
      credit: 0,
    });
  });
  it("rejects invalid amounts", () => {
    for (const n of [-1, NaN, Infinity, 1000000, 0.1234567])
      expect(() => receiptDelta("delivery", n)).toThrow();
  });
  it("recognizes return headers", () => {
    expect(hasReturnEvidence("Packing List *** RETURN MERCH. ***")).toBe(true);
    expect(hasReturnEvidence("SHIP QTY\n-2.00 EA")).toBe(true);
    expect(hasReturnEvidence("Returns require authorization")).toBe(false);
  });
  it("requires unresolved quantity and unit to be checked", () => {
    const r = initialReview(undefined, "v", "u");
    expect(r.lines).toEqual([]);
    expect(
      readyLine({
        id: "1",
        page: 1,
        evidence: "x",
        description: "x",
        sku: "",
        unit: "ea",
        quantity: 2,
        ordered: 2,
        unitPrice: null,
        orderItemId: "i",
        issues: ["unclear"],
      }),
    ).toBe(false);
  });
  it("flags identical files before any order match", () => {
    expect(duplicateEvidence({ hash: "same" }, { hash: "same" })).toContain(
      "identical",
    );
  });
  it("does not mistake supplier order numbers for delivery identity", () => {
    const r = initialReview(undefined, "v", "u");
    r.supplierId = "s";
    r.supplierOrderNumber = "123";
    expect(
      duplicateEvidence(
        { hash: "a", review: r },
        { hash: "b", review: { ...r } },
      ),
    ).toBe(null);
  });
});


it("defaults an omitted reviewer unit to the matched order without changing quantity", () => {
  const line = { id: "1", page: 1, evidence: "valve 5", description: "valve", sku: "", unit: "", quantity: 5, ordered: 5, unitPrice: null, orderItemId: "i", issues: ["Quantity unit is not printed. Confirm the unit before receiving."] };
  defaultReviewUnit(line, "ea");
  expect(line.unit).toBe("ea");
  expect(line.quantity).toBe(5);
  expect(readyLine(line)).toBe(true);
});
it("preserves explicit units and unrelated quantity warnings", () => {
  const line = { id: "1", page: 1, evidence: "pipe", description: "pipe", sku: "", unit: "ft", quantity: 5, ordered: 5, unitPrice: null, orderItemId: "i", issues: ["Check shipped quantity against the slip; the print is unclear."] };
  defaultReviewUnit(line, "ea");
  expect(line.unit).toBe("ft");
  expect(readyLine(line)).toBe(false);
  line.unit = "";
  defaultReviewUnit(line, "ea");
  expect(readyLine(line)).toBe(false);
});


describe("saved reader auto-confirmation", () => {
  function fixture() {
    const item: ReceiptOrderItem = {
      id: "item",
      description: "Valve",
      sku: null,
      aliases: [],
      ordered: 10,
      received: 2,
      verificationStatus: "partial",
      unit: "ea",
      piecesPerPack: null,
      individualUnit: null,
    };
    const analysis: SlipAnalysis = {
      runId: "run",
      versionId: "v",
      status: "ready",
      startedAt: "now",
      items: [item],
      warnings: [],
      lines: [
        {
          page: 1,
          evidence: "6 EA Valve",
          orderItemId: "item",
          shipped: 6,
          backordered: null,
          unit: "ea",
          proposed: 6,
          issues: ["Check quantity"],
          readings: [
            {
              reader: "ocr",
              shipped: null,
              unit: "ea",
              orderItemId: "item",
              match: 0.95,
              quantity: 0,
            },
            {
              reader: "jev",
              shipped: 6,
              unit: "ea",
              orderItemId: "item",
              match: 0.9,
              quantity: 0.9,
            },
            {
              reader: "terra",
              shipped: 6,
              unit: "ea",
              orderItemId: "item",
              match: 0.7,
              quantity: 0.99,
            },
          ],
        },
      ],
    };
    const review = initialReview(analysis, "v", "u");
    const line = review.lines[0]!;
    const qualifies = () =>
      autoConfirmsLine(line, review, analysis, "v", [item]);
    return {
      item,
      analysis,
      review,
      line,
      qualifies,
      readings: analysis.lines[0]!.readings!,
    };
  }
  it("uses saved Astra confidence for imported readings without rerunning a model", () => {
    const f = fixture();
    delete f.analysis.lines[0]!.readings;
    delete f.analysis.lines[0]!.confidenceDetails;
    f.review.sourceTrial = {runId: "saved-trial", reader: "astra"};
    const score = (value: number) => ({value, basis: "self_assessed" as const, reason: "Saved original result"});
    f.line.predictionSource = {trialRunId: "saved-trial", reader: "astra", lineId: "p1-l1", artifactSha256: "a".repeat(64), confidence: {part: score(.96), match: score(.93), quantity: score(.96), overall: score(.93)}};
    expect(f.qualifies()).toBe(true);
    f.line.predictionSource.confidence.quantity.value = .89;
    expect(f.qualifies()).toBe(false);
    f.line.predictionSource.confidence.quantity.value = .96;
    f.line.quantity = 7;
    expect(f.qualifies()).toBe(false);
    f.line.quantity = 6;
    f.line.humanEdited = true;
    expect(f.qualifies()).toBe(false);
    f.line.humanEdited = false;
    f.line.predictionSource.trialRunId = "different-trial";
    expect(f.qualifies()).toBe(false);
    f.line.predictionSource.trialRunId = "saved-trial";
    f.line.predictionSource.reader = "terra";
    expect(f.qualifies()).toBe(false);
  });
  it("accepts exactly 90% from one reader despite weaker or conflicting readers", () => {
    const f = fixture();
    f.readings[2]!.shipped = 8;
    expect(f.qualifies()).toBe(true);
    expect(f.line.checked).toBe(false);
    expect(f.line.approved).toBeUndefined();
    expect(readyLine({ ...f.line, autoConfirmed: f.qualifies() })).toBe(true);
  });
  it("does not round up or combine the part score of one reader with another's quantity score", () => {
    const f = fixture();
    f.readings[1]!.quantity = 0.8999;
    expect(f.qualifies()).toBe(false);
    f.readings[1]!.quantity = 0.99;
    f.readings[1]!.match = 0.8999;
    expect(f.qualifies()).toBe(false);
  });
  it("requires the confident reading to support the current part and amount", () => {
    const f = fixture();
    f.readings[1]!.shipped = 8;
    expect(f.qualifies()).toBe(false);
    f.readings[1]!.shipped = 6;
    f.readings[1]!.orderItemId = "other";
    expect(f.qualifies()).toBe(false);
  });
  it("compares converted packaging quantities in the order's unit", () => {
    const f = fixture();
    f.item.unit = f.line.unit = "box";
    f.item.individualUnit = "ea";
    f.item.piecesPerPack = 10;
    f.line.quantity = 6;
    f.readings[1]!.shipped = 60;
    f.readings[1]!.unit = "pcs";
    expect(f.qualifies()).toBe(true);
    f.line.quantity = 60;
    expect(f.qualifies()).toBe(false);
  });
  it("supports saved reviews without readingSource and single-reader analyses", () => {
    const f = fixture();
    delete f.line.readingSource;
    delete f.analysis.lines[0]!.readings;
    f.analysis.lines[0]!.confidenceDetails = {
      part: 0.9,
      quantity: 0.9,
      basis: "model_estimate",
    };
    expect(f.qualifies()).toBe(true);
  });
  it.each(["processing", "failed", "cleared"] as const)(
    "does not trust %s evidence",
    (status) => {
      const f = fixture();
      f.analysis.status = status;
      expect(f.qualifies()).toBe(false);
    },
  );
  it("requires matching source version, run, unit and linked order item", () => {
    for (const change of [
      (f: ReturnType<typeof fixture>) => {
        f.review.versionId = "old";
      },
      (f: ReturnType<typeof fixture>) => {
        f.analysis.versionId = "old";
      },
      (f: ReturnType<typeof fixture>) => {
        f.review.analysisRunId = "old";
      },
      (f: ReturnType<typeof fixture>) => {
        f.line.readingSource!.analysisRunId = "old";
      },
      (f: ReturnType<typeof fixture>) => {
        f.line.unit = "ft";
      },
      (f: ReturnType<typeof fixture>) => {
        f.line.orderItemId = "other";
      },
    ]) {
      const f = fixture();
      change(f);
      expect(f.qualifies()).toBe(false);
    }
  });
  it("preserves human changes, excluded lines and already posted receipts", () => {
    const f = fixture();
    f.line.humanEdited = true;
    expect(f.qualifies()).toBe(false);
    f.line.humanEdited = false;
    f.line.ignored = { by: "u", at: "now", reason: "not delivered" };
    expect(f.qualifies()).toBe(false);
    delete f.line.ignored;
    f.line.approved = {
      quantity: 6,
      itemId: "item",
      kind: "delivery",
      by: "u",
      at: "now",
    };
    expect(f.qualifies()).toBe(false);
  });
  it.each([null, NaN, Infinity, 0.89, 90])(
    "rejects invalid or insufficient reader confidence %s",
    (value) => {
      const f = fixture();
      f.readings[1]!.quantity = value;
      expect(f.qualifies()).toBe(false);
    },
  );
});


describe("ordered counts during pack conversion", () => {
  it("converts a partial shipment's ordered and delivered counts by the same factor", () => {
    expect(convertedOrderedQuantity(300, 200, 2)).toBe(3);
    expect(convertedOrderedQuantity(2500, 2500, 1)).toBe(1);
    expect(convertedOrderedQuantity(3, 2, 200)).toBe(300);
    expect(convertedOrderedQuantity(null, 200, 2)).toBeNull();
    expect(convertedOrderedQuantity(300, 0, 2)).toBe(300);
    expect(convertedOrderedQuantity(300, 200, 0)).toBe(300);
  });
  function fixture() {
    const item: ReceiptOrderItem = {
      id: "i",
      description: "Clips (Box of 100)",
      aliases: [],
      sku: null,
      unit: "box",
      piecesPerPack: 100,
      individualUnit: "pcs",
      ordered: 3,
      received: 0,
      verificationStatus: "pending",
    };
    const source: SlipAnalysis["lines"][number] = {
      page: 1,
      evidence: "order 300; ship 200; unit not printed",
      orderItemId: "i",
      ordered: 300,
      shipped: 200,
      proposed: null,
      backordered: 100,
      unit: null,
      issues: [],
    };
    const draft = {
      id: "l",
      page: 1,
      sourceIndex: 0,
      description: "Clips",
      evidence: source.evidence,
      sku: "",
      ordered: 300,
      quantity: 2,
      unit: "box",
      unitPrice: null,
      orderItemId: "i",
      issues: [],
      checked: true,
    };
    return { item, source, draft };
  }
  it("repairs a saved converted line once, preserving approved receipt quantities", () => {
    const f = fixture();
    Object.assign(f.draft, {
      approved: {
        quantity: 2,
        kind: "delivery",
        itemId: "i",
        by: "u",
        at: "now",
      },
    });
    normalizeOrderedQuantity(f.draft, f.source, f.item);
    expect(f.draft.ordered).toBe(3);
    expect(f.draft.quantity).toBe(2);
    expect(f.draft).toMatchObject({ approved: { quantity: 2 } });
    normalizeOrderedQuantity(f.draft, f.source, f.item);
    expect(f.draft.ordered).toBe(3);
  });
  it("converts the ordered count when preparing a draft with an already-converted proposal", () => {
    const f = fixture();
    f.source.proposed = 2;
    const analysis: SlipAnalysis = {
      runId: "r",
      versionId: "v",
      status: "ready",
      startedAt: "now",
      items: [f.item],
      lines: [f.source],
      warnings: [],
    };
    expect(initialReview(analysis, "v", "u").lines[0]).toMatchObject({
      ordered: 3,
      quantity: 2,
      unit: "box",
    });
    expect(analysis.lines[0]!.ordered).toBe(300);
  });
  it("preserves corrected ordered counts, unconverted quantities and explicit box readings", () => {
    const f = fixture();
    f.draft.ordered = 4;
    normalizeOrderedQuantity(f.draft, f.source, f.item);
    expect(f.draft.ordered).toBe(4);
    f.draft.ordered = 300;
    f.draft.quantity = 200;
    normalizeOrderedQuantity(f.draft, f.source, f.item);
    expect(f.draft.ordered).toBe(300);
    f.draft.quantity = 2;
    f.source.unit = "box";
    normalizeOrderedQuantity(f.draft, f.source, f.item);
    expect(f.draft.ordered).toBe(300);
  });
});

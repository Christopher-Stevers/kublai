import type { ReceiptOrderItem, SlipAnalysis } from "./packing-slip-review";
import { describe, it, expect } from "vitest";
import {
  autoConfirmsLine,
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

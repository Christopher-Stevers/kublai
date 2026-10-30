import { describe, it, expect } from "vitest";
import {
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

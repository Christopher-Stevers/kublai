import { describe, expect, it } from "vitest";
import { createMaterialListSummaries } from "./material-list-summary";
const item = {
  quoteId: "q",
  partDefinitionId: "p",
  supplierId: "s",
  supplierName: "Supplier",
  sentOrderId: "o",
  quantity: "100",
  sentQuantity: "100",
  receivedQuantity: "25",
  sentOrderStatus: "sent",
  sentAt: "today",
  verificationStatus: "partial",
};
const order = {
  id: "o",
  materialListId: "l",
  orderNumber: "155-Supplier",
  supplierId: "s",
  status: "sent",
  sentAt: "today",
};
const counts = {
  itemCount: 1,
  completeItemCount: 0,
  verifiedItemCount: 1,
  orderedQuantity: 100,
  receivedQuantity: 25,
};
describe("shared material list summary", () => {
  it("keeps partial delivery distinct from verification and weights all stages", () => {
    const summary = createMaterialListSummaries(
      [item],
      [order],
      new Map([["o", counts]]),
    )({ id: "l", quoteId: "q" });
    expect(summary).toMatchObject({
      totalSupplierCount: 1,
      sentSupplierCount: 1,
      verifiedSupplierCount: 1,
      orderNumbers: ["155-Supplier"],
    });
    expect(summary.overallProgress).toBeCloseTo(125 / 3);
    expect(summary.orderStatuses[0]).toMatchObject({
      complete: false,
      deliveredPercent: 25,
      state: "sent",
    });
  });
  it("does not count a previously sent cancelled order, and restores its potential supplier", () => {
    const summary = createMaterialListSummaries(
      [{ ...item, sentOrderStatus: "cancelled" }],
      [{ ...order, status: "cancelled" }],
      new Map([["o", counts]]),
    )({ id: "l", quoteId: "q" });
    expect(summary).toMatchObject({
      sentSupplierCount: 0,
      verifiedSupplierCount: 0,
      orderNumbers: [],
      overallProgress: 0,
    });
    expect(summary.orderStatuses).toEqual([
      expect.objectContaining({ state: "potential", number: "Supplier" }),
    ]);
  });
  it("keeps tool-room requests and unrelated lists separate", () => {
    const summarize = createMaterialListSummaries(
      [
        { ...item, supplierId: null, sentOrderId: null },
        { ...item, quoteId: "other", supplierId: "other" },
      ],
      [],
      new Map(),
    );
    expect(summarize({ id: "l", quoteId: "q", kind: "tools" })).toMatchObject({
      totalSupplierCount: 1,
      orderStatuses: [{ number: "Tool Room", state: "potential" }],
    });
    expect(summarize({ id: "empty", quoteId: null })).toMatchObject({
      totalSupplierCount: 0,
      orderStatuses: [],
    });
  });
  it("excludes non-part lines and unknown suppliers from supplier counts", () => {
    const summary = createMaterialListSummaries(
      [
        { ...item, supplierId: null },
        { ...item, partDefinitionId: null, supplierId: "note" },
      ],
      [],
      new Map(),
    )({ id: "l", quoteId: "q" });
    expect(summary.totalSupplierCount).toBe(0);
    expect(summary.orderStatuses).toEqual([]);
  });
});

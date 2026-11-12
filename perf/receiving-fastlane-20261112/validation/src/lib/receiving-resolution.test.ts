import { describe, expect, it } from "vitest";
import type { ReceiptOrderItem } from "./packing-slip-review";
import { readyLine, type ReceivingLine } from "./receiving-review";
import {
  assertAllocation,
  invalidateResolution,
  newResolution,
  receivedLineQuantity,
  receivingLineReady,
  resolutionBlockers,
  resolutionCounterpartFingerprint,
  resolutionEvidenceFingerprint,
} from "./receiving-resolution";
const line = (): ReceivingLine => ({
  id: "a",
  page: 1,
  evidence: "Valve 10 EA",
  description: "Valve",
  sku: "V",
  unit: "ea",
  quantity: 10,
  ordered: 10,
  unitPrice: null,
  orderItemId: "item",
  issues: ["Check specification"],
  checked: true,
});
const item: ReceiptOrderItem = {
  id: "item",
  description: "Valve",
  sku: "V",
  aliases: [],
  ordered: 10,
  received: 0,
  verificationStatus: "pending",
  unit: "ea",
  piecesPerPack: null,
  individualUnit: null,
};
function resolved() {
  const l = line();
  l.resolution = {
    ...newResolution(l, "u", "now"),
    counterpartFingerprint: resolutionCounterpartFingerprint(item),
    match: "confirmed",
    specification: "confirmed",
    quantity: "confirmed",
    delivery: "confirmed",
  };
  return l;
}
describe("independent receiving resolutions", () => {
  it("keeps an unconverted or missing order unit out of the ready-to-approve count", () => {
    const l = line();
    expect(receivingLineReady(l, "delivery", item)).toBe(true);
    expect(receivingLineReady(l, "delivery", { ...item, unit: "box", piecesPerPack: 100 })).toBe(false);
    expect(receivingLineReady(l, "delivery")).toBe(false);
    l.unit = "each";
    expect(receivingLineReady(l, "delivery", item)).toBe(true);
    l.unit = "";
    expect(receivingLineReady(l, "delivery", item)).toBe(true);
    expect(receivingLineReady(l, "delivery", { ...item, unit: "box", piecesPerPack: 100 })).toBe(false);
  });
  it("invalidates counterpart specification or packaging edits but not routine received progress", () => {
    const l = resolved();
    expect(
      resolutionBlockers(l, {
        ...item,
        description: "Valve with a different rating",
      }).some((p) => p.includes("order item or package changed")),
    ).toBe(true);
    expect(
      resolutionBlockers(l, { ...item, piecesPerPack: 10 }).some((p) =>
        p.includes("order item or package changed"),
      ),
    ).toBe(true);
    expect(resolutionCounterpartFingerprint({ ...item, received: 4 })).toBe(
      resolutionCounterpartFingerprint(item),
    );
  });
  it("matching alone never clears specification, quantity or delivery", () => {
    const l = line();
    l.resolution = newResolution(l, "u", "now");
    l.resolution.match = "confirmed";
    expect(resolutionBlockers(l)).toHaveLength(3);
    expect(readyLine(l)).toBe(false);
  });
  it("skip blocks checked and highly confident lines until explicitly resumed", () => {
    const l = resolved();
    l.autoConfirmed = true;
    l.resolution!.skipped = true;
    expect(readyLine(l)).toBe(false);
    l.resolution!.skipped = false;
    expect(readyLine(l)).toBe(true);
  });
  it.each(["description", "sku", "unit", "orderItemId"] as const)(
    "invalidates decisions if %s changes",
    (key) => {
      const l = resolved();
      l[key] = "different";
      expect(resolutionBlockers(l)[0]).toContain("changed");
      invalidateResolution(l);
      expect(l.resolution!.match).toBe("unresolved");
      expect(l.checked).toBe(false);
    },
  );
  it("keeps paper and site counts separate, receiving only the accepted quantity", () => {
    const l = resolved();
    l.resolution = {
      ...l.resolution!,
      delivery: "damaged",
      siteQuantity: 10,
      acceptedQuantity: 8,
      remainder: "backordered",
      note: "Two valves damaged; replacement requested",
    };
    expect(l.quantity).toBe(10);
    expect(receivedLineQuantity(l)).toBe(8);
    expect(resolutionBlockers(l, item)).toEqual([]);
    l.resolution.acceptedQuantity = 11;
    expect(resolutionBlockers(l, item)).toContain(
      "The accepted quantity cannot exceed the actual site count.",
    );
  });
  it("requires delivery issue when actual count differs from paper", () => {
    const l = resolved();
    l.resolution!.siteQuantity = 9;
    expect(resolutionBlockers(l)).toContain(
      "The site count differs from the paper quantity. Record the delivery issue.",
    );
  });
  it("does not quietly receive a rejected substitute", () => {
    const l = resolved();
    l.resolution = {
      ...l.resolution!,
      specification: "substitution-rejected",
      delivery: "wrong",
      siteQuantity: 10,
      acceptedQuantity: 10,
      note: "Wrong rating",
    };
    expect(resolutionBlockers(l).length).toBeGreaterThan(0);
    l.resolution.acceptedQuantity = 0;
    expect(resolutionBlockers(l)).toEqual([]);
    expect(readyLine(l)).toBe(true);
  });
  it("lets a short line through without a remainder decision but cannot cancel an order by receipt", () => {
    const l = resolved();
    l.quantity = 6;
    l.resolution!.evidenceFingerprint = resolutionEvidenceFingerprint(l);
    // The four still stay outstanding on the order; nothing more is asked.
    expect(resolutionBlockers(l, item)).toEqual([]);
    expect(receivingLineReady(l, "delivery", item)).toBe(true);
    l.resolution!.remainder = "unexplained";
    l.resolution!.note = "Supplier did not say";
    expect(resolutionBlockers(l, item)).toEqual([]);
    l.resolution!.remainder = "cancelled";
    l.resolution!.note = "Supplier cancelled remainder";
    expect(resolutionBlockers(l, item)).toEqual([
      "Cancellation is recorded; an authorized order correction is still required.",
    ]);
    l.resolution!.remainder = "backordered";
    expect(resolutionBlockers(l, item)).toEqual([]);
  });
  it("keeps blocking an excess, a bad count and a wrong part on a short order", () => {
    const over = resolved();
    over.quantity = 12;
    over.resolution!.evidenceFingerprint = resolutionEvidenceFingerprint(over);
    expect(resolutionBlockers(over, item)).toContain(
      "Accept the excess explicitly, or exclude the quantity being returned from the accepted count.",
    );
    const count = resolved();
    count.quantity = 6;
    count.resolution!.evidenceFingerprint = resolutionEvidenceFingerprint(count);
    count.resolution!.siteQuantity = -1;
    expect(resolutionBlockers(count, item)).toContain("Enter a valid actual site count.");
    const wrong = resolved();
    wrong.resolution = { ...wrong.resolution!, delivery: "wrong", siteQuantity: 10, note: "Wrong valve" };
    expect(resolutionBlockers(wrong, item)).toContain(
      "Accept the substitution explicitly, or record zero accepted for the wrong part.",
    );
  });
  it("totals several printed lines for the same ordered item without inventing shortages", () => {
    const a = resolved(),
      b = resolved();
    a.quantity = 4;
    b.quantity = 6;
    b.id = "b";
    for (const l of [a, b])
      l.resolution!.evidenceFingerprint = resolutionEvidenceFingerprint(l);
    expect(resolutionBlockers(a, item, [a, b])).toEqual([]);
    expect(resolutionBlockers(b, item, [a, b])).toEqual([]);
  });
  it("keeps excess returning quantities out of accepted receipt totals", () => {
    const l = resolved();
    l.quantity = 12;
    l.resolution = {
      ...l.resolution!,
      evidenceFingerprint: resolutionEvidenceFingerprint(l),
      delivery: "extra",
      siteQuantity: 12,
      acceptedQuantity: 10,
      excess: "return",
      note: "Two extra returned",
    };
    expect(receivedLineQuantity(l)).toBe(10);
    expect(resolutionBlockers(l, item)).toEqual([]);
    l.resolution.acceptedQuantity = 12;
    expect(resolutionBlockers(l, item)).toHaveLength(1);
    l.resolution.excess = "accepted";
    expect(resolutionBlockers(l, item)).toEqual([]);
  });
});
describe("allocation conservation", () => {
  it("allows splits and merges with exactly conserved quantities", () => {
    expect(() =>
      assertAllocation(
        [line()],
        [
          { quantity: 4, unit: "ea" },
          { quantity: 6, unit: "pcs" },
        ],
      ),
    ).not.toThrow();
    expect(() =>
      assertAllocation(
        [line(), { ...line(), id: "b" }],
        [{ quantity: 20, unit: "ea" }],
      ),
    ).not.toThrow();
  });
  it("rejects duplication, quantity inflation, implicit conversions, and approved source rows", () => {
    expect(() =>
      assertAllocation([line(), line()], [{ quantity: 20, unit: "ea" }]),
    ).toThrow("distinct");
    expect(() =>
      assertAllocation([line()], [{ quantity: 11, unit: "ea" }]),
    ).toThrow("add up");
    expect(() =>
      assertAllocation([line()], [{ quantity: 10, unit: "box" }]),
    ).toThrow("same unit");
    expect(() =>
      assertAllocation(
        [
          {
            ...line(),
            approved: {
              quantity: 10,
              itemId: "item",
              kind: "delivery",
              by: "u",
              at: "now",
            },
          },
        ],
        [{ quantity: 10, unit: "ea" }],
      ),
    ).toThrow("unapproved");
    expect(() =>
      assertAllocation(
        [line(), { ...line(), id: "b", kind: "delivery" }],
        [{ quantity: 20, unit: "ea" }],
        "return-replacement",
      ),
    ).toThrow("cannot be combined");
  });
});
it("accepts a line where nothing came without a backorder decision", () => {
  const l = line();
  l.quantity = 0;
  l.resolution = { ...newResolution(l, "u", "now"),
    counterpartFingerprint: resolutionCounterpartFingerprint(item),
    match: "confirmed", specification: "confirmed", quantity: "confirmed",
    delivery: "short", siteQuantity: 0, acceptedQuantity: 0, note: "Nothing delivered on this slip." };
  expect(resolutionBlockers(l, item, [l], "delivery")).toEqual([]);
  expect(receivingLineReady(l, "delivery", item)).toBe(true);
});
it("accepts an explicitly confirmed full backorder without receiving any goods", () => {
  const l = line();
  l.quantity = 0;
  l.resolution = { ...newResolution(l, "u", "now"),
    counterpartFingerprint: resolutionCounterpartFingerprint(item),
    match: "confirmed", specification: "confirmed", quantity: "confirmed",
    delivery: "short", siteQuantity: 0, acceptedQuantity: 0, remainder: "backordered", note: "Full quantity confirmed backordered" };
  expect(resolutionBlockers(l, item, [l], "delivery")).toEqual([]);
  expect(readyLine(l)).toBe(true);
  expect(receivedLineQuantity(l)).toBe(0);
  expect(item.received).toBe(0);
});

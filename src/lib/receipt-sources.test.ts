import { describe, expect, it } from "vitest";
import { dueWithHandCount, slipReceipts } from "./receipt-sources";

type Doc = Parameters<typeof slipReceipts>[0][number];
const line = (
  itemId: string,
  quantity: number,
  kind: "delivery" | "return-credit" = "delivery",
  at = "2026-11-01T10:00:00Z",
) => ({ approved: { itemId, quantity, kind, by: "u1", at } });
const slip = (id: string, lines: unknown[], applied?: unknown) =>
  ({
    id,
    receivingReview: { lines },
    packingSlipAnalysis: applied ? { applied } : null,
  }) as unknown as Doc;

describe("slipReceipts", () => {
  it("sums each slip's approved lines by item, returns counting against it", () => {
    const receipts = slipReceipts([
      slip("a", [
        line("i1", 4),
        line("i1", 2, "delivery", "2026-11-02T10:00:00Z"),
        line("i2", 1, "return-credit"),
        { approved: undefined },
      ]),
      slip("b", [line("i1", 3)]),
    ]);
    expect(receipts.get("i1")).toEqual([
      { documentId: "a", quantity: 6, by: "u1", at: "2026-11-02T10:00:00Z" },
      { documentId: "b", quantity: 3, by: "u1", at: "2026-11-01T10:00:00Z" },
    ]);
    expect(receipts.get("i2")).toEqual([
      expect.objectContaining({ documentId: "a", quantity: -1 }),
    ]);
  });

  it("reads a slip approved before reviews had lines from its confirmation", () => {
    const applied = {
      at: "2026-10-01T10:00:00Z",
      by: "u2",
      quantities: { i1: 5, i2: 0 },
    };
    const receipts = slipReceipts([slip("old", [], applied)]);
    expect(receipts.get("i1")).toEqual([
      { documentId: "old", quantity: 5, by: "u2", at: applied.at },
    ]);
    expect(receipts.has("i2")).toBe(false);
    // A review with approved lines also writes the confirmation; count once.
    expect(
      slipReceipts([slip("new", [line("i1", 5)], applied)]).get("i1"),
    ).toHaveLength(1);
  });

  it("skips corrections to zero", () => {
    expect(slipReceipts([slip("a", [line("i1", 0)])]).has("i1")).toBe(false);
  });
});

describe("dueWithHandCount", () => {
  const item = { ordered: 10, received: 10 };
  it("puts back what a slip takes over from the hand count", () => {
    expect(dueWithHandCount(item, 10, 10)).toEqual({ linked: 10, due: 10 });
    expect(dueWithHandCount(item, 10, 4)).toEqual({ linked: 4, due: 4 });
    expect(dueWithHandCount({ ordered: 10, received: 7 }, 3, 10)).toEqual({
      linked: 3,
      due: 6,
    });
  });
  it("leaves the due alone without a hand count", () => {
    expect(dueWithHandCount({ ordered: 10, received: 4 }, 0, 9)).toEqual({
      linked: 0,
      due: 6,
    });
  });
});

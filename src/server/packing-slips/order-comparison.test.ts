import { expect, it } from "vitest";
import { comparisonRows } from "./order-comparison";
import { comparisonDates } from "~/lib/order-match-comparison";
import type { ReceiptOrderItem, SlipLine } from "~/lib/packing-slip-review";
const item: ReceiptOrderItem = {
  id: "i",
  description: "Rod hanger",
  sku: "RH25",
  aliases: [],
  ordered: 10,
  originalOrdered: 10,
  received: 0,
  verificationStatus: "pending",
  unit: "box",
  piecesPerPack: 25,
  individualUnit: "ea",
};
const line: SlipLine = {
  page: 1,
  evidence: "250 ROD HANGER",
  description: "Rod hanger",
  orderItemId: "i",
  shipped: 250,
  backordered: 0,
  unit: null,
  proposed: 250,
  issues: [],
};
it("preserves printed quantities and missing units instead of inferring a pack conversion", () => {
  const before = JSON.stringify({ item, line });
  expect(comparisonRows([item], [line])).toEqual([
    {
      order: {
        description: "Rod hanger",
        quantity: 10,
        unit: "box",
        piecesPerPack: 25,
      },
      slip: { description: "Rod hanger", quantity: 250, unit: null },
    },
  ]);
  expect(JSON.stringify({ item, line })).toBe(before);
});
it("shows unmatched rows on both sides instead of implying an alignment", () => {
  const rows = comparisonRows(
    [item],
    [
      {
        ...line,
        description: "Electric drill",
        evidence: "Electric drill",
        orderItemId: "foreign",
      },
    ],
  );
  expect(rows).toHaveLength(2);
  expect(rows[0]?.order).toBeNull();
  expect(rows[1]?.slip).toBeNull();
});
it("aligns a different order locally from saved text", () => {
  const rows = comparisonRows(
    [{ ...item, id: "other" }],
    [{ ...line, sku: "RH25" }],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.order?.description).toBe("Rod hanger");
});
it.each([0, 1, 2, -1, -2, 3])(
  "highlights only same-day or one/two-day proximity (%s)",
  (offset) => {
    const result = comparisonDates("2026-10-25", `2026-10-${25 + offset}`);
    expect(result.close).toBe(Math.abs(offset) <= 2);
    expect(result.label).toBe(
      offset === 0
        ? "Same day"
        : `${Math.abs(offset)} ${Math.abs(offset) === 1 ? "day" : "days"} ${offset > 0 ? "after" : "before"} order`,
    );
  },
);
it("does not invent a date when it is missing or invalid", () => {
  expect(comparisonDates(null, "2026-02-31")).toMatchObject({
    close: false,
    label: null,
    order: "Not available",
    slip: "Not read",
  });
});

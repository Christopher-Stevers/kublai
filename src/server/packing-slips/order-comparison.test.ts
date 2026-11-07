import { expect, it } from "vitest";
import { lineScorer } from "./match";
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
it("keeps printed quantities and units, adding the pack reading the order fits", () => {
  const before = JSON.stringify({ item, line });
  expect(comparisonRows([item], [line])).toEqual([
    {
      matchScore: expect.any(Number),
      order: {
        description: "Rod hanger",
        quantity: 10,
        unit: "box",
        piecesPerPack: 25,
      },
      // 250 pieces is the 10 boxes of 25 ordered.
      slip: { description: "Rod hanger", quantity: 250, unit: null, inOrderUnit: 10 },
    },
  ]);
  expect(JSON.stringify({ item, line })).toBe(before);
});
it("reads a slip's 1000 EA as the 1 box of 1000 ordered", () => {
  const box = { ...item, ordered: 1, originalOrdered: 1, piecesPerPack: 1000 };
  const [row] = comparisonRows([box], [{ ...line, shipped: 1000, unit: "EA" }]);
  expect(row?.slip).toMatchObject({ quantity: 1000, unit: "EA", inOrderUnit: 1 });
  const [same] = comparisonRows([box], [{ ...line, shipped: 1, unit: "BX" }]);
  expect(same?.slip?.inOrderUnit).toBeNull();
});
it("finds a pack size written only in the description", () => {
  const screws = { ...item, description: "#8 x 1-1/4 deck screw 1000/BX", unit: "ea", piecesPerPack: null, ordered: 1, originalOrdered: 1 };
  const [row] = comparisonRows([screws], [{ ...line, shipped: 1000, unit: "EA" }]);
  expect(row?.order?.piecesPerPack).toBe(1000);
  expect(row?.slip?.inOrderUnit).toBe(1);
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

it("uses the existing local scorer for the displayed pair, without treating a saved link as certainty", () => {
  const expected = lineScorer([item])({
    code: "",
    text: `${line.description} ${line.evidence}`,
  })[0]!.score;
  expect(comparisonRows([item], [line])[0]!.matchScore).toBe(
    Math.round(expected * 100),
  );
  const unrelated = {
    ...line,
    description: "Electric drill",
    evidence: "Electric drill",
  };
  expect(comparisonRows([item], [unrelated])[0]!.matchScore).toBe(0);
});
it("scores missing sides as zero and keeps quantities separate from product similarity", () => {
  const unmatched = comparisonRows(
    [item],
    [
      {
        ...line,
        orderItemId: null,
        description: "Electric drill",
        evidence: "Electric drill",
      },
    ],
  );
  expect(unmatched.every((row) => row.matchScore === 0)).toBe(true);
  const original = comparisonRows([item], [line])[0]!;
  const changed = comparisonRows([item], [{ ...line, shipped: 999 }])[0]!;
  expect(changed.matchScore).toBe(original.matchScore);
  expect(changed.slip!.quantity).toBe(999);
});

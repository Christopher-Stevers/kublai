// @vitest-environment node
import { expect, it } from "vitest";
import {
  analyzeSlip,
  numberCandidates,
  explicitSlipUnit,
  type Evaluator,
} from "./analyze";
import {
  convertSlipQuantity,
  proposedReceipts,
  receiptIssues,
  type ReceiptOrderItem,
  type SlipAnalysis,
} from "~/lib/packing-slip-review";
import type { SlipRow } from "./ocr-rows";
const item: ReceiptOrderItem = {
  id: "a",
  description: "Brass valve",
  sku: "ABC123",
  aliases: [],
  ordered: 10,
  received: 2,
  verificationStatus: "partial",
  unit: "ea",
  piecesPerPack: null,
  individualUnit: null,
};
function row(texts: string[], y: number, confidence = 98): SlipRow {
  return {
    page: 1,
    text: texts.join(" "),
    words: texts.map((text, i) => ({
      text,
      x: [0.05, 0.2, 0.6, 0.7, 0.8, 0.9][i]!,
      y,
      width: 0.04,
      height: 0.02,
      confidence,
    })),
  };
}
const header = row(
  ["SKU", "Description", "Ordered", "Shipped", "Backordered", "Unit"],
  0.1,
);
const line = row(["ABC123", "Brass valve", "10", "6", "4", "ea"], 0.2);
const run: Evaluator = async (state, questions) => ({
  model: "fixture-only",
  answers: Object.fromEntries(
    Object.keys(questions).map((id) => [
      id,
      {
        type: "choice",
        confidence: 0.99,
        choice: (state as { rows: { text: string }[] }).rows[
          Number(id.split("_")[0])
        ]!.text.startsWith("SKU ")
          ? id.endsWith("_kind")
            ? "other"
            : "none"
          : id.endsWith("_kind")
            ? "item"
            : id.endsWith("_match")
              ? "none"
              : id.endsWith("_shipped")
                ? "n_1"
                : id.endsWith("_backordered")
                  ? "n_2"
                  : "ea",
      },
    ]),
  ),
});
it("copies shipped values, matches exact SKU, preserves backorders and converts explicit units", async () => {
  const result = await analyzeSlip([header, line], [item], run);
  expect(result.lines[0]).toMatchObject({
    orderItemId: "a",
    shipped: 6,
    backordered: 4,
    unit: "ea",
    proposed: 6,
  });
  expect(result.lines[0]!.notes).toContain("4 ea backordered on slip.");
  expect(explicitSlipUnit([header, line], line)).toBe("ea");
  expect(numberCandidates(line).map((n) => n.value)).toEqual([10, 6, 4]);
});
it("withholds unclear OCR and duplicate-page proposals", async () => {
  const uncertain = await analyzeSlip(
    [header, row(["ABC123", "Brass valve", "10", "6", "4", "ea"], 0.2, 40)],
    [item],
    run,
  );
  expect(uncertain.lines[0]!.proposed).toBeNull();
  const result = await analyzeSlip(
    [header, line, { ...line, page: 2 }],
    [item],
    run,
  );
  expect(result.lines.every((l) => l.proposed === null)).toBe(true);
  expect(result.lines[0]!.issues.some((i) => i.includes("Repeated"))).toBe(
    true,
  );
});
it("does not invent missing values or resolve duplicate SKU order lines", async () => {
  const result = await analyzeSlip(
    [header, line],
    [item, { ...item, id: "b" }],
    run,
  );
  expect(result.lines[0]!.orderItemId).toBeNull();
  expect(result.lines[0]!.proposed).toBeNull();
  const none: Evaluator = async (state, q) => ({
    model: "fixture",
    answers: Object.fromEntries(
      Object.keys(q).map((id) => [
        id,
        {
          type: "choice",
          confidence: 1,
          choice: (state as { rows: { text: string }[] }).rows[
            Number(id.split("_")[0])
          ]!.text.startsWith("SKU ")
            ? id.endsWith("_kind")
              ? "other"
              : "none"
            : id.endsWith("_kind")
              ? "item"
              : "none",
        },
      ]),
    ),
  });
  const missing = await analyzeSlip([line], [item], none);
  expect(missing.lines[0]!.shipped).toBeNull();
});
it("keeps pack quantities separate from pieces and refuses ambiguous EA on a pack", () => {
  const box = {
    ...item,
    unit: "box",
    piecesPerPack: 100,
    individualUnit: "pcs",
  };
  expect(convertSlipQuantity(200, "pcs", box)).toBe(2);
  expect(convertSlipQuantity(2, "boxes", box)).toBe(2);
  expect(convertSlipQuantity(2, "ea", box)).toBeNull();
  expect(convertSlipQuantity(20, null, box)).toBeNull();
  expect(convertSlipQuantity(30, "ft", box)).toBeNull();
  expect(convertSlipQuantity(-1, "box", box)).toBeNull();
  expect(receiptIssues(item, 6)[0]).toContain("2 ea");
  expect(receiptIssues(item, 10)[0]).toContain("Exceeds");
});
it("adds shipped rows only into proposals, not prior receipts", () => {
  const analysis = {
    items: [item],
    lines: [
      { orderItemId: "a", proposed: 2 },
      { orderItemId: "a", proposed: 3 },
      { orderItemId: "a", proposed: null },
    ],
  } as SlipAnalysis;
  expect(proposedReceipts(analysis)).toEqual({ a: 5 });
});

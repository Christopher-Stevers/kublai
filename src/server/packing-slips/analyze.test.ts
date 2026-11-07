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
  orderPack,
  packSizesIn,
  proposedReceipts,
  readSlipQuantity,
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
it("reads a slip counting the pieces of a box of 1000 against the box ordered", async () => {
  const box = { ...item, ordered: 1, received: 0, unit: "box", piecesPerPack: 1000, individualUnit: "pcs" };
  const pieces = row(["ABC123", "Brass valve", "1000", "1000", "0", "ea"], 0.2);
  const result = await analyzeSlip([header, pieces], [box], run);
  expect(result.lines[0]).toMatchObject({ orderItemId: "a", shipped: 1000, unit: "ea", proposed: 1, issues: [] });
  expect(result.lines[0]!.notes).toContain("Slip counts pieces: 1000 ea = 1 box (1000 per box).");
  expect(result.lines[0]!.notes!.join(" ")).not.toContain("Slip shows");
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
it("keeps pack quantities separate from pieces and reads EA on a pack by what the order fits", () => {
  const box = {
    ...item,
    unit: "box",
    piecesPerPack: 100,
    individualUnit: "pcs",
  };
  expect(convertSlipQuantity(200, "pcs", box)).toBe(2);
  expect(convertSlipQuantity(2, "boxes", box)).toBe(2);
  // 2 boxes fits an order of 10; 0.02 of a box does not.
  expect(convertSlipQuantity(2, "ea", box)).toBe(2);
  // 800 pieces is the 8 boxes still due, 1000 the 10 ordered.
  expect(convertSlipQuantity(800, "ea", box)).toBe(8);
  expect(convertSlipQuantity(1000, "EA", box)).toBe(10);
  // 1 box of 2 or 2 boxes: both fit an order of 3, so someone checks.
  expect(convertSlipQuantity(2, "ea", { ...box, ordered: 3, received: 0, piecesPerPack: 2 })).toBeNull();
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

it("reports real processing stages and leaves final duplicate checks authoritative", async () => {
  const progress: import("~/lib/packing-slip-review").SlipProgress[] = [];
  const result = await analyzeSlip([header, line], [item], run, {pages: [], onProgress: async value => { progress.push(structuredClone(value)); }});
  expect(progress[0]?.stage).toBe("matching");
  expect(progress.at(-1)?.stage).toBe("checking");
  expect(progress.at(-1)?.lines).toEqual(result.lines);
});

it("reads 1000 EA on a slip as the one box of 1000 ordered", () => {
  const box = { ...item, ordered: 1, received: 0, unit: "box", piecesPerPack: 1000, individualUnit: "pcs" };
  expect(readSlipQuantity(1000, "EA", box)).toEqual({
    amount: 1,
    note: "Slip counts pieces: 1000 EA = 1 box (1000 per box).",
  });
  expect(readSlipQuantity(1, "EA", box)).toEqual({
    amount: 1,
    note: "Slip's 1 EA counts whole box, not pieces.",
  });
  expect(convertSlipQuantity(1, "BX", box)).toBe(1);
  // More than ordered either way: left for a person.
  expect(convertSlipQuantity(5000, "EA", box)).toBeNull();
});

it("uses a pack size written in the description when the catalogue has none", () => {
  const screws = { ...item, description: "#8 x 1-1/4 deck screw 1000/BX", ordered: 1, received: 0 };
  expect(orderPack(screws)).toBe(1000);
  expect(convertSlipQuantity(1000, "EA", screws)).toBe(1);
  expect(convertSlipQuantity(1, "BX", screws)).toBe(1);
  // Ordered as pieces: the slip's box is a thousand of them.
  const pieces = { ...screws, ordered: 1000 };
  expect(convertSlipQuantity(1, "BX", pieces)).toBe(1000);
  expect(convertSlipQuantity(1000, "EA", pieces)).toBe(1000);
  // The slip's own description can say it too.
  expect(convertSlipQuantity(1000, "EA", { ...item, ordered: 1, received: 0 }, "DECK SCREW BOX OF 1000")).toBe(1);
  // Without a pack size, nothing changes.
  expect(convertSlipQuantity(1000, "EA", { ...item, ordered: 1, received: 0 })).toBe(1000);
});

it("finds pack sizes in descriptions without taking dimensions for them", () => {
  expect(packSizesIn("SCREW 1000/BX")).toEqual([1000]);
  expect(packSizesIn("Hanger (100 pieces per box)")).toEqual([100]);
  expect(packSizesIn("BOX OF 250")).toEqual([250]);
  expect(packSizesIn("Wire nut 100PK")).toEqual([100]);
  expect(packSizesIn("PEX 250 FT/ROLL")).toEqual([250]);
  expect(packSizesIn("Rebar 10/BDL")).toEqual([10]);
  expect(packSizesIn("1/2 copper elbow")).toEqual([]);
  expect(packSizesIn("3/4 x 10' pipe")).toEqual([]);
  expect(packSizesIn("2 PC union 1-1/4")).toEqual([]);
  expect(packSizesIn("Flange CL-150 / CS-300")).toEqual([]);
});
it("keeps missing backorder quantities unknown instead of inventing the shortage", async () => {
  const withoutBO = (r: SlipRow): SlipRow => ({ ...r, text: r.words.filter((_, i) => i !== 4).map(w => w.text).join(" "), words: r.words.filter((_, i) => i !== 4) });
  const result = await analyzeSlip([withoutBO(header), withoutBO(line)], [item], run);
  expect(result.lines[0]!.backordered).toBeNull();
});
it("recognizes BO as a backorder column", async () => {
  const bo = row(["SKU", "Description", "Ordered", "Shipped", "BO", "Unit"], 0.1);
  const result = await analyzeSlip([bo, line], [item], run);
  expect(result.lines[0]!.backordered).toBe(4);
});

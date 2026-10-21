import { expect, it } from "vitest";
import { proposedReceipts, type SlipAnalysis } from "~/lib/packing-slip-review";
import { analyzeSlip } from "./analyze";
import { tokens, matchLines, skuScore } from "./match";
import { wordRows, type SlipWord } from "./ocr-rows";
import { readSlipTable } from "./read-table";
import { makeSlip, slipRows } from "./test-slips";

const noEvaluator = async () => {
  throw Error("No evaluator in this test");
};

it("reads synthetic supplier slips without prefilling a wrong quantity", async () => {
  let correct = 0,
    review = 0,
    wrong = 0,
    extras = 0,
    flagged = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const slip = makeSlip(seed);
    const result = await analyzeSlip(slipRows(slip), slip.items, noEvaluator);
    const proposed = proposedReceipts({ lines: result.lines } as SlipAnalysis);
    for (const item of slip.items) {
      const truth = slip.truth.find((t) => t.itemId === item.id);
      const got = proposed[item.id];
      if (got === undefined) {
        if (truth) review++;
        else correct++;
      } else if (truth && Math.abs(got - truth.shipped) < 1e-6) correct++;
      else wrong++;
    }
    // Prefilled lines are exactly the clearly read, matched ones.
    for (const line of result.lines)
      if (line.proposed !== null) expect(line.quantityClear).toBe(true);
    for (const t of slip.truth.filter((t) => !t.itemId)) {
      extras++;
      const word = t.description.split(" ")[0]!;
      if (result.lines.some((l) => !l.orderItemId && l.evidence.includes(word)))
        flagged++;
    }
  }
  expect(wrong).toBe(0);
  expect(correct / (correct + review)).toBeGreaterThan(0.98);
  expect(flagged).toBe(extras);
});

it("keeps a supplier code before a size apart from the size", () => {
  expect(tokens('85890 3/4" COPPER CAP')).toEqual(
    expect.arrayContaining(["s:0.75", "n:85890"]),
  );
  expect(tokens('1-1/2" ELL')).toContain("s:1.5");
});

const word = (text: string, x: number, y: number): SlipWord => ({
  text,
  x,
  y,
  width: 0.03,
  height: 0.012,
  confidence: 95,
});

it("keeps words of one printed line together on a tilted page", () => {
  const slope = 0.02;
  const words = [0, 1].flatMap((line) =>
    Array.from({ length: 12 }, (_, i) => 0.05 + i * 0.06).map((x, i) =>
      word(`w${line}${i}`, x, 0.3 + line * 0.03 + x * slope),
    ),
  );
  const rows = wordRows(words, 1);
  expect(rows).toHaveLength(2);
  expect(rows[0]!.words.map((w) => w.text)).toEqual(
    Array.from({ length: 12 }, (_, i) => `w0${i}`),
  );
});

it("treats a row with a number under an unread heading as its own item", () => {
  const row = (y: number, words: SlipWord[]) => ({
    page: 1,
    words,
    text: words.map((w) => w.text).join(" "),
  });
  const table = readSlipTable([
    row(0.2, [
      word("Description", 0.06, 0.2),
      word("~~", 0.65, 0.2),
      word("Ship", 0.73, 0.2),
      word("Unit", 0.86, 0.2),
    ]),
    row(0.23, [
      word("SOLDER", 0.06, 0.23),
      word("10", 0.66, 0.23),
      word("10", 0.75, 0.23),
      word("EA", 0.86, 0.23),
    ]),
    row(0.25, [
      word("PEX", 0.06, 0.25),
      word("PIPE", 0.1, 0.25),
      word("1", 0.67, 0.25),
      word("COIL", 0.86, 0.25),
    ]),
  ]);
  expect(table.lines).toHaveLength(2);
  expect(table.lines[0]!.extra).toEqual([]);
});

it("reads stacked quantity headers and does not stop at stray marks or count carton notes", async () => {
  const row = (y: number, cells: Array<[string, number]>) => ({
    page: 1,
    words: cells.map(([t, x]) => word(t, x, y)),
    text: cells.map(([t]) => t).join(" "),
  });
  const rows = [
    row(0.2, [
      ["Line", 0.04],
      ["Description", 0.12],
      ["Order", 0.5],
      ["B/IO", 0.62],
      ["Ship", 0.73],
      ["Qty", 0.85],
    ]),
    row(0.216, [
      ["Quantity", 0.5],
      ["Quantity", 0.62],
      ["Quantity", 0.73],
      ["UM", 0.85],
    ]),
    row(0.25, [
      ["1", 0.04],
      ["ABC123", 0.12],
      ["10.00", 0.5],
      ["0.00", 0.62],
      ["10.00", 0.73],
      ["EA", 0.85],
    ]),
    row(0.28, [
      ["Carton #: BOX123 Qty: 10", 0.12],
      ["3", 0.73],
    ]),
    row(0.4, [["~", 0.2]]),
    row(0.44, [
      ["2", 0.04],
      ["ABC456", 0.12],
      ["20.00", 0.5],
      ["5.00", 0.62],
      ["15.00", 0.73],
      ["EA", 0.85],
    ]),
    row(0.5, [["2 Lines Total", 0.1]]),
  ];
  const table = readSlipTable(rows);
  expect(table.lines).toHaveLength(2);
  expect(table.layouts[0]!.columns.map((c) => c.field)).toEqual(
    expect.arrayContaining(["ordered", "backordered", "shipped", "unit"]),
  );
  const items = ["ABC123", "ABC456"].map((sku, i) => ({
    id: sku,
    sku,
    description: sku,
    aliases: [],
    ordered: i ? 20 : 10,
    received: 0,
    verificationStatus: "pending",
    unit: "ea",
    piecesPerPack: null,
    individualUnit: null,
  }));
  const result = await analyzeSlip(rows, items, noEvaluator);
  expect(result.lines.map((l) => l.proposed)).toEqual([10, 15]);
});

it("does not confuse complete supplier codes with code substrings or OCR lookalikes", () => {
  const item = (sku: string) => ({
    id: sku,
    sku,
    description: "Fitting",
    aliases: [],
    ordered: 10,
    received: 0,
    verificationStatus: "pending",
    unit: "ea",
    piecesPerPack: null,
    individualUnit: null,
  });
  expect(skuScore(item("112XFRTY"), "", "2X112XFRTY fitting")).toBe(0);
  expect(
    matchLines(
      [item("112XFRTY"), item("2X112XFRTY")],
      [{ code: "2X112XFRTY", text: "Fitting" }],
    )[0]!.itemId,
  ).toBe("2X112XFRTY");
  expect(
    matchLines(
      [item("ABO123"), item("AB0123")],
      [{ code: "ABO123", text: "Fitting" }],
    )[0]!.itemId,
  ).toBe("ABO123");
});

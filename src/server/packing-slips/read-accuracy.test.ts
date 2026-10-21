import { expect, it } from "vitest";
import { proposedReceipts, type SlipAnalysis } from "~/lib/packing-slip-review";
import { analyzeSlip } from "./analyze";
import { tokens } from "./match";
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

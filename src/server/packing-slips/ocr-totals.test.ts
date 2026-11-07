// @vitest-environment node
import { expect, it } from "vitest";
import { ocrTotalsWarnings } from "./ocr-totals";
import type { SlipRow } from "./ocr-rows";
import type { SlipLine } from "~/lib/packing-slip-review";
const row = (text: string, confidence = 98): SlipRow => ({
  page: 1,
  text,
  words: [{ text, confidence, x: 0, y: 0.9, width: 1, height: 0.02 }],
});
const lines = [{ shipped: 6 }, { shipped: 4 }] as SlipLine[];
it("checks explicit count and shipped totals without paid readers", () => {
  expect(
    ocrTotalsWarnings([row("2 lines total"), row("Total shipped 10")], lines),
  ).toEqual([]);
  expect(
    ocrTotalsWarnings([row("15 lines total"), row("Total shipped 126")], lines),
  ).toHaveLength(2);
});
it("does not interpret prices, low-confidence text or unknown quantities as mismatches", () => {
  expect(
    ocrTotalsWarnings([row("Total $126"), row("Total shipped 126", 50)], lines),
  ).toEqual([]);
  expect(
    ocrTotalsWarnings([row("Total shipped 126")], [
      { shipped: null },
    ] as SlipLine[]),
  ).toEqual([]);
});

import { describe, expect, it } from "vitest";
import { recoverProductRows } from "./recover-rows";
import { bandsFromTable } from "./vision";
import type { SlipRow } from "./ocr-rows";
import type { SlipLine } from "~/lib/packing-slip-review";
const row = (text: string, y: number): SlipRow => ({
  page: 1,
  text,
  words: text
    .split(" ")
    .map((text, i) => ({
      text,
      x: i * 0.12,
      y,
      width: 0.06,
      height: 0.02,
      confidence: 90,
    })),
});
describe("source row recovery", () => {
  it("retains products under an unreadable heading, including unknown products, without guessing any quantity", () => {
    const lines = recoverProductRows(
      [
        row("005 MASK123 FACE MASK 10 1", 0.3),
        row("003 ROD123 THREADED ROD 500 500", 0.4),
        row("CUSTOMER TEL 555 1234", 0.5),
        row("Total 501", 0.6),
      ],
      [],
    );
    expect(lines).toHaveLength(2);
    expect(
      lines.every(
        (l) =>
          l.shipped === null && l.proposed === null && l.orderItemId === null,
      ),
    ).toBe(true);
    expect(lines[0]!.description).toContain("FACE MASK");
    expect(lines[0]!.confidenceDetails!.quantity).toBe(0);
    expect(bandsFromTable(lines)).toHaveLength(2);
  });
  it("keeps out-of-order, repeated and unnumbered independent product rows separate", () => {
    const at = (
      evidence: string,
      y: number,
      extra: Partial<SlipLine> = {},
    ): SlipLine => ({
      page: 1,
      evidence,
      orderItemId: null,
      shipped: null,
      backordered: null,
      unit: null,
      proposed: null,
      issues: [],
      box: { x: 0, y, width: 1, height: 0.02 },
      ...extra,
    });
    const bands = bandsFromTable([
      at("005 MASK123 1", 0.2),
      at("003 ROD123 500", 0.3),
      at("003 ROD124 300", 0.4),
      at("WASHER 50", 0.5, { sku: "WASH50" }),
      at("NUT 20", 0.6, { shipped: 20 }),
      at("wrapped description", 0.62),
    ]);
    expect(bands).toHaveLength(6);
    expect(bands.map((b) => b.evidence)).toContain("003 ROD124 300");
  });
});

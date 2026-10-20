import { describe, it, expect } from "vitest";
import {
  detectLegendItems,
  legendItemSchema,
  type LegendLine,
} from "./drawing-legend";
import type { TitleBlockWord } from "./drawing-title-block";
function table(x = 0.1, y = 0.1) {
  const lines: LegendLine[] = [0, 0.02, 0.04, 0.06].map((d) => ({
    x1: x,
    y1: y + d,
    x2: x + 0.3,
    y2: y + d,
  }));
  lines.push({ x1: x + 0.08, y1: y + 0.02, x2: x + 0.08, y2: y + 0.06 });
  const words: TitleBlockWord[] = [
    {
      text: "MECHANICAL LEGEND",
      left: x + 0.01,
      right: x + 0.2,
      top: y + 0.005,
      bottom: y + 0.015,
    },
    {
      text: "CBV",
      left: x + 0.03,
      right: x + 0.06,
      top: y + 0.025,
      bottom: y + 0.032,
    },
    {
      text: "CIRCUIT BALANCING VALVE",
      left: x + 0.09,
      right: x + 0.29,
      top: y + 0.025,
      bottom: y + 0.032,
    },
    {
      text: "ISOLATION VALVE",
      left: x + 0.09,
      right: x + 0.29,
      top: y + 0.045,
      bottom: y + 0.052,
    },
  ];
  return { words, lines };
}
describe("legend proposals", () => {
  it("pairs descriptions with separate symbol crops and abbreviations", () => {
    const { words, lines } = table(),
      items = detectLegendItems(words, lines);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      name: "CIRCUIT BALANCING VALVE",
      abbreviation: "CBV",
    });
    expect(items[0]!.symbol.right).toBeLessThan(0.18);
    expect(legendItemSchema.safeParse(items[0]).success).toBe(true);
  });
  it("keeps adjacent discipline tables and rows separate", () => {
    const a = table(),
      b = table(0.6);
    b.words[0]!.text = "ELECTRICAL SYMBOLS";
    b.words[2]!.text = "DUPLEX RECEPTACLE";
    const items = detectLegendItems(
      [...a.words, ...b.words],
      [...a.lines, ...b.lines],
    );
    expect(items).toHaveLength(4);
    expect(items.find((i) => i.name === "DUPLEX RECEPTACLE")?.category).toBe(
      "ELECTRICAL SYMBOLS",
    );
  });
  it("does not treat drawing schedules or unbordered text as verified legend rows", () => {
    const { words, lines } = table();
    words[0]!.text = "DRAWING LIST AND LEGEND";
    expect(detectLegendItems(words, lines)).toEqual([]);
    words[0]!.text = "MECHANICAL LEGEND";
    expect(detectLegendItems(words, [])).toEqual([]);
  });
  it("deduplicates repeated PDF borders and headings", () => {
    const { words, lines } = table();
    expect(
      detectLegendItems([...words, words[0]!], [...lines, ...lines]),
    ).toHaveLength(2);
  });
  it("rejects empty names and crops outside the source row", () => {
    const { words, lines } = table(),
      item = detectLegendItems(words, lines)[0]!;
    expect(legendItemSchema.safeParse({ ...item, name: " " }).success).toBe(
      false,
    );
    expect(
      legendItemSchema.safeParse({
        ...item,
        symbol: { ...item.symbol, right: 0.9 },
      }).success,
    ).toBe(false);
  });
});

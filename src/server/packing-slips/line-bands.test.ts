// @vitest-environment node
import { expect, it } from "vitest";
import { locatedBands, rowStarts } from "./line-bands";
import type { SlipRow } from "./ocr-rows";

const columns = {
  ordered: { left: 0.58, right: 0.64, top: 0.09, bottom: 0.12 },
  shipped: { left: 0.68, right: 0.74, top: 0.09, bottom: 0.12 },
};
/** An OCR row: each word's text and where it starts across, and down if not
 * where the row does. */
function row(y: number, ...words: Array<[string, number, number?]>): SlipRow {
  return {
    page: 1,
    text: words.map(([text]) => text).join(" "),
    words: words.map(([text, x, top = y]) => ({
      text,
      x,
      y: top,
      width: 0.04,
      height: 0.012,
      confidence: 90,
    })),
  };
}
/** A slip line's first row: a code, a description and two quantities. */
const line = (y: number, code = "ABC123") =>
  row(y, [code, 0.05], ["Brass valve", 0.2], ["6", 0.6], ["6", 0.7]);
/** Lines as Jev locates them, each running to the next. */
const jev = (...tops: number[]) =>
  tops.map((top, k) => ({
    top,
    bottom: tops[k + 1] ?? top + 0.05,
    left: 0.02,
    right: 0.98,
  }));
const tops = (bands: Array<{ top: number }>) =>
  bands.map((b) => Number(b.top.toFixed(3)));

it("places each line at its row when the rows sure to start lines match Jev's count", () => {
  const rows = [line(0.2), line(0.25), line(0.3), line(0.35)];
  // Jev puts the third line almost on the second.
  const bands = locatedBands(jev(0.19, 0.24, 0.245, 0.33), rows, columns);
  expect(tops(bands)).toEqual([0.198, 0.248, 0.298, 0.348]);
  expect(bands.every((b) => b.precise)).toBe(true);
  // Each line ends where the next starts.
  expect(bands.slice(0, -1).map((b) => b.bottom)).toEqual(
    bands.slice(1).map((b) => b.top),
  );
});

it("adds a line Jev missed only when allowed one more", () => {
  const rows = [line(0.2), line(0.25), line(0.3)];
  const found = jev(0.19, 0.29);
  expect(tops(locatedBands(found, rows, columns))).toEqual([0.198, 0.298]);
  expect(tops(locatedBands(found, rows, columns, [], 1))).toEqual([
    0.198, 0.248, 0.298,
  ]);
});

it("takes indented text with little quantity ink for a wrapped description", () => {
  const rows = [line(0.2), row(0.222, ["SWEAT", 0.2]), line(0.25)];
  const ink = (wrapped: number) => [
    { y: 0.2, quantity: 1 },
    { y: 0.222, quantity: wrapped },
    { y: 0.25, quantity: 1 },
  ];
  const kinds = (quantity: number) =>
    rowStarts(rows, columns, ink(quantity)).map((r) =>
      r.strong ? "strong" : r.weak ? "weak" : "-",
    );
  expect(kinds(0.6)).toEqual(["strong", "weak", "strong"]);
  expect(
    tops(locatedBands(jev(0.19, 0.24), rows, columns, ink(0.6), 1)),
  ).toEqual([0.198, 0.248]);
  // With a line's share of quantity ink it is a line whose code the OCR
  // missed.
  expect(kinds(1)).toEqual(["strong", "strong", "strong"]);
});

it("fills out Jev's count with rows of type the OCR could not read", () => {
  const rows = [line(0.2), line(0.3)];
  const ink = (unread: number) => [
    { y: 0.2, quantity: 1 },
    { y: 0.235, quantity: unread },
    { y: 0.3, quantity: 1 },
  ];
  // Jev puts the second line almost on the first.
  const found = jev(0.19, 0.205, 0.29);
  const filled = locatedBands(found, rows, columns, ink(1));
  expect(tops(filled)).toEqual([0.198, 0.233, 0.298]);
  expect(filled.every((b) => b.precise)).toBe(true);
  // A row with as little quantity ink as a note does not start a line; the
  // line is spaced between its neighbours instead.
  const spaced = locatedBands(found, rows, columns, ink(0.5));
  expect(tops(spaced)).toEqual([0.198, 0.248, 0.298]);
  expect(spaced.map((b) => b.precise)).toEqual([true, false, true]);
});

it("takes column headings, misread or among stray marks, for no line", () => {
  const heading = (...words: Array<[string, number]>) =>
    rowStarts([row(0.1, ...words)], columns)[0]!;
  for (const r of [
    heading(["CODE", 0.05], ["DESCRIPTION", 0.2], ["QTY", 0.6]),
    heading(["C0DE", 0.05], ["DESCRIPTI0N", 0.2], ["0TY", 0.6]),
    heading(
      ["CODE", 0.05],
      ["|", 0.15],
      ["DESCRIPTION", 0.2],
      ["~", 0.5],
      [".", 0.55],
    ),
  ])
    expect(r).toMatchObject({ strong: false, weak: false });
  // One heading's word does not make a line a heading.
  expect(
    heading(["V17", 0.05], ["BALL VALVE PART", 0.2], ["2", 0.6]),
  ).toMatchObject({
    strong: true,
  });
});

it("keeps stray marks for weak rows only where the ink shows type", () => {
  const marks = [row(0.22, ["~", 0.3], ["'", 0.62])];
  expect(rowStarts(marks, columns)[0]).toMatchObject({
    strong: false,
    weak: false,
  });
  expect(
    rowStarts(marks, columns, [{ y: 0.221, quantity: 1 }])[0],
  ).toMatchObject({ strong: false, weak: true, y: 0.221 });
});

it("starts a line high enough for a tick reaching above it, but not into the line before", () => {
  const ticked = (tick: number) => [
    line(0.2),
    row(
      0.25,
      ["ABC124", 0.05],
      ["Brass valve", 0.2],
      ["6", 0.6],
      ["✓", 0.7, tick],
    ),
  ];
  const found = jev(0.19, 0.24);
  expect(tops(locatedBands(found, ticked(0.237), columns))).toEqual([
    0.198, 0.235,
  ]);
  expect(tops(locatedBands(found, ticked(0.205), columns))).toEqual([
    0.198, 0.232,
  ]);
});

it("pairs the OCR's rows with the ink's in order", () => {
  const starts = rowStarts([line(0.2), line(0.215)], columns, [
    { y: 0.208, quantity: 1 },
    { y: 0.222, quantity: 1 },
    { y: 0.26, quantity: 1 },
  ]);
  expect(starts.map((r) => [r.y, r.strong, r.weak, !!r.unread])).toEqual([
    [0.208, true, false, false],
    [0.222, true, false, false],
    // Ink no OCR row was found for.
    [0.26, false, true, true],
  ]);
});

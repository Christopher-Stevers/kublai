import { expect, it } from "vitest";
import { drawingMarkupSchema } from "./drawing-workspace";
import { hyperlinkDetectInput, hyperlinkReaders } from "./hyperlink-readers";
const id = "00000000-0000-4000-8000-000000000001";
it("offers only Normal and Terra and rejects requests for retired readers", () => {
  expect(hyperlinkReaders).toEqual(["normal", "terra"]);
  const input = {
    sheetId: id,
    sourceSheetId: id,
    requestId: id,
    reader: "retired-reader",
  };
  expect(hyperlinkDetectInput.safeParse(input).success).toBe(false);
  expect(
    hyperlinkDetectInput.safeParse({ ...input, reader: "terra" }).success,
  ).toBe(true);
});
it("keeps saved hyperlink destinations usable when their reader has been retired", () => {
  const markup = {
    sourceSheetId: id,
    type: "link",
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
    ],
    equipmentTag: "P-1",
    hyperlinkReader: "retired-reader",
    links: [{ label: "P-1 — drawing", targetSheetId: id }],
  };
  const parsed = drawingMarkupSchema.parse(markup);
  expect(parsed.hyperlinkReader).toBeUndefined();
  expect(parsed.links).toEqual(markup.links);
  expect(parsed.equipmentTag).toBe("P-1");
  expect(parsed.points).toEqual(markup.points);
  expect(
    drawingMarkupSchema.parse({ ...markup, hyperlinkReader: "terra" })
      .hyperlinkReader,
  ).toBe("terra");
});

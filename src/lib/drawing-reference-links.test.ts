import { describe, expect, it } from "vitest";
import { findDrawingReferences } from "./drawing-reference-links";
import type { DrawingEntity, DrawingJobSheet } from "./drawing-workspace";
const source = "00000000-0000-4000-8000-000000000001",
  target = "00000000-0000-4000-8000-000000000002";
const sheets: DrawingJobSheet[] = [
  {
    id: target,
    sheetId: target,
    setId: "set",
    name: "A201 Elevations",
    imageUrl: "/a.webp",
    width: 100,
    height: 100,
    sourceFilename: null,
  },
];
const word = (text: string) => ({
  text,
  left: 0.1,
  top: 0.2,
  right: 0.4,
  bottom: 0.3,
});
describe("drawing reference suggestions", () => {
  it("matches whole sheet identifiers and avoids similarly numbered sheets", () => {
    expect(
      findDrawingReferences(
        [
          word("SEE 3/A201"),
          word("A2010"),
          word("A201A"),
          word("A201.1"),
          word("A201-1"),
        ],
        sheets,
        [],
        source,
        [],
      ).map((row) => row.word.text),
    ).toEqual(["SEE 3/A201"]);
  });
  it("does not suggest the current sheet or duplicate a saved link", () => {
    expect(
      findDrawingReferences([word("A201")], sheets, [], target, []),
    ).toEqual([]);
    const existing = {
      kind: "markup",
      visibility: "private",
      data: {
        type: "link",
        sourceSheetId: source,
        targetSheetId: target,
        points: [{ x: 0.1, y: 0.2 }],
      },
    } as DrawingEntity;
    expect(
      findDrawingReferences([word("A201")], sheets, [], source, [existing]),
    ).toEqual([]);
    if (existing.kind !== "markup") throw Error("fixture");
    existing.data = { ...existing.data, targetSheetId: undefined, links: [{ label: "Elevation", targetSheetId: target }, { label: "Manual", url: "https://example.com" }] };
    expect(findDrawingReferences([word("A201")], sheets, [], source, [existing])).toEqual([]);
  });
  it("caps suggestions and ignores degenerate text boxes", () => {
    expect(
      findDrawingReferences(
        Array.from({ length: 120 }, () => word("A201")),
        sheets,
        [],
        source,
        [],
      ),
    ).toHaveLength(100);
    expect(
      findDrawingReferences(
        [{ ...word("A201"), right: 0.1 }],
        sheets,
        [],
        source,
        [],
      ),
    ).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { findPdfPageMatches, indexPdfText } from "./pdf-document-search";

const word = (text: string, left: number, right: number, hasEOL = false) => ({
  rect: { text, left, right, top: 0.1, bottom: 0.12 },
  hasEOL,
});
describe("PDF document search", () => {
  it("finds case-insensitive phrases across separate text runs and highlights each run", () => {
    const index = indexPdfText([
      word("Valve", 0.1, 0.2),
      word("schedule", 0.22, 0.4),
    ]);
    expect(findPdfPageMatches(index, " VALVE   Schedule ", 7)).toEqual([
      { page: 7, offset: 0, rects: index.spans.map((s) => s.rect) },
    ]);
  });
  it("joins adjacent fragments of one word, normalizes ligatures and finds repeated matches", () => {
    const index = indexPdfText([
      word("val", 0.1, 0.15),
      word("ve", 0.15, 0.2, true),
      word("Valve ﬁtting", 0.1, 0.3),
    ]);
    expect(index.text).toBe("valve valve fitting");
    expect(findPdfPageMatches(index, "valve", 1)).toHaveLength(2);
    expect(findPdfPageMatches(index, "fitting", 1)).toHaveLength(1);
    expect(findPdfPageMatches(index, "valve", 1, 1)).toHaveLength(1);
    expect(findPdfPageMatches(index, "", 1)).toEqual([]);
  });
});

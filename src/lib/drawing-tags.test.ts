import { describe, expect, it } from "vitest";
import {
  containsDrawingTag,
  drawingTagCandidates,
  drawingTagIndex,
  drawingTagLocations,
  drawingTagSheet,
  isDrawingTag,
} from "./drawing-tags";
const word = (text: string, top = 0.1, left = 0.1) => ({
  text,
  top,
  left,
  right: left + 0.08,
  bottom: top + 0.02,
});
describe("all drawing tags", () => {
  it("finds custom families, room and door IDs, line numbers, alphabetic tags and sheet references", () => {
    const tags = drawingTagCandidates([
      word("QXZ-1001"),
      word("D101", 0.2),
      word("100-PL-001", 0.3),
      word("VENT-A", 0.4),
      word("M1.01", 0.5),
      word("ROOM 101", 0.6),
      word("GRID A", 0.7),
    ]);
    expect(tags).toEqual(
      expect.arrayContaining([
        "QXZ-1001",
        "D-101",
        "100-PL-001",
        "VENT-A",
        "M-1.01",
        "101",
        "A",
      ]),
    );
  });
  it("keeps numeric and letter-only labels available for image-reader and manual lookups", () => {
    const words = [word("7"), word("A", 0.3)];
    expect(drawingTagCandidates(words)).toEqual(["7", "A"]);
    expect(drawingTagLocations(words, "7")).toEqual([words[0]]);
    expect(drawingTagLocations(words, "A")).toEqual([words[1]]);
  });
  it("recognizes inline and stacked detail callouts without turning fractions into tags", () => {
    expect(drawingTagIndex([word("1/M501")]).has("1/M-501")).toBe(true);
    expect(
      drawingTagCandidates([word("1", 0.1), word("M501", 0.13)]),
    ).toContain("1/M-501");
    expect(drawingTagSheet("1/M501")).toEqual({ sheet: "M-501", detail: "1" });
    expect(isDrawingTag("1/2")).toBe(false);
  });
  it("does not propose dimensions, manufacturer numbers, standards, dates or prose", () => {
    expect(
      drawingTagCandidates([
        word("100 mm"),
        word("MODEL XY-100", 0.2),
        word("ASME B31.9", 0.3),
        word("level 2", 0.4),
        word("2026-11-08", 0.5),
      ]),
    ).toEqual([]);
  });
  it("matches metadata case-insensitively, preserves whole IDs and rejects URLs", () => {
    expect(containsDrawingTag("Room 101.pdf", "101")).toBe(true);
    expect(containsDrawingTag("Vent-a submittal", "VENT-A")).toBe(true);
    expect(containsDrawingTag("D-1010", "D101")).toBe(false);
    expect(isDrawingTag("https://evil.test/1")).toBe(false);
  });
});

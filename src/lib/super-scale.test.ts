import { describe, expect, it } from "vitest";
import { identifyGrids, gridSpacing, transferGridScale } from "./super-scale";
const make = (positions: number[], aspect = 1, axis: "x" | "y" = "x") =>
  identifyGrids(
    positions.map((p) =>
      axis === "x"
        ? { x1: p, x2: p, y1: 0.1, y2: 0.9 }
        : { y1: p / aspect, y2: p / aspect, x1: 0.1, x2: 0.9 },
    ),
    positions.map((p, i) => ({
      text: String.fromCharCode(65 + i),
      x: axis === "x" ? p : 0.09,
      y: axis === "x" ? 0.09 : p / aspect,
    })),
    aspect,
  );
describe("Super scale", () => {
  it("transfers real grid spacing, not a copied scale", () => {
    const result = transferGridScale(
      make([0.2, 0.4, 0.6]),
      make([0.1, 0.2, 0.3]),
      "A",
      "B",
      { unit: "m", unitsPerSheetWidth: 30 },
    );
    expect(result).toMatchObject({
      ok: true,
      checks: 1,
      scale: { unit: "m", unitsPerSheetWidth: 60 },
    });
  });
  it("handles vertical spacing with page aspect and a rotated target", () => {
    const result = transferGridScale(
      make([0.2, 0.4, 0.6]),
      make([0.1, 0.2, 0.3], 2, "y"),
      "A",
      "B",
      { unit: "ft", unitsPerSheetWidth: 30 },
    );
    expect(result).toMatchObject({
      ok: true,
      checks: 1,
      scale: { unit: "ft", unitsPerSheetWidth: 60 },
    });
  });
  it("rejects inconsistent extra grids and missing pairs", () => {
    expect(
      transferGridScale(
        make([0.2, 0.4, 0.6]),
        make([0.1, 0.2, 0.5]),
        "A",
        "B",
        { unit: "m", unitsPerSheetWidth: 30 },
      ).ok,
    ).toBe(false);
    expect(gridSpacing(make([0.2, 0.4]), "A", "C")).toBeNull();
    expect(gridSpacing(make([0.2, 0.4]), "A", "A")).toBeNull();
  });
  it("does not pretend two grids alone are independently checked", () => {
    expect(
      transferGridScale(make([0.2, 0.4]), make([0.1, 0.2]), "A", "B", {
        unit: "m",
        unitsPerSheetWidth: 30,
      }),
    ).toMatchObject({ ok: true, checks: 0 });
  });
  it("excludes duplicate labels on separate lines instead of guessing", () => {
    const lines = [0.2, 0.4].map((x) => ({ x1: x, x2: x, y1: 0.1, y2: 0.9 }));
    const result = identifyGrids(
      lines,
      [0.2, 0.4].map((x) => ({ text: "A", x, y: 0.09 })),
      1,
    );
    expect(result.grids).toEqual([]);
    expect(result.ambiguous).toEqual(["A"]);
  });
  it("deduplicates labels at both ends, ignores unrelated text and short strokes", () => {
    const line = { x1: 0.2, x2: 0.2, y1: 0.1, y2: 0.9 };
    expect(
      identifyGrids(
        [line, line],
        [
          { text: "A", x: 0.2, y: 0.09 },
          { text: "A", x: 0.2, y: 0.91 },
          { text: "NOTES", x: 0.2, y: 0.09 },
        ],
        1,
      ).grids,
    ).toHaveLength(1);
    expect(
      identifyGrids(
        [{ ...line, y2: 0.15 }],
        [{ text: "A", x: 0.2, y: 0.09 }],
        1,
      ).grids,
    ).toHaveLength(0);
  });
});

it("recognizes polygon bubbles and joins CAD dash fragments without accepting bare room text", async () => {
  const { polygonGridBubbles } = await import("./super-scale");
  const circle = Array.from({ length: 36 }, (_, i) => {
    const a = (i * Math.PI) / 18,
      b = ((i + 1) * Math.PI) / 18;
    return {
      x1: 0.2 + 0.005 * Math.cos(a),
      y1: 0.1 + 0.005 * Math.sin(a),
      x2: 0.2 + 0.005 * Math.cos(b),
      y2: 0.1 + 0.005 * Math.sin(b),
    };
  });
  const dashes = Array.from({ length: 50 }, (_, i) => ({
    x1: 0.2,
    x2: 0.2,
    y1: 0.105 + i * 0.012,
    y2: 0.113 + i * 0.012,
  }));
  const labels = [{ text: "1.13", x: 0.2, y: 0.1 }];
  const lines = [...circle, ...dashes];
  const bubbles = polygonGridBubbles(lines, labels, 1);
  expect(bubbles).toHaveLength(1);
  expect(
    identifyGrids(lines, labels, 1, bubbles).grids.map((g) => g.name),
  ).toEqual(["1.13"]);
  expect(identifyGrids(dashes, labels, 1, []).grids).toEqual([]);
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DRAWING_APPEARANCE,
  DRAWING_APPEARANCE_KEY,
  drawingAppearance,
  drawingAppearanceMatrix,
  readDrawingAppearance,
  writeDrawingAppearance,
} from "./drawing-appearance";

afterEach(() => vi.unstubAllGlobals());
const transform = (matrix: string, pixel: number[]) => {
  const values = matrix.split(" ").map(Number);
  return [0, 1, 2, 3].map(
    (row) =>
      values[row * 5 + 4]! +
      pixel.reduce(
        (sum, channel, index) => sum + channel * values[row * 5 + index]!,
        0,
      ),
  );
};
describe("personal drawing appearance", () => {
  it("preserves original drawing colours by default", () => {
    expect(drawingAppearanceMatrix(DEFAULT_DRAWING_APPEARANCE)).toBeNull();
    expect(drawingAppearance(null)).toEqual(DEFAULT_DRAWING_APPEARANCE);
  });
  it("inverts paper and ink while retaining transparent pixels and antialiasing", () => {
    const matrix = drawingAppearanceMatrix({
      inverted: true,
      lineColor: null,
    })!;
    expect(transform(matrix, [1, 1, 1, 1])).toEqual([0, 0, 0, 1]);
    expect(transform(matrix, [0, 0, 0, 1])).toEqual([1, 1, 1, 1]);
    expect(transform(matrix, [0.5, 0.5, 0.5, 0.3])).toEqual([
      0.5, 0.5, 0.5, 0.3,
    ]);
  });
  it.each([false, true])(
    "colours ink independently of paper (inverted=%s)",
    (inverted) => {
      const matrix = drawingAppearanceMatrix({
        inverted,
        lineColor: "#39ff14",
      })!;
      const ink = transform(matrix, [0, 0, 0, 1]),
        paper = transform(matrix, [1, 1, 1, 1]);
      expect(ink).toEqual([57 / 255, 1, 20 / 255, 1]);
      for (const channel of paper.slice(0, 3))
        expect(channel).toBeCloseTo(inverted ? 0 : 1);
    },
  );
  it("validates saved preferences instead of accepting arbitrary filter values", () => {
    expect(
      drawingAppearance({ inverted: "true", lineColor: "url(bad)" }),
    ).toEqual(DEFAULT_DRAWING_APPEARANCE);
    expect(drawingAppearance({ inverted: true, lineColor: "#AB34EF" })).toEqual(
      { inverted: true, lineColor: "#ab34ef" },
    );
  });
  it("remembers appearance across drawing navigation and reloads", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    writeDrawingAppearance({ inverted: true, lineColor: "#39ff14" });
    expect(readDrawingAppearance()).toEqual({
      inverted: true,
      lineColor: "#39ff14",
    });
    storage.set(DRAWING_APPEARANCE_KEY, "invalid json");
    expect(readDrawingAppearance()).toEqual(DEFAULT_DRAWING_APPEARANCE);
  });
  it("remains usable when browser storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw Error("Blocked");
      },
      setItem: () => {
        throw Error("Blocked");
      },
    });
    expect(readDrawingAppearance()).toEqual(DEFAULT_DRAWING_APPEARANCE);
    expect(() =>
      writeDrawingAppearance({ inverted: true, lineColor: null }),
    ).not.toThrow();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  convertScale,
  formatLength,
  parseLength,
  readSheetScale,
  realLength,
  scaleFromKnownLength,
  sheetPointFromFrame,
  sheetWidths,
  writeSheetScale,
} from "./sheet-measure";

beforeEach(() => {
  // Node 26 exposes an unavailable native localStorage in the test environment.
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  });
});

describe("sheet distance", () => {
  it("sums each segment and treats the sheet height in the same units as its width", () => {
    // A square sheet: 0.3 across then 0.4 down is a 0.5 diagonal.
    expect(
      sheetWidths(
        [
          { x: 0, y: 0 },
          { x: 0.3, y: 0 },
          { x: 0.3, y: 0.4 },
        ],
        1,
      ),
    ).toBeCloseTo(0.7);
    // A sheet twice as wide as it is tall: the full height is half a sheet-width.
    expect(
      sheetWidths(
        [
          { x: 0, y: 0 },
          { x: 0, y: 1 },
        ],
        0.5,
      ),
    ).toBeCloseTo(0.5);
    expect(sheetWidths([{ x: 0, y: 0 }], 1)).toBe(0);
  });

  it("turns a known line into a scale and measures a path with it", () => {
    const aspect = 0.5;
    const perWidth = scaleFromKnownLength(
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
      aspect,
      100,
    );
    expect(perWidth).toBeCloseTo(100);
    expect(
      realLength(
        [
          { x: 0, y: 0.5 },
          { x: 0.5, y: 0.5 },
          { x: 0.5, y: 1 },
        ],
        aspect,
        perWidth!,
      ),
    ).toBeCloseTo(75); // 50 across, then the full height (25) down
    expect(
      scaleFromKnownLength({ x: 0.2, y: 0.2 }, { x: 0.2, y: 0.2 }, aspect, 10),
    ).toBeNull();
    expect(
      scaleFromKnownLength({ x: 0, y: 0 }, { x: 1, y: 0 }, aspect, 0),
    ).toBeNull();
  });

  it("converts a saved scale between feet and meters", () => {
    expect(
      convertScale({ unit: "ft", unitsPerSheetWidth: 100 }, "m")
        .unitsPerSheetWidth,
    ).toBeCloseTo(30.48);
    const back = convertScale({ unit: "m", unitsPerSheetWidth: 30.48 }, "ft");
    expect(back.unit).toBe("ft");
    expect(back.unitsPerSheetWidth).toBeCloseTo(100);
    const labeled = convertScale(
      { unit: "ft", unitsPerSheetWidth: 100, label: '1/4" = 1\'-0"' },
      "m",
    );
    expect(labeled.label).toBe('1/4" = 1\'-0"');
    expect(labeled.unit).toBe("m");
  });

  it("reads the lengths a person writes on a drawing", () => {
    expect(parseLength("24'6\"", "ft")).toBeCloseTo(24.5);
    expect(parseLength("24′ 6 1/2″", "ft")).toBeCloseTo(24 + 6.5 / 12);
    expect(parseLength("24-6", "ft")).toBeCloseTo(24.5);
    expect(parseLength('6"', "ft")).toBeCloseTo(0.5);
    expect(parseLength("24 ft 6 in", "ft")).toBeCloseTo(24.5);
    expect(parseLength("10.5", "ft")).toBeCloseTo(10.5);
    expect(parseLength("7.5 m", "m")).toBeCloseTo(7.5);
    expect(parseLength("1250 mm", "m")).toBeCloseTo(1.25);
    expect(parseLength("50 cm", "m")).toBeCloseTo(0.5);
    expect(parseLength("abc", "ft")).toBeNull();
    expect(parseLength("", "m")).toBeNull();
  });

  it("shows feet and inches, or meters", () => {
    expect(formatLength(24.5, "ft")).toBe("24'-6\"");
    expect(formatLength(10 + 11.5 / 12, "ft")).toBe("11'-0\"");
    expect(formatLength(0, "ft")).toBe("0'-0\"");
    expect(formatLength(15.246, "m")).toBe("15.25 m");
    expect(formatLength(15, "m")).toBe("15 m");
  });

  it("maps a screen point onto the fitted sheet and misses clicks past its edge", () => {
    // 800×400 sheet centred in an 800×600 frame, unzoomed.
    const frame = { width: 800, height: 600 };
    const fit = { width: 800, height: 400 };
    const view = { scale: 1, x: 0, y: 0 };
    expect(sheetPointFromFrame({ x: 400, y: 300 }, frame, fit, view)).toEqual({
      x: 0.5,
      y: 0.5,
    });
    expect(sheetPointFromFrame({ x: 0, y: 100 }, frame, fit, view)).toEqual({
      x: 0,
      y: 0,
    });
    expect(sheetPointFromFrame({ x: 400, y: 20 }, frame, fit, view)).toBeNull();
  });

  it("remembers a sheet scale on this computer", () => {
    localStorage.clear();
    expect(readSheetScale("sheet-1")).toBeNull();
    writeSheetScale("sheet-1", { unit: "ft", unitsPerSheetWidth: 80 });
    expect(readSheetScale("sheet-1")).toEqual({
      unit: "ft",
      unitsPerSheetWidth: 80,
    });
    localStorage.setItem("foremanhq.sheet-scale.sheet-2", "{");
    expect(readSheetScale("sheet-2")).toBeNull();
    writeSheetScale("sheet-3", {
      unit: "ft",
      unitsPerSheetWidth: 80,
      label: '1/4" = 1\'-0"',
    });
    expect(readSheetScale("sheet-3")).toEqual({
      unit: "ft",
      unitsPerSheetWidth: 80,
      label: '1/4" = 1\'-0"',
    });
    writeSheetScale("sheet-4", {
      unit: "ft",
      unitsPerSheetWidth: 80,
      label: "x".repeat(81),
    });
    expect(readSheetScale("sheet-4")).toEqual({
      unit: "ft",
      unitsPerSheetWidth: 80,
    });
  });
});

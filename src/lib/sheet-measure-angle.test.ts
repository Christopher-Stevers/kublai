import { describe, expect, it } from "vitest";
import { formatLengthAs, parseLengthAs, snapToAngle } from "./sheet-measure";

describe("snapToAngle", () => {
  const horizontal = { x1: 0, y1: 0.5, x2: 1, y2: 0.5 };
  it("locks a nearly square line to 90° off the first end's line", () => {
    const hit = snapToAngle({ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.2 }, 1, horizontal);
    expect(hit?.angle).toBe(90);
    expect(hit?.point.x).toBeCloseTo(0.5, 9);
  });
  it("locks near 45°, and lands exactly on the crossing line", () => {
    const top = { x1: 0, y1: 0.2, x2: 1, y2: 0.2 };
    const hit = snapToAngle({ x: 0.5, y: 0.5 }, { x: 0.79, y: 0.21 }, 1, horizontal, top);
    expect(hit?.angle).toBe(45);
    expect(hit?.point.y).toBeCloseTo(0.2, 9);
    expect(hit?.point.x).toBeCloseTo(0.8, 9);
  });
  it("measures angles on the real sheet, not the stretched fractions", () => {
    // A sheet twice as wide as tall: 0.1 across equals 0.2 down for 45°.
    const hit = snapToAngle({ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.29 }, 0.5, null);
    expect(hit?.angle).toBe(45);
  });
  it("leaves other angles alone", () => {
    expect(snapToAngle({ x: 0.5, y: 0.5 }, { x: 0.8, y: 0.38 }, 1, horizontal)).toBeNull();
  });
  it("does not angle-lock an endpoint off a parallel line target", () => {
    const line = { x1: 0.7, y1: 0.31, x2: 0.9, y2: 0.11 };
    expect(snapToAngle({ x: 0.5, y: 0.5 }, { x: 0.8, y: 0.21 }, 1, horizontal, line)).toBeNull();
  });
  it("does not extrapolate a line target beyond its actual endpoint", () => {
    const short = { x1: 0.79, y1: 0.2, x2: 0.795, y2: 0.2 };
    expect(snapToAngle({ x: 0.5, y: 0.5 }, { x: 0.792, y: 0.2 }, 1, horizontal, short)).toBeNull();
  });

});

describe("lengths in m, mm, in and ft", () => {
  it("reads a plain number in the chosen unit and stores meters or feet", () => {
    expect(parseLengthAs("7500", "mm")).toEqual({ length: 7.5, unit: "m" });
    expect(parseLengthAs("18", "in")).toEqual({ length: 1.5, unit: "ft" });
    expect(parseLengthAs(`24'6"`, "ft")).toEqual({ length: 24.5, unit: "ft" });
  });
  it("shows a stored length in any unit", () => {
    expect(formatLengthAs(10, "ft", "mm")).toBe("3048 mm");
    expect(formatLengthAs(10, "ft", "in")).toBe(`120"`);
    expect(formatLengthAs(3.048, "m", "ft")).toBe(`10'-0"`);
  });
});

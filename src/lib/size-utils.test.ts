import { describe, expect, it } from "vitest";
import {
  decimalToFraction,
  formatSizeDimensions,
  parsePrimarySizeInput,
  parseSizeInput,
} from "./size-utils";

describe("size-utils", () => {
  it.each([
    ["1/2", 0.5],
    ["1 1/2", 1.5],
    ["1-1/2", 1.5],
    ["1 ½", 1.5],
    ["2¾", 2.75],
    ["3.25", 3.25],
  ])("parses %s", (input, expected) => {
    expect(parseSizeInput(input)).toBeCloseTo(expected);
  });

  it("rounds fractions that carry into the next whole number", () => {
    expect(decimalToFraction(1.999)).toBe("2");
    expect(decimalToFraction(-1.999)).toBe("-2");
  });

  it("formats every dimension with the supplied inch symbol", () => {
    expect(formatSizeDimensions("4 x 4 x 1.5", "in")).toBe('4" x 4" x 1 1/2"');
  });

  it("parses the primary dimension from multi-dimensional input", () => {
    expect(parsePrimarySizeInput("3 x 2 x 2")).toBe(3);
    expect(parsePrimarySizeInput("1 1/2x2")).toBe(1.5);
  });

  it("can format multi-dimensional labels without unit suffixes", () => {
    expect(formatSizeDimensions("3x2x2", null)).toBe("3 x 2 x 2");
  });
});

import { describe, expect, it } from "vitest";
import { decimalToFraction, formatSizeDimensions, parseSizeInput } from "./size-utils";

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
});

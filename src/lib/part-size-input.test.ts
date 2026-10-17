import { expect, it } from "vitest";
import { isPartSizeInput, normalizePartSize } from "./part-size-input";
it("blocks units, quotes, words, and pasted invalid size text", () => {
  for (const value of [
    '4"',
    "4 in",
    "75 mm",
    "1e3",
    "4 on 12",
    "2 x abc",
    "-2",
    "3xx2",
  ]) {
    expect(isPartSizeInput(value), value).toBe(false);
    expect(normalizePartSize(value), value).toBeNull();
  }
});
it("allows fractions and unfinished input but requires complete dimensions to save", () => {
  for (const value of ["1/", "1 1/", "1-", "3 x", "."]) {
    expect(isPartSizeInput(value), value).toBe(true);
    expect(normalizePartSize(value), value).toBeNull();
  }
  expect(normalizePartSize("1-1/2 X 3/4 x 2.5000")).toBe("1.5 x 0.75 x 2.5");
  expect(normalizePartSize("4.000")).toBe("4");
  expect(normalizePartSize("1/0")).toBeNull();
  expect(normalizePartSize("")).toBe("");
});

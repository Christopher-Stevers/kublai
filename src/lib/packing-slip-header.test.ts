import { describe, expect, it } from "vitest";
import { slipHeader } from "~/lib/packing-slip-review";

const box = (y: number) => ({ x: 0.05, y, width: 0.9, height: 0.03 });

describe("slipHeader", () => {
  it("uses the page's own column headings", () => {
    expect(slipHeader([{ page: 2, box: box(0.1) }], 2)).toEqual({
      page: 2,
      box: box(0.1),
    });
  });

  it("follows a header printed on an earlier page", () => {
    expect(
      slipHeader([{ page: 2, box: box(0.3), printedOn: 1 }], 2),
    ).toEqual({ page: 1, box: box(0.3) });
  });

  it("carries the last printed headings onto a continuation page", () => {
    const headers = [
      { page: 1, box: box(0.3) },
      { page: 2, box: box(0.1) },
    ];
    expect(slipHeader(headers, 4)).toEqual({ page: 2, box: box(0.1) });
  });

  it("has nothing before the table starts", () => {
    expect(slipHeader([{ page: 2, box: box(0.1) }], 1)).toBeUndefined();
    expect(slipHeader(undefined, 1)).toBeUndefined();
  });
});

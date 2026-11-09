import { expect, it } from "vitest";
import {
  missingPagesNote,
  missingPagesWarning,
  slipPageNumbers,
  wholeSavedText,
} from "./slip-pages";

it("reads the printed page number formats suppliers use", () => {
  for (const text of [
    "Page 2 of 3",
    "PAGE.2/3",
    "Page. 2/3",
    "Page # 2/3",
    "Page2/3",
    "Pg2/3",
    "Page 2 of3",
    "Page No. 2 / 3",
    "Page: 2 of 3 Date 01/02/26",
  ])
    expect(slipPageNumbers(text), text).toEqual([
      { total: 3, seen: [2], missing: [1, 3] },
    ]);
});

it("ignores counts that are not page numbers and impossible pages", () => {
  expect(
    slipPageNumbers("2 of 3 cartons\nQty 4/6\nPage 4 of 3\nPage 0 of 2"),
  ).toEqual([]);
  expect(slipPageNumbers("Page 1 of 25")).toEqual([]);
});

it("warns only when a numbered page is missing", () => {
  expect(missingPagesWarning("Page 1 of 1")).toBeNull();
  expect(missingPagesWarning("Page 1 of 2\n...\nPage 2 of 2")).toBeNull();
  expect(missingPagesWarning("No page numbers here")).toBeNull();
  expect(missingPagesWarning("Page 1 of 3\nPage 3 of 3")).toBe(
    "The slip is numbered as 3 pages, but page 2 is not in this scan. Scan every page so no lines are missed.",
  );
  expect(missingPagesWarning("Page 1 of 4")).toContain(
    "but pages 2, 3 and 4 are not in this scan.",
  );
});

it("checks two slips in one scan apart", () => {
  expect(missingPagesWarning("Page 1 of 1\nPage 1 of 2")).toBe(
    "The slip is numbered as 2 pages, but page 2 is not in this scan. Scan every page so no lines are missed.",
  );
});

it("trusts the scanned page count over a page number it could not read", () => {
  expect(missingPagesWarning("Page 1 of 2", 2)).toBeNull();
  expect(missingPagesWarning("Page 1 of 2", 1)).not.toBeNull();
});

it("names missing pages briefly for list rows", () => {
  expect(missingPagesNote("Page 1 of 3\nPage 3 of 3")).toBe(
    "Page 2 of 3 not scanned",
  );
  expect(missingPagesNote("Page 1 of 4")).toBe(
    "Pages 2, 3 and 4 of 4 not scanned",
  );
  expect(missingPagesNote("Page 1 of 1\nPage 2 of 2")).toBe(
    "Page 1 of 2 not scanned",
  );
  expect(missingPagesNote("Page 1 of 2\nPage 2 of 2")).toBeNull();
  expect(missingPagesNote("Page 1 of 2", 2)).toBeNull();
});

it("only trusts saved text that was not cut short", () => {
  expect(wholeSavedText("Page 1 of 2")).toBe("Page 1 of 2");
  expect(wholeSavedText("x".repeat(48000))).toBeNull();
  expect(wholeSavedText(undefined)).toBeNull();
});

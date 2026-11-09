import { expect, it } from "vitest";
import {
  missingPagesNote,
  missingPagesWarning,
  scanCount,
  scanCountMessage,
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

const page = (n: number, of: number, body = "") =>
  `WOLSELEY PACKING SLIP PO-155\n${body}\nPage ${n} of ${of}`;
const body = (seed: number) =>
  Array.from(
    { length: 40 },
    (_, i) => `PVC-${seed}-${i} pipe${seed}x${i}`,
  ).join("\n");

it("counts printed pages while a slip is being captured", () => {
  expect(scanCount([])).toEqual({
    last: null,
    repeats: null,
    total: null,
    missing: [],
  });
  expect(scanCount([page(1, 3)])).toMatchObject({
    last: { page: 1, total: 3 },
    missing: [2, 3],
  });
  expect(scanCount([page(1, 3), undefined])).toMatchObject({
    last: null,
    total: 3,
    missing: [2, 3],
  });
  expect(scanCount([page(1, 3), page(3, 3), page(2, 3)]).missing).toEqual([]);
  expect(scanCount(["no numbers", null]).total).toBeNull();
});

it("follows the latest slip when one scan holds two", () => {
  expect(scanCount([page(1, 1), page(1, 2)])).toMatchObject({
    total: 2,
    missing: [2],
    repeats: null,
  });
});

it("spots a page captured twice by its number or its words", () => {
  expect(scanCount([page(1, 2), page(2, 2), page(1, 2)]).repeats).toBe(1);
  expect(scanCount([page(1, 2), page(2, 2)]).repeats).toBeNull();
  expect(scanCount([body(1), body(2)]).repeats).toBeNull();
  expect(scanCount([body(1), body(2), `${body(1)}\nsmudge`]).repeats).toBe(1);
  // Too few words to tell pages apart.
  expect(scanCount(["Valve 6", "Valve 6"]).repeats).toBeNull();
  // Different printed pages are different even when the words agree.
  expect(
    scanCount([page(1, 2, body(1)), page(2, 2, body(1))]).repeats,
  ).toBeNull();
});

it("says where the scan is in the slip", () => {
  expect(scanCountMessage(scanCount([page(1, 3)]))).toEqual({
    warn: false,
    text: "Page 1 of 3. Still to scan: pages 2 and 3 of 3.",
  });
  expect(scanCountMessage(scanCount([page(1, 2), page(2, 2)]))).toEqual({
    warn: false,
    text: "Page 2 of 2. All 2 pages captured.",
  });
  expect(scanCountMessage(scanCount([page(1, 2), page(1, 2)]))).toEqual({
    warn: true,
    text: "This is page 1 of 2 again. Retake it if you meant the next page.",
  });
  expect(scanCountMessage(scanCount([body(1), `${body(1)} x`]))).toEqual({
    warn: true,
    text: "This looks like the same page as page 1 of this scan. Retake it if you meant the next page.",
  });
  expect(scanCountMessage(scanCount([page(1, 3), "no number"]))).toEqual({
    warn: false,
    text: "Still to scan: pages 2 and 3 of 3.",
  });
  expect(scanCountMessage(scanCount(["no number"]))).toBeNull();
});

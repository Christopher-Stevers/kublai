import { expect, it } from "vitest";
import {
  boundedSlipBox,
  selectedSlipText,
  slipSourceTextUrl,
  slipPdfTextBox,
  type SlipSourceWord,
} from "./slip-source-selection";

const words: SlipSourceWord[] = [
  { page: 1, text: "25", x: 0.8, y: 0.3, width: 0.1, height: 0.02 },
  { page: 1, text: "Copper pipe", x: 0.2, y: 0.301, width: 0.3, height: 0.02 },
  {
    page: 1,
    text: "Different line",
    x: 0.2,
    y: 0.35,
    width: 0.3,
    height: 0.02,
  },
  { page: 2, text: "Other page", x: 0.2, y: 0.3, width: 0.3, height: 0.02 },
];
it("maps embedded text bounds through upright and rotated PDF viewports", () => {
  expect(slipPdfTextBox([20, 0, 0, -20, 100, 320], 400, 1000, 1000)).toEqual({
    x: 0.1,
    y: 0.3,
    width: 0.4,
    height: 0.020000000000000018,
  });
  expect(slipPdfTextBox([0, 20, 20, 0, 300, 100], 400, 1000, 1000)).toEqual({
    x: 0.3,
    y: 0.1,
    width: 0.020000000000000018,
    height: 0.4,
  });
  expect(slipPdfTextBox([0, 0, 0, 0, 0, 0], 400, 1000, 1000)).toBeUndefined();
});
it("reads only selected source words, in row and column order", () => {
  expect(
    selectedSlipText(words, 1, { x: 0.1, y: 0.29, width: 0.8, height: 0.04 }),
  ).toBe("Copper pipe 25");
  expect(
    selectedSlipText(words, 2, { x: 0.1, y: 0.29, width: 0.8, height: 0.04 }),
  ).toBe("Other page");
});
it("does not infer text when a crop only grazes the next row or has no text", () => {
  expect(
    selectedSlipText(words, 1, { x: 0.1, y: 0.32, width: 0.8, height: 0.032 }),
  ).toBe("");
  expect(selectedSlipText([], 1, { x: 0, y: 0, width: 1, height: 1 })).toBe("");
});
it("bounds crop coordinates and rejects invalid or empty boxes", () => {
  expect(boundedSlipBox({ x: -0.1, y: 0.5, width: 0.4, height: 0.8 })).toEqual({
    x: 0,
    y: 0.5,
    width: 0.30000000000000004,
    height: 0.5,
  });
  expect(boundedSlipBox({ x: 0, y: 0, width: NaN, height: 1 })).toBeUndefined();
  expect(boundedSlipBox({ x: 1, y: 0, width: 1, height: 1 })).toBeUndefined();
  expect(boundedSlipBox({ x: 0, y: 0, width: -1, height: 1 })).toBeUndefined();
});
it("accepts only the authenticated document route for the source cache", () => {
  const url =
    "/api/job-documents/files/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb?jobId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  expect(slipSourceTextUrl(url)).toBe(
    url.replace("?jobId", "/source-text?jobId"),
  );
  expect(slipSourceTextUrl(`https://other.test${url}`)).toBeUndefined();
  expect(
    slipSourceTextUrl(`${url}&redirect=https://other.test`),
  ).toBeUndefined();
});

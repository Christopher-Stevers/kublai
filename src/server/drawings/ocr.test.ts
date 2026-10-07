import { describe, expect, it } from "vitest";
import { drawingOcrWords } from "./ocr";
const geometry = {
  sheetWidth: 4000,
  sheetHeight: 2000,
  left: 1000,
  top: 500,
  cropWidth: 2000,
  cropHeight: 1000,
  rasterWidth: 1000,
  rasterHeight: 500,
};
const row = (
  x: number,
  y: number,
  width: number,
  height: number,
  confidence: string,
  text: string,
) =>
  `5\t1\t1\t1\t1\t1\t${x}\t${y}\t${width}\t${height}\t${confidence}\t${text}`;
describe("bounded drawing OCR coordinates", () => {
  it("maps resized regional OCR back to the original sheet", () => {
    expect(
      drawingOcrWords(
        `header\n${row(100, 50, 200, 100, "95", "ROOM 12")}`,
        geometry,
      ),
    ).toEqual([
      { text: "ROOM 12", left: 0.3, top: 0.3, right: 0.4, bottom: 0.4 },
    ]);
  });
  it("rejects invalid confidence/negative bounds and clips out-of-sheet results", () => {
    const rows = [
      row(10, 10, 10, 10, "NaN", "bad"),
      row(-1, 0, 5, 5, "99", "bad"),
      row(0, 0, 0, 10, "99", "empty"),
      row(1000, 500, 3000, 1000, "99", "edge"),
    ];
    expect(drawingOcrWords(`header\n${rows.join("\n")}`, geometry)).toEqual([
      { text: "edge", left: 0.75, top: 0.75, right: 1, bottom: 1 },
    ]);
  });
});

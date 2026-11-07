import { expect, it } from "vitest";
import sharp from "sharp";
import { estimatePageWarp, sourceY, dewarpPage, originalWord } from "./dewarp";
import type { SlipWord } from "./ocr-rows";
function words(curved = true): SlipWord[] {
  return [0.2, 0.3, 0.4, 0.5].flatMap((y) =>
    [0.15, 0.45, 0.65, 0.8].map((x, i) => ({
      text: i === 0 ? "AB123" : i === 1 ? "15.00" : "0.00",
      x,
      y: y + (curved ? [0, 0.008, 0.003, 0][i]! : 0),
      width: 0.03,
      height: 0.01,
      confidence: 95,
    })),
  );
}
it("flattens repeated curved rows without changing text or x coordinates", () => {
  const warp = estimatePageWarp(words())!;
  expect(warp).not.toBeNull();
  expect(sourceY(warp, 0.465, 0.313) - sourceY(warp, 0.815, 0.313)).toBeCloseTo(
    0.008,
    4,
  );
  const w = words()[1]!;
  expect(originalWord(warp, w).text).toBe(w.text);
  expect(originalWord(warp, w).x).toBe(w.x);
});
it("leaves flat, sparse and low-confidence pages unchanged", () => {
  expect(estimatePageWarp(words(false))).toBeNull();
  expect(estimatePageWarp(words().slice(0, 4))).toBeNull();
  expect(
    estimatePageWarp(words().map((w) => ({ ...w, confidence: 30 }))),
  ).toBeNull();
});
it("preserves the page dimensions and pixels at the outer edges", async () => {
  const source = await sharp({
    create: { width: 100, height: 120, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const result = await dewarpPage(source, estimatePageWarp(words())!);
  const m = await sharp(result).metadata();
  expect([m.width, m.height]).toEqual([100, 120]);
  expect(
    (await sharp(result).stats()).channels.every((c) => c.min === 255),
  ).toBe(true);
});
it("keeps the inverse mapping monotonic so rows cannot cross", () => {
  const warp = estimatePageWarp(words())!;
  for (const x of [0.1, 0.45, 0.65, 0.9])
    for (let y = 0.001; y < 1; y += 0.001)
      expect(sourceY(warp, x, y)).toBeGreaterThan(sourceY(warp, x, y - 0.001));
});

it("prepared rows preserve every source coordinate including anchor and paper edges", async () => {
  const { prepareSourceRows } = await import("./dewarp");
  for (const count of [1, 3, 12]) {
    const warp = {
      maxOffset: 0.008,
      anchors: Array.from({ length: count }, (_, i) => ({
        y: 0.1 + i * 0.07,
        points: [
          { x: 0.1, offset: 0 },
          { x: 0.45, offset: 0.008 - i * 0.0001 },
          { x: 0.65, offset: 0.003 },
          { x: 0.9, offset: 0 },
        ],
      })),
    };
    const width = 171,
      height = 221,
      row = prepareSourceRows(warp, width, height);
    for (let y = 0; y < height; y++) {
      const values = row(y);
      for (let x = 0; x < width; x++)
        expect(values[x]).toBe(
          sourceY(warp, x / (width - 1), y / (height - 1)),
        );
    }
  }
});

it("produces byte-identical pixels to the original inverse mapping", async () => {
  const warp = {
    maxOffset: 0.008,
    anchors: [0.1, 0.4, 0.8].map((y) => ({
      y,
      points: [
        { x: 0, offset: -0.002 },
        { x: 0.4, offset: 0.008 },
        { x: 1, offset: 0 },
      ],
    })),
  };
  const width = 173,
    height = 229,
    channels = 3;
  const data = Buffer.from(
    Array.from(
      { length: width * height * channels },
      (_, i) => (i * 13 + Math.floor(i / width) * 7) % 256,
    ),
  );
  const expected = Buffer.from(data);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sy =
          sourceY(warp, x / (width - 1), y / (height - 1)) * (height - 1),
        y0 = Math.floor(sy),
        t = sy - y0;
      if (y0 < 0 || y0 >= height - 1) continue;
      for (let c = 0; c < channels; c++)
        expected[(y * width + x) * channels + c] = Math.round(
          data[(y0 * width + x) * channels + c]! * (1 - t) +
            data[((y0 + 1) * width + x) * channels + c]! * t,
        );
    }
  const input = await sharp(data, { raw: { width, height, channels } })
    .png()
    .toBuffer();
  const output = await sharp(await dewarpPage(input, warp))
    .raw()
    .toBuffer();
  expect(output.equals(expected)).toBe(true);
});

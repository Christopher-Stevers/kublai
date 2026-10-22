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

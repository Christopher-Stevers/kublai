// @vitest-environment node
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { prepareTerraImages, restoreTerraCoordinates } from "./terra-images";
import type { FallbackInput, FallbackOutput } from "./terra-fallback";
const input = (): FallbackInput => ({
  orders: [],
  linkedOrderId: "order",
  candidatePoolComplete: true,
  reasons: ["Uncertain quantity"],
  targetLineIndexes: [0],
  headers: [{ page: 2, box: { x: 0, y: 0.1, width: 1, height: 0.03 } }],
  earlierLines: [
    {
      page: 2,
      evidence: "part",
      orderItemId: null,
      shipped: null,
      backordered: null,
      unit: "ea",
      issues: [],
      box: { x: 0.1, y: 0.7, width: 0.8, height: 0.05 },
    },
  ],
});
const page = () =>
  sharp({
    create: { width: 800, height: 1000, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
describe("Terra selective page images", () => {
  it("omits resolved pages, keeps headers/full-width rows and restores original coordinates", async () => {
    const p = await page();
    const images = await prepareTerraImages([p, p], input());
    expect(images).toHaveLength(1);
    const image = images[0]!;
    expect(image.page).toBe(2);
    expect(image.imageHeight).toBeLessThan(250);
    expect((await sharp(image.png).metadata()).width).toBe(800);
    expect(image.bands).toHaveLength(2);
    const rowBand = image.bands[1]!;
    const result = {
      lines: [
        {
          page: 2,
          box: {
            x: 0.1,
            y: (rowBand.outputTop + 700 - rowBand.top) / image.imageHeight,
            height: 50 / image.imageHeight,
            width: 0.8,
          },
        },
      ],
    } as FallbackOutput;
    restoreTerraCoordinates(result, images);
    expect(result.lines[0]!.box.y).toBeCloseTo(0.7);
    expect(result.lines[0]!.box.height).toBeCloseTo(0.05);
    const crossing = {
      lines: [{ page: 2, box: { x: 0, y: 0, width: 1, height: 1 } }],
    } as FallbackOutput;
    expect(() => restoreTerraCoordinates(crossing, images)).toThrow(/boundary/);
  });
  it("retains full evidence for uncertain order, structure, absent headers or invalid boxes", async () => {
    const p = await page();
    for (const override of [
      { linkedOrderId: null },
      { targetLineIndexes: null },
      { reasons: ["Page coverage or totals need another reading"] },
      { targetLineIndexes: [99] },
    ]) {
      const images = await prepareTerraImages([p, p], {
        ...input(),
        ...override,
      });
      expect(images).toHaveLength(2);
      expect(images.every((i) => i.imageHeight === 1000)).toBe(true);
    }
    for (const override of [
      { headers: [] },
      { earlierLines: [{ ...input().earlierLines[0]!, box: undefined }] },
    ]) {
      const images = await prepareTerraImages([p, p], {
        ...input(),
        ...override,
      });
      expect(images[0]!.imageHeight).toBe(1000);
    }
  });
  it("merges nearby rows without duplicating them and leaves dense pages intact", async () => {
    const p = await page();
    const c = input();
    c.earlierLines.push({
      ...c.earlierLines[0]!,
      box: { x: 0, y: 0.76, width: 1, height: 0.04 },
    });
    c.targetLineIndexes = [0, 1];
    expect((await prepareTerraImages([p, p], c))[0]!.bands).toHaveLength(2);
    c.earlierLines[0]!.box = { x: 0, y: 0.15, width: 1, height: 0.8 };
    expect((await prepareTerraImages([p, p], c))[0]!.imageHeight).toBe(1000);
  });
});

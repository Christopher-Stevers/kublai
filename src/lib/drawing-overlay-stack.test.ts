import { describe, expect, it } from "vitest";
import {
  addStackInk,
  compositeInkStack,
  createInkStack,
  defaultOverlayInk,
  overlayLabel,
} from "./drawing-overlay-stack";
import { compositeDrawingInk } from "./drawing-line-overlay";

function render(
  masks: number[][],
  opacities = masks.map(() => 1),
  common = "#000000",
) {
  const stack = createInkStack(masks[0]!.length);
  const styles = masks.map((_, i) => ({
    ...defaultOverlayInk(i),
    opacity: opacities[i]!,
  }));
  masks.forEach((mask, i) =>
    addStackInk(stack, new Uint8Array(mask), i, styles[i]!.opacity),
  );
  const pixels = new Uint8ClampedArray(masks[0]!.length * 4);
  compositeInkStack(pixels, stack, styles, 0, masks[0]!.length, common);
  return { pixels: [...pixels], stack, styles };
}

describe("streaming overlay stack", () => {
  it("renders each unique layer in its own colour and shared lines from any two layers black", () => {
    const { pixels } = render([
      [255, 0, 0, 0, 0],
      [0, 255, 0, 255, 0],
      [0, 0, 255, 255, 0],
      [0, 0, 0, 0, 255],
    ]);
    expect(pixels).toEqual([
      220, 38, 38, 255, 37, 99, 235, 255, 22, 163, 74, 255, 0, 0, 0, 255, 147,
      51, 234, 255,
    ]);
  });
  it("ignores hidden drawings and keeps common ink at the strongest visible opacity", () => {
    expect(render([[255], [255], [255]], [0, 0.5, 0]).pixels).toEqual([
      37, 99, 235, 128,
    ]);
    expect(render([[255], [255], [255]], [0.25, 0.5, 1]).pixels).toEqual([
      0, 0, 0, 255,
    ]);
    expect(render([[255], [255], [255]], [0, 0, 0]).pixels).toEqual([
      0, 0, 0, 0,
    ]);
  });
  it("uses white common ink for inverted paper and preserves the grey antialiasing fringe", () => {
    expect(
      render(
        [
          [128, 16],
          [128, 16],
          [0, 0],
        ],
        undefined,
        "#ffffff",
      ).pixels,
    ).toEqual([255, 255, 255, 255, 255, 255, 255, 64]);
  });
  it("matches the two-layer compositor, allowing only 8-bit opacity rounding", () => {
    const first = Array.from({ length: 256 }, (_, i) => i);
    const second = first.map((i) => (i * 31) % 256);
    for (const opacities of [
      [1, 1],
      [0.37, 0.6],
      [0, 1],
      [1, 0],
    ]) {
      const result = render([first, second], opacities);
      const pair = new Uint8ClampedArray(1024);
      compositeDrawingInk(pair, new Uint8Array(first), new Uint8Array(second), [
        result.styles[0]!,
        result.styles[1]!,
      ]);
      result.pixels.forEach((pixel, i) =>
        expect(Math.abs(pixel - pair[i]!)).toBeLessThanOrEqual(1),
      );
    }
  });
  it("streams hundreds of layers with constant buffer sizes and retains colours beyond two layers", () => {
    const stack = createInkStack(256);
    const before = Object.values(stack).reduce(
      (total, buffer) => total + buffer.byteLength,
      0,
    );
    const styles = Array.from({ length: 300 }, (_, i) => defaultOverlayInk(i));
    for (let i = 0; i < 300; i++) {
      const mask = new Uint8Array(256);
      mask[i % 256] = 255;
      addStackInk(stack, mask, i, 1);
    }
    const output = new Uint8ClampedArray(1024);
    compositeInkStack(output, stack, styles);
    expect(
      Object.values(stack).reduce(
        (total, buffer) => total + buffer.byteLength,
        0,
      ),
    ).toBe(before);
    expect([...output.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    expect(stack.firstLayer[200]).toBe(200);
    expect([...output.slice(800, 804)]).toEqual([220, 38, 38, 255]);
    expect(overlayLabel(299)).toBe("Drawing 300");
  });
  it("supports cancellable chunked accumulation and composition", () => {
    const stack = createInkStack(4),
      mask = new Uint8Array([255, 255, 255, 255]);
    addStackInk(stack, mask, 0, 1, 0, 2);
    addStackInk(stack, mask, 1, 1, 2, 4);
    const output = new Uint8ClampedArray(16),
      styles = [defaultOverlayInk(0), defaultOverlayInk(1)];
    compositeInkStack(output, stack, styles, 0, 2);
    compositeInkStack(output, stack, styles, 2, 4);
    expect([...output]).toEqual([
      220, 38, 38, 255, 220, 38, 38, 255, 37, 99, 235, 255, 37, 99, 235, 255,
    ]);
  });
});

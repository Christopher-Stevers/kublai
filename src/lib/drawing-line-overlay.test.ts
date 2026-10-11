import { describe, expect, it } from "vitest";
import type { OverlayInkStyle } from "./drawing-line-overlay";
import {
  boundedOverlayPatch,
  drawingInk,
  MAX_OVERLAY_PIXELS,
  overlayBounds,
  overlaySourceRect,
  planOverlayPatch,
} from "./drawing-line-overlay";
import {
  addStackInk,
  compositeInkStack,
  createInkStack,
} from "./drawing-overlay-stack";

describe("drawing line overlays", () => {
  it("uses white shared lines on inverted paper while retaining each drawing's chosen colour and opacity", () => {
    const pixels = new Uint8ClampedArray(12);
    renderTwoLayers(
      pixels,
      new Uint8Array([255, 255, 0]),
      new Uint8Array([255, 0, 255]),
      [
        { color: "#9333ea", opacity: 0.3 },
        { color: "#16a34a", opacity: 0.6 },
      ],
      0,
      3,
      "#ffffff",
    );
    expect([...pixels]).toEqual([
      255, 255, 255, 153, 147, 51, 234, 76, 22, 163, 74, 153,
    ]);
  });
  it("removes paper and transparent pixels while retaining coloured and antialiased ink", () => {
    expect([
      ...drawingInk(
        new Uint8ClampedArray([
          255, 255, 255, 255, 251, 251, 251, 255, 0, 0, 0, 0, 0, 0, 0, 128, 255,
          0, 0, 255,
        ]),
      ),
    ]).toEqual([0, 0, 0, 128, 255]);
  });
  it("renders shared lines black with arbitrary hues and each distinct line in its chosen colour", () => {
    const pixels = new Uint8ClampedArray(16);
    renderTwoLayers(
      pixels,
      new Uint8Array([255, 255, 0, 0]),
      new Uint8Array([255, 0, 255, 0]),
      [
        { color: "#9333ea", opacity: 1 },
        { color: "#16a34a", opacity: 1 },
      ],
    );
    expect([...pixels]).toEqual([
      0, 0, 0, 255, 147, 51, 234, 255, 22, 163, 74, 255, 0, 0, 0, 0,
    ]);
  });
  it("keeps antialiased and differently weighted common strokes neutral instead of purple", () => {
    const pixels = new Uint8ClampedArray(20);
    renderTwoLayers(
      pixels,
      new Uint8Array([128, 255, 180, 255, 0]),
      new Uint8Array([128, 180, 255, 0, 255]),
      [
        { color: "#ff0000", opacity: 1 },
        { color: "#0000ff", opacity: 1 },
      ],
    );
    expect([...pixels]).toEqual([
      0,
      0,
      0,
      255, // grey CAD underlays become solid shared black
      0,
      0,
      0,
      255, // shared solid core, even with different PDF line weights
      0,
      0,
      0,
      255,
      255,
      0,
      0,
      255, // first-sheet-only ink
      0,
      0,
      255,
      255, // second-sheet-only ink
    ]);
  });
  it("keeps a soft neutral fringe on shared antialiased edges", () => {
    const pixels = new Uint8ClampedArray(4);
    renderTwoLayers(pixels, new Uint8Array([16]), new Uint8Array([16]), [
      { color: "#ff0000", opacity: 1 },
      { color: "#0000ff", opacity: 1 },
    ]);
    expect([...pixels]).toEqual([0, 0, 0, 64]);
  });
  it("does not classify a faint edge against a strong changed line as fully shared", () => {
    const pixels = new Uint8ClampedArray(4);
    renderTwoLayers(pixels, new Uint8Array([255]), new Uint8Array([40]), [
      { color: "#ff0000", opacity: 1 },
      { color: "#0000ff", opacity: 1 },
    ]);
    expect(pixels[0]).toBeGreaterThan(200);
    expect(pixels[1]).toBe(0);
    expect(pixels[2]).toBe(0);
    expect(pixels[3]).toBe(255);
  });
  it("applies opacity separately and exposes the other colour when a drawing is hidden", () => {
    const pixels = new Uint8ClampedArray(12);
    const first = new Uint8Array([255, 255, 0]),
      second = new Uint8Array([255, 0, 255]);
    renderTwoLayers(pixels, first, second, [
      { color: "#9333ea", opacity: 0.3 },
      { color: "#16a34a", opacity: 0.6 },
    ]);
    expect([...pixels]).toEqual([
      0, 0, 0, 153, 147, 51, 234, 76, 22, 163, 74, 153,
    ]);
    renderTwoLayers(pixels, first, second, [
      { color: "#9333ea", opacity: 0 },
      { color: "#16a34a", opacity: 0.6 },
    ]);
    expect([...pixels]).toEqual([
      22, 163, 74, 153, 0, 0, 0, 0, 22, 163, 74, 153,
    ]);
  });
  it("composites chunks without overwriting other rows", () => {
    const pixels = new Uint8ClampedArray(12).fill(19);
    renderTwoLayers(
      pixels,
      new Uint8Array([255, 255, 255]),
      new Uint8Array([255, 0, 255]),
      [
        { color: "#ff0000", opacity: 1 },
        { color: "#0000ff", opacity: 1 },
      ],
      1,
      2,
    );
    expect([...pixels]).toEqual([
      19, 19, 19, 19, 255, 0, 0, 255, 19, 19, 19, 19,
    ]);
  });
  it("registers differently sized sheets in the same raster and crops from its sheet origin", () => {
    const patch = {
      left: 0.2,
      top: 0.3,
      width: 0.4,
      height: 0.4,
      pixelWidth: 400,
      pixelHeight: 240,
      fullWidth: 1000,
      fullHeight: 600,
    };
    const rect = overlaySourceRect(patch, { width: 1000, height: 600 }, 0.8, {
      x: 0.1,
      y: -0.05,
      scale: 1.2,
    });
    expect(rect).toEqual({ width: 1200, height: 960, left: -200, top: -390 });
    expect(
      overlayBounds({ width: 1000, height: 600 }, 0.8, {
        x: 0.1,
        y: -0.05,
        scale: 1.2,
      }),
    ).toEqual({ left: 0, top: -0.35000000000000003, right: 1.2, bottom: 1.25 });
  });
  it("keeps detail on a shifted second sheet outside the primary and bounds memory at high zoom", () => {
    const fit = { width: 1000, height: 600 },
      frame = { width: 1000, height: 600 };
    const bounds = overlayBounds(fit, 0.6, { x: 1, y: 0, scale: 1 });
    const patch = planOverlayPatch(
      fit,
      frame,
      { scale: 10, x: -10000, y: 0 },
      3,
      bounds,
    )!;
    expect(patch.left).toBeGreaterThan(1);
    expect(patch.left + patch.width).toBeLessThanOrEqual(2);
    expect(patch.pixelWidth * patch.pixelHeight).toBeLessThanOrEqual(
      MAX_OVERLAY_PIXELS,
    );
    expect(patch.fullWidth * patch.width).toBeCloseTo(patch.pixelWidth);
  });
  it("retains the full extent of portrait and moved sheets in a bounded overview", () => {
    const bounds = overlayBounds({ width: 1200, height: 900 }, 1.5, {
      x: -0.5,
      y: 0.2,
      scale: 1,
    });
    expect(bounds).toEqual({ left: -0.5, top: -0.3, right: 1, bottom: 1.7 });
    const patch = boundedOverlayPatch({
      left: -0.5,
      top: -0.3,
      width: 1.5,
      height: 2,
      pixelWidth: 6000,
      pixelHeight: 8000,
      fullWidth: 4000,
      fullHeight: 4000,
    });
    expect(patch.left).toBe(-0.5);
    expect(patch.width).toBe(1.5);
    expect(patch.pixelWidth * patch.pixelHeight).toBeLessThanOrEqual(
      MAX_OVERLAY_PIXELS,
    );
  });
});

function renderTwoLayers(
  output: Uint8ClampedArray,
  first: Uint8Array,
  second: Uint8Array,
  styles: [OverlayInkStyle, OverlayInkStyle],
  start = 0,
  end = first.length,
  common = "#000000",
) {
  const stack = createInkStack(first.length);
  addStackInk(stack, first, 0, styles[0].opacity);
  addStackInk(stack, second, 1, styles[1].opacity);
  compositeInkStack(output, stack, styles, start, end, common);
}

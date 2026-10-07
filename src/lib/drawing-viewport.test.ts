import { describe, expect, it } from "vitest";
import {
  MAX_DRAWING_PATCH_EDGE,
  MAX_DRAWING_PATCH_PIXELS,
  patchCoversView,
  patchScreenCoverage,
  planDrawingPatch,
  visibleDrawingRect,
} from "./drawing-viewport";

describe("drawing viewport geometry", () => {
  it("uses rotated-preview coordinates and excludes the empty letterbox", () => {
    expect(
      visibleDrawingRect(
        { width: 400, height: 200 },
        { width: 400, height: 800 },
        { scale: 1, x: 0, y: 0 },
      ),
    ).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
    expect(
      visibleDrawingRect(
        { width: 400, height: 200 },
        { width: 400, height: 800 },
        { scale: 4, x: 0, y: 0 },
      ),
    ).toEqual({ left: 0.375, top: 0, right: 0.625, bottom: 1 });
    expect(
      visibleDrawingRect(
        { width: 400, height: 200 },
        { width: 400, height: 800 },
        { scale: 4, x: 200, y: 100 },
      ),
    ).toEqual({ left: 0.25, top: 0, right: 0.5, bottom: 0.875 });
  });

  it("reserves a quarter-screen guard band for panning, clipped to the page", () => {
    const fit = { width: 1000, height: 500 };
    const frame = { width: 400, height: 300 };
    const view = { scale: 4, x: 0, y: 0 };
    const patch = planDrawingPatch(fit, frame, view, 1)!;
    expect(patch.left).toBeCloseTo(0.425);
    expect(patch.top).toBeCloseTo(0.3875);
    expect(patch.width).toBeCloseTo(0.15);
    expect(patch.height).toBeCloseTo(0.225);
    expect(
      patchCoversView(patch, fit, frame, { ...view, x: 80, y: 50 }, 1),
    ).toBe(true);
    expect(patchCoversView(patch, fit, frame, { ...view, x: 150 }, 1)).toBe(
      false,
    );
    expect(patchScreenCoverage(patch, fit, frame, { ...view, x: 5000 })).toBe(
      0,
    );
    const corner = planDrawingPatch(
      fit,
      frame,
      { ...view, x: 1800, y: 850 },
      1,
    )!;
    expect(corner.left).toBe(0);
    expect(corner.top).toBe(0);
  });

  it("requires new detail after zooming in but reuses a capped-resolution patch without an endless redraw", () => {
    const fit = { width: 1000, height: 500 };
    const phone = { width: 390, height: 844 };
    const view = { scale: 4, x: 0, y: 0 };
    const patch = planDrawingPatch(fit, phone, view, 3)!;
    expect(patchCoversView(patch, fit, phone, view, 3)).toBe(true);
    expect(patchCoversView(patch, fit, phone, { ...view, scale: 8 }, 3)).toBe(
      false,
    );
    const large = { width: 3840, height: 2160 };
    const capped = planDrawingPatch(fit, large, view, 3)!;
    expect(capped.fullWidth).toBeLessThan(fit.width * view.scale * 3);
    expect(patchCoversView(capped, fit, large, view, 3)).toBe(true);
    expect(patchCoversView(capped, fit, large, view, 9)).toBe(true);
  });

  it("keeps every buffer bounded across phone, tablet, desktop and extreme aspect ratios", () => {
    const sizes = [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 2560, height: 1600 },
      { width: 3840, height: 2160 },
      { width: 256, height: 8192 },
      { width: 8192, height: 256 },
    ];
    for (const frame of sizes) {
      for (const fit of [
        { width: 390, height: 240 },
        { width: 1024, height: 4096 },
      ]) {
        for (const scale of [1, 1.7, 4, 12, 24]) {
          for (const dpr of [1, 1.5, 2, 3, 8]) {
            const view = { scale, x: 0, y: 0 };
            const patch = planDrawingPatch(fit, frame, view, dpr)!;
            expect(patch.pixelWidth).toBeGreaterThan(0);
            expect(patch.pixelHeight).toBeGreaterThan(0);
            expect(patch.pixelWidth).toBeLessThanOrEqual(
              MAX_DRAWING_PATCH_EDGE,
            );
            expect(patch.pixelHeight).toBeLessThanOrEqual(
              MAX_DRAWING_PATCH_EDGE,
            );
            expect(patch.pixelWidth * patch.pixelHeight).toBeLessThanOrEqual(
              MAX_DRAWING_PATCH_PIXELS,
            );
            expect(patch.left).toBeGreaterThanOrEqual(0);
            expect(patch.top).toBeGreaterThanOrEqual(0);
            expect(patch.left + patch.width).toBeLessThanOrEqual(1);
            expect(patch.top + patch.height).toBeLessThanOrEqual(1);
            expect(patchScreenCoverage(patch, fit, frame, view)).toBeCloseTo(1);
            expect(patchCoversView(patch, fit, frame, view, dpr)).toBe(true);
          }
        }
      }
    }
  });

  it("keeps source points aligned with the preview after zoom, drag and device rotation", () => {
    const originalFit = { width: 390, height: 234 };
    const originalFrame = { width: 390, height: 844 };
    const patch = planDrawingPatch(
      originalFit,
      originalFrame,
      { scale: 8, x: 30, y: -10 },
      3,
    )!;
    const points = [0.1, 0.5, 0.9];
    for (const fit of [originalFit, { width: 650, height: 390 }]) {
      for (const frame of [originalFrame, { width: 844, height: 390 }]) {
        for (const view of [
          { scale: 8, x: 80, y: -40 },
          { scale: 3.3, x: -10, y: 50 },
        ]) {
          const pageWidth = fit.width * view.scale;
          const pageHeight = fit.height * view.scale;
          const pageLeft = (frame.width - pageWidth) / 2 + view.x;
          const pageTop = (frame.height - pageHeight) / 2 + view.y;
          for (const fraction of points) {
            const sourceX = patch.left + fraction * patch.width;
            const sourceY = patch.top + fraction * patch.height;
            const rasterX =
              sourceX * patch.fullWidth - patch.left * patch.fullWidth;
            const rasterY =
              sourceY * patch.fullHeight - patch.top * patch.fullHeight;
            const drawnX =
              pageLeft +
              patch.left * pageWidth +
              (rasterX / patch.pixelWidth) * patch.width * pageWidth;
            const drawnY =
              pageTop +
              patch.top * pageHeight +
              (rasterY / patch.pixelHeight) * patch.height * pageHeight;
            expect(drawnX).toBeCloseTo(pageLeft + sourceX * pageWidth, 8);
            expect(drawnY).toBeCloseTo(pageTop + sourceY * pageHeight, 8);
          }
        }
      }
    }
  });

  it("does no raster work for unavailable geometry or a completely offscreen sheet", () => {
    const fit = { width: 400, height: 200 };
    const frame = { width: 400, height: 800 };
    for (const view of [
      { scale: 0, x: 0, y: 0 },
      { scale: 1, x: Number.NaN, y: 0 },
      { scale: 1, x: 2000, y: 0 },
    ]) {
      expect(planDrawingPatch(fit, frame, view, 3)).toBeNull();
    }
    expect(
      planDrawingPatch(
        { width: 0, height: 200 },
        frame,
        { scale: 1, x: 0, y: 0 },
        3,
      ),
    ).toBeNull();
    expect(
      planDrawingPatch(
        fit,
        { width: 400, height: 0 },
        { scale: 1, x: 0, y: 0 },
        3,
      ),
    ).toBeNull();
  });
});

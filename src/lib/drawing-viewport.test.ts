import { describe, expect, it } from "vitest";
import {
  drawingPatchRect,
  drawingPatchSharpness,
  drawingViewLead,
  keepDrawingPatchDuringPan,
  MAX_DRAWING_PATCH_EDGE,
  MAX_DRAWING_PATCH_PIXELS,
  patchCoversView,
  patchScreenCoverage,
  planDrawingPatch,
  planDrawingStrip,
  shiftDrawingView,
  stretchDrawingLead,
  visibleDrawingRect,
} from "./drawing-viewport";

describe("drawing viewport geometry", () => {
  it("keeps small pans cheap but refills long pans, zooms and settled views", () => {
    const fit = {width:390,height:260}, frame = {width:390,height:844};
    const view = {scale:10,x:0,y:0}, patch = planDrawingPatch(fit,frame,view,3)!;
    expect(keepDrawingPatchDuringPan(patch,10,fit,frame,{...view,x:100},true)).toBe(true);
    expect(keepDrawingPatchDuringPan(patch,10,fit,frame,{...view,x:300},true)).toBe(false);
    expect(keepDrawingPatchDuringPan(patch,10,fit,frame,{...view,x:100},false)).toBe(false);
    expect(keepDrawingPatchDuringPan(patch,10,fit,frame,{...view,scale:20},true)).toBe(false);
  });

  it("prioritizes native-density visible pixels over padding at medium zoom on a high-DPI phone", () => {
    const fit = { width: 390, height: 292.5 };
    const frame = { width: 390, height: 700 };
    const view = { scale: 3, x: 0, y: 0 };
    const patch = planDrawingPatch(fit, frame, view, 3)!;
    expect(patchScreenCoverage(patch, fit, frame, view)).toBeCloseTo(1);
    expect(patch.fullWidth / (fit.width * view.scale)).toBeGreaterThan(3.29);
    expect(patch.pixelWidth * patch.pixelHeight).toBeLessThanOrEqual(
      MAX_DRAWING_PATCH_PIXELS,
    );
    const visible = visibleDrawingRect(fit, frame, view)!;
    expect(visible.left - patch.left).toBeLessThan(0.05);
    expect(patchCoversView(patch, fit, frame, view, 3)).toBe(true);
  });

  it("keeps Retina iPad detail at native density in both orientations and deep zoom", () => {
    for (const frame of [
      { width: 1024, height: 1366 },
      { width: 1366, height: 1024 },
      { width: 1032, height: 1376 },
      { width: 1376, height: 1032 },
      { width: 834, height: 1194 },
    ]) {
      const fit = { width: frame.width, height: frame.width * 0.75 };
      for (const scale of [1, 2, 5, 18.31, 24, 35, 50]) {
        const view = { scale, x: 0, y: 0 };
        const patch = planDrawingPatch(fit, frame, view, 2)!;
        expect(patch.fullWidth / (fit.width * scale)).toBeGreaterThan(2.19);
        expect(patch.fullHeight / (fit.height * scale)).toBeGreaterThan(2.19);
        expect(patchScreenCoverage(patch, fit, frame, view)).toBeCloseTo(1);
        expect(patch.pixelWidth * patch.pixelHeight).toBeLessThanOrEqual(MAX_DRAWING_PATCH_PIXELS);
        expect(patchCoversView(patch, fit, frame, view, 2)).toBe(true);
      }
    }
  });

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

  it("spends the guard band ahead of a pan without losing what is visible now", () => {
    const fit = { width: 1000, height: 500 };
    const frame = { width: 400, height: 300 };
    const view = { scale: 4, x: 0, y: 0 };
    const ahead = planDrawingPatch(fit, frame, view, 1, { x: 0.1, y: -0.01 })!;
    // The shift is capped at one margin, so the current view stays covered.
    expect(ahead.left).toBeCloseTo(0.45);
    expect(ahead.width).toBeCloseTo(0.15);
    expect(ahead.top).toBeCloseTo(0.3775);
    expect(patchCoversView(ahead, fit, frame, view, 1)).toBe(true);
    // Further along the pan, only the patch drawn ahead still covers the view.
    const later = { ...view, x: -150 };
    expect(patchCoversView(ahead, fit, frame, later, 1)).toBe(true);
    expect(
      patchCoversView(planDrawingPatch(fit, frame, view, 1)!, fit, frame, later, 1),
    ).toBe(false);
    expect(planDrawingPatch(fit, frame, view, 1, null)).toEqual(
      planDrawingPatch(fit, frame, view, 1),
    );
    expect(
      planDrawingPatch(fit, frame, view, 1, { x: Number.NaN, y: Infinity }),
    ).toEqual(planDrawingPatch(fit, frame, view, 1));
  });

  it("predicts where the visible centre is heading from recent camera motion", () => {
    const fit = { width: 1000, height: 500 };
    // Panning left at 1 screen px/ms: the centre moves right through the sheet.
    const samples = [0, 16, 32, 48, 64].map((at) => ({ scale: 4, x: -at, y: 0, at }));
    const lead = drawingViewLead(samples, fit, 70, 100)!;
    expect(lead.x).toBeCloseTo(100 / 4000);
    expect(lead.y).toBeCloseTo(0);
    expect(shiftDrawingView(samples[0]!, fit, lead)).toEqual({ scale: 4, x: -100, y: 0 });
    // An old fast flick no longer counts once the camera has slowed.
    const slowed = [{ scale: 4, x: 5000, y: 0, at: 0 }, ...samples.map((s) => ({ ...s, at: s.at + 200 }))];
    expect(drawingViewLead(slowed, fit, 270, 100)!.x).toBeCloseTo(100 / 4000);
    // Zooming about the centre does not move it, and the predicted scale
    // change is capped.
    const zoom = [{ scale: 4, x: 0, y: 0, at: 0 }, { scale: 6, x: 0, y: 0, at: 30 }];
    expect(drawingViewLead(zoom, fit, 30, 100)).toEqual({ x: 0, y: 0, zoom: 2 });
    // At rest, or with too little history, there is nothing to predict.
    expect(drawingViewLead(samples, fit, 200, 100)).toBeNull();
    expect(drawingViewLead(samples.slice(-1), fit, 64, 100)).toBeNull();
    expect(drawingViewLead([], fit, 0, 100)).toBeNull();
  });

  it("predicts a zoom about the point under the cursor, off centre", () => {
    const fit = { width: 1000, height: 500 };
    // The sheet point 100px right of the frame centre stays put on screen.
    const at = (scale: number) => ({ scale, x: 100 - 20 * scale, y: -10 + 5 * scale });
    const samples = [0, 16, 32, 48, 64].map((t) => ({ ...at(4 * Math.exp(0.004 * t)), at: t }));
    const lead = drawingViewLead(samples, fit, 64, 100)!;
    expect(lead.zoom).toBeCloseTo(Math.exp(0.4));
    const ahead = shiftDrawingView(samples.at(-1)!, fit, lead);
    const expected = at(samples.at(-1)!.scale * Math.exp(0.4));
    expect(ahead.scale).toBeCloseTo(expected.scale);
    expect(ahead.x).toBeCloseTo(expected.x);
    expect(ahead.y).toBeCloseTo(expected.y);
    // The camera cannot zoom past its limits, so neither does the prediction,
    // and the point under the cursor still stays put.
    const capped = drawingViewLead(samples, fit, 64, 100, { min: 1, max: 5 })!;
    const stopped = shiftDrawingView(samples.at(-1)!, fit, capped);
    expect(stopped.scale).toBeCloseTo(5);
    expect(stopped.x).toBeCloseTo(at(5).x);
    expect(stopped.y).toBeCloseTo(at(5).y);
    expect(drawingViewLead([...samples].reverse().map((s, i) => ({ ...s, at: i * 16 })), fit, 64, 100, { min: 4, max: 50 })!.zoom).toBeCloseTo(1);
  });

  it("draws a zoom for the view it is heading to, a pan around the view it is in", () => {
    const fit = { width: 1000, height: 500 };
    const frame = { width: 400, height: 300 };
    const view = { scale: 4, x: 0, y: 0 };
    const inward = planDrawingPatch(fit, frame, view, 1, { x: 0, y: 0, zoom: 2 })!;
    expect(inward).toEqual(planDrawingPatch(fit, frame, { ...view, scale: 8 }, 1));
    expect(patchCoversView(inward, fit, frame, { ...view, scale: 8 }, 1)).toBe(true);
    const outward = planDrawingPatch(fit, frame, view, 1, { x: 0.01, y: 0, zoom: 0.5 })!;
    expect(outward).toEqual(planDrawingPatch(fit, frame, { scale: 2, x: -20, y: 0 }, 1));
    // A few percent of zoom is within the density tolerance.
    expect(planDrawingPatch(fit, frame, view, 1, { x: 0.1, y: -0.01, zoom: 1.03 })).toEqual(
      planDrawingPatch(fit, frame, view, 1, { x: 0.1, y: -0.01 }),
    );
  });

  it("scores a stack of patches by how much of the screen shows at full detail", () => {
    const fit = { width: 1000, height: 500 };
    const frame = { width: 400, height: 300 };
    const view = { scale: 4, x: 0, y: 0 };
    const sharpness = (...patches: Parameters<typeof drawingPatchSharpness>[0]) =>
      drawingPatchSharpness(patches, fit, frame, view, 1);
    const exact = planDrawingPatch(fit, frame, view, 1)!;
    const coarse = planDrawingPatch(fit, frame, { ...view, scale: 2 }, 1)!;
    const dense = planDrawingPatch(fit, frame, { ...view, scale: 8 }, 1)!;
    expect(sharpness()).toBe(0);
    expect(sharpness(exact)).toBeCloseTo(1);
    expect(sharpness(coarse)).toBeCloseTo(0.5 / 0.95);
    // A denser patch shows on top of a coarser one, whichever came first.
    const centre = patchScreenCoverage(dense, fit, frame, view);
    expect(centre).toBeGreaterThan(0.3);
    expect(centre).toBeLessThan(1);
    expect(sharpness(dense)).toBeCloseTo(centre);
    expect(sharpness(coarse, dense)).toBeCloseTo(centre + (1 - centre) * (0.5 / 0.95));
    expect(sharpness(dense, coarse)).toBeCloseTo(sharpness(coarse, dense));
    expect(sharpness(exact, dense)).toBeCloseTo(1);
  });

  it("draws only the strip a sideways pan moves into, on the pixel grid of the detail beside it", () => {
    const fit = { width: 1000, height: 500 };
    const frame = { width: 400, height: 300 };
    const view = { scale: 4, x: 0, y: 0 };
    const here = planDrawingPatch(fit, frame, view, 1)!;
    const later = { ...view, x: -150 };
    const whole = planDrawingPatch(fit, frame, later, 1)!;
    const sharpness = (stack: Parameters<typeof drawingPatchSharpness>[0]) =>
      drawingPatchSharpness(stack, fit, frame, later, 1);
    expect(sharpness([here])).toBeLessThan(0.9);
    const strip = planDrawingStrip(whole, drawingPatchRect(whole), [here], fit, frame, [later], 1)!;
    // Two canvas pixels into the detail it meets, so no hairline shows.
    expect(strip.left).toBeCloseTo(here.left + here.width - 2 / here.fullWidth);
    expect(strip.left + strip.width).toBeGreaterThanOrEqual(whole.left + whole.width);
    expect(((strip.left - here.left) * here.fullWidth) % 1).toBeCloseTo(0);
    expect([strip.fullWidth, strip.fullHeight]).toEqual([here.fullWidth, here.fullHeight]);
    expect(strip.pixelWidth * strip.pixelHeight).toBeLessThan(
      0.3 * whole.pixelWidth * whole.pixelHeight,
    );
    expect(sharpness([here, strip])).toBeCloseTo(1);
    expect(drawingPatchRect(strip)).toEqual({
      left: strip.left,
      top: strip.top,
      right: strip.left + strip.width,
      bottom: strip.top + strip.height,
    });
  });

  it("fills a diagonal pan in pieces, and leaves zooms and long jumps to whole patches", () => {
    const fit = { width: 1000, height: 500 };
    const frame = { width: 400, height: 300 };
    const view = { scale: 4, x: 0, y: 0 };
    const here = planDrawingPatch(fit, frame, view, 1)!;
    const later = { ...view, x: -120, y: -90 };
    const whole = planDrawingPatch(fit, frame, later, 1)!;
    const plan = (shown: Parameters<typeof planDrawingStrip>[2]) =>
      planDrawingStrip(whole, drawingPatchRect(whole), shown, fit, frame, [later], 1);
    const shown = [here];
    for (let piece = 0; piece < 2; piece++) shown.push(plan(shown)!);
    expect(drawingPatchSharpness(shown, fit, frame, later, 1)).toBeCloseTo(1);
    expect(plan(shown)).toBeNull();
    const pixels = shown.slice(1).reduce((sum, patch) => sum + patch.pixelWidth * patch.pixelHeight, 0);
    expect(pixels).toBeLessThan(whole.pixelWidth * whole.pixelHeight);
    // Nothing at this density to sit beside yet.
    const coarse = planDrawingPatch(fit, frame, { ...view, scale: 2 }, 1)!;
    expect(plan([coarse])).toBeNull();
    // Most of a screen away, a strip would save little over a whole render.
    const far = planDrawingPatch(fit, frame, { ...view, x: -400 }, 1)!;
    expect(planDrawingStrip(far, drawingPatchRect(far), [here], fit, frame, [view], 1)).toBeNull();
  });

  it("stretches a pan's lead to reach a quarter of a screen, and at most one", () => {
    const fit = { width: 1000, height: 500 };
    const frame = { width: 400, height: 300 };
    const screens = (lead: ReturnType<typeof stretchDrawingLead>) =>
      lead && Math.hypot((lead.x * fit.width * 4) / frame.width, (lead.y * fit.height * 4) / frame.height);
    expect(screens(stretchDrawingLead({ x: 0.001, y: 0 }, fit, frame, 4))).toBeCloseTo(0.25);
    expect(screens(stretchDrawingLead({ x: 0.08, y: 0 }, fit, frame, 4))).toBeCloseTo(0.8);
    expect(screens(stretchDrawingLead({ x: -0.2, y: 0 }, fit, frame, 4))).toBeCloseTo(1);
    expect(stretchDrawingLead({ x: 0, y: 0.003, zoom: 1.03 }, fit, frame, 4)).toEqual({
      x: 0,
      // Within a few percent of zoom, a pinch that drifts is still a pan.
      y: expect.closeTo(0.0375, 6),
      zoom: 1,
    });
    expect(stretchDrawingLead({ x: 0.01, y: 0, zoom: 1.2 }, fit, frame, 4)).toBeNull();
    expect(stretchDrawingLead({ x: 0, y: 0 }, fit, frame, 4)).toBeNull();
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
        for (const scale of [1, 1.7, 4, 12, 24, 35, 50]) {
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

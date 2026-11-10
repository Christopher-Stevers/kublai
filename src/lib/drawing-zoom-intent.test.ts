import { expect, it } from 'vitest';
import { createDrawingZoomIntent, planDrawingFocus } from './drawing-zoom-intent';
import { drawingPatchRect, planDrawingPatch, planDrawingStrip, shiftDrawingView } from './drawing-viewport';
const fit = { width: 400, height: 300 }, frame = { width: 400, height: 600 };
it('carries an inward pinch gain into a second pinch and bounds it by the zoom limit', () => {
  const intent = createDrawingZoomIntent();
  const at = (scale: number, moving: boolean, time: number) => intent.observe({ scale, x: 0, y: 0 }, moving, time, fit);
  at(4, false, 0); at(4, true, 10); at(7, true, 100); at(7, false, 120);
  expect(intent.predict({ scale: 7, x: 0, y: 0 }, fit, 130)).toBeNull();
  at(7, true, 350); at(7.3, true, 370);
  const lead = intent.predict({ scale: 7.3, x: 0, y: 0 }, fit, 370, { min: 1, max: 12 })!.lead;
  expect(lead.zoom).toBeGreaterThan(1.6);
  expect(7.3 * lead.zoom!).toBeLessThanOrEqual(12);
  expect(lead.zoom).toBeLessThanOrEqual(2);
});
it('drops prediction on reversal, pure pans and expired motion', () => {
  const intent = createDrawingZoomIntent();
  intent.observe({ scale: 4, x: 0, y: 0 }, false, 0, fit);
  intent.observe({ scale: 4, x: 0, y: 0 }, true, 10, fit);
  intent.observe({ scale: 4, x: 100, y: 0 }, true, 40, fit);
  expect(intent.predict({ scale: 4, x: 100, y: 0 }, fit, 40)).toBeNull();
  intent.observe({ scale: 5, x: 100, y: 0 }, true, 60, fit);
  expect(intent.predict({ scale: 5, x: 100, y: 0 }, fit, 500)).toBeNull();
  intent.observe({ scale: 4.5, x: 100, y: 0 }, true, 80, fit);
  expect(intent.predict({ scale: 4.5, x: 100, y: 0 }, fit, 80)).toBeNull();
});
it('keeps an off-centre pinch anchor fixed at the predicted zoom', () => {
  const intent = createDrawingZoomIntent();
  intent.observe({ scale: 4, x: 0, y: 0 }, false, 0, fit);
  intent.observe({ scale: 4, x: 0, y: 0 }, true, 10, fit);
  const current = { scale: 5, x: -25, y: -15 };
  intent.observe(current, true, 50, fit);
  const prediction = intent.predict(current, fit, 50)!;
  const future = shiftDrawingView(current, fit, prediction.lead);
  expect(future.x).toBeCloseTo(100 * (1 - future.scale / 4));
  expect(future.y).toBeCloseTo(60 * (1 - future.scale / 4));
});
it('renders a bounded full-density focus then fills uncovered edges without redrawing it', () => {
  const view = { scale: 12, x: 0, y: 0 };
  const whole = planDrawingPatch(fit, frame, view, 3)!;
  const focus = planDrawingFocus(whole, fit, frame, view)!;
  expect(focus.pixelWidth * focus.pixelHeight).toBeLessThanOrEqual(1024 * 1024);
  expect(focus.fullWidth).toBe(whole.fullWidth);
  const stopped = { ...view, scale: 10 };
  const target = planDrawingPatch(fit, frame, stopped, 3)!;
  const edge = planDrawingStrip(target, drawingPatchRect(target), [focus], fit, frame, [stopped], 3)!;
  expect(edge).not.toBeNull();
  expect(edge.fullWidth).toBe(target.fullWidth);
  const overlapWidth = Math.max(0, Math.min(edge.left + edge.width, focus.left + focus.width) - Math.max(edge.left, focus.left));
  const overlapHeight = Math.max(0, Math.min(edge.top + edge.height, focus.top + focus.height) - Math.max(edge.top, focus.top));
  expect(overlapWidth * overlapHeight).toBeLessThan(focus.width * focus.height * 0.02);
});
it('forgets the previous pinch after a pause instead of repeatedly predicting a distant destination', () => {
  const predictAfter = (pause: number) => {
    const intent = createDrawingZoomIntent();
    intent.observe({ scale: 4, x: 0, y: 0 }, false, 0, fit);
    intent.observe({ scale: 4, x: 0, y: 0 }, true, 10, fit);
    intent.observe({ scale: 7, x: 0, y: 0 }, true, 100, fit);
    intent.observe({ scale: 7, x: 0, y: 0 }, false, 120, fit);
    intent.observe({ scale: 7, x: 0, y: 0 }, true, pause, fit);
    const current = { scale: 7.3, x: 0, y: 0 };
    intent.observe(current, true, pause + 30, fit);
    return intent.predict(current, fit, pause + 30)!.lead.zoom!;
  };
  expect(predictAfter(300)).toBeGreaterThan(predictAfter(2000));
});

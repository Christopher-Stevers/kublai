import type { DrawingLead, DrawingPatch, DrawingSize, DrawingView } from './drawing-viewport';
import { visibleDrawingRect } from './drawing-viewport';

/** Short-lived pinch history, scoped to one sheet. No speculation during a pan or zoom-out. */
export function createDrawingZoomIntent() {
  let previous: (DrawingView & { at: number }) | null = null;
  let start: DrawingView | null = null;
  let movingBefore = false;
  let ended = -Infinity;
  let lastGain = 1;
  let repeatGain = 1;
  let lastZoomAt = -Infinity;
  let lastFocus = { x: 0.5, y: 0.5 };
  let focus = { x: 0.5, y: 0.5 };
  return {
    observe(view: DrawingView, moving: boolean, at: number, fit: DrawingSize) {
      if (![view.scale, view.x, view.y, at, fit.width, fit.height].every(Number.isFinite) || view.scale <= 0 || fit.width <= 0 || fit.height <= 0) return;
      if (moving && !movingBefore) {
        start = previous && at - previous.at < 1000 ? previous : view;
        repeatGain = at - ended < 900 ? lastGain : 1;
        focus = { x: 0.5 - view.x / (fit.width * view.scale), y: 0.5 - view.y / (fit.height * view.scale) };
      }
      if (moving && previous) {
        const ratio = view.scale / previous.scale;
        if (ratio < 0.998) { start = view; repeatGain = lastGain = 1; }
        if (ratio > 1.002) {
          lastZoomAt = at;
          const anchorX = (view.x - previous.x * ratio) / (1 - ratio);
          const anchorY = (view.y - previous.y * ratio) / (1 - ratio);
          focus = {
            x: Math.max(0, Math.min(1, 0.5 + (anchorX - previous.x) / (fit.width * previous.scale))),
            y: Math.max(0, Math.min(1, 0.5 + (anchorY - previous.y) / (fit.height * previous.scale))),
          };
          if (Math.hypot(focus.x - lastFocus.x, focus.y - lastFocus.y) * view.scale > 0.8) repeatGain = 1;
        }
      }
      if (!moving && movingBefore) {
        lastGain = start ? Math.min(2, Math.max(1, view.scale / start.scale)) : 1;
        ended = at;
        lastFocus = { ...focus };
        start = null;
      }
      previous = { ...view, at };
      movingBefore = moving;
    },
    predict(view: DrawingView, fit: DrawingSize, now: number, zoom?: { min: number; max: number }): { lead: DrawingLead; focus: { x: number; y: number } } | null {
      if (!movingBefore || !start || !previous || now - previous.at > 150 || now - lastZoomAt > 150 || view.scale <= start.scale * 1.025) return null;
      const gain = Math.min(2, Math.max(1.25, view.scale / start.scale, repeatGain));
      // Stable half-octave targets let consecutive frames reuse the same detail.
      const target = Math.min(zoom?.max ?? Infinity, view.scale * 2,
        Math.SQRT2 ** Math.ceil(Math.log(view.scale * gain) / Math.log(Math.SQRT2)));
      const ratio = target / view.scale;
      if (!(ratio > 1.05)) return null;
      return { lead: {
        x: (focus.x - (0.5 - view.x / (fit.width * view.scale))) * (1 - 1 / ratio),
        y: (focus.y - (0.5 - view.y / (fit.height * view.scale))) * (1 - 1 / ratio),
        zoom: ratio,
      }, focus };
    },
  };
}

/** Full-density focus patch, at most 1 MP; subsequent strips reuse these pixels. */
export function planDrawingFocus(whole: DrawingPatch, fit: DrawingSize, frame: DrawingSize, view: DrawingView, focus?: { x: number; y: number }): DrawingPatch | null {
  const visible = visibleDrawingRect(fit, frame, view);
  if (!visible) return null;
  const x = Math.max(visible.left, Math.min(visible.right, focus?.x ?? (visible.left + visible.right) / 2));
  const y = Math.max(visible.top, Math.min(visible.bottom, focus?.y ?? (visible.top + visible.bottom) / 2));
  const width = Math.min((visible.right - visible.left) * 0.7, 1024 / whole.fullWidth);
  const height = Math.min((visible.bottom - visible.top) * 0.7, 1024 / whole.fullHeight);
  const left = Math.max(visible.left, Math.min(visible.right - width, x - width / 2));
  const top = Math.max(visible.top, Math.min(visible.bottom - height, y - height / 2));
  const pixelWidth = Math.max(1, Math.floor(width * whole.fullWidth));
  const pixelHeight = Math.max(1, Math.floor(height * whole.fullHeight));
  return { ...whole, left, top, width: pixelWidth / whole.fullWidth, height: pixelHeight / whole.fullHeight, pixelWidth, pixelHeight };
}

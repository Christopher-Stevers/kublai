/** A sharp raster patch is anchored to the sheet, never to the screen. */
export type DrawingView = { scale: number; x: number; y: number };
export type DrawingSize = { width: number; height: number };
export type DrawingRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export type DrawingPatch = {
  left: number;
  top: number;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  fullWidth: number;
  fullHeight: number;
};
// Keep the phone allowance small, but allow Retina tablets to retain native
// resolution. Two buffers remain bounded at 64 MiB, regardless of sheet/zoom.
export const MAX_DRAWING_PATCH_PIXELS = 8 * 1024 * 1024;
const BASE_DRAWING_PATCH_PIXELS = 4 * 1024 * 1024;
export const MAX_DRAWING_PATCH_EDGE = 4096;

function valid(fit: DrawingSize, frame: DrawingSize, view: DrawingView) {
  return (
    [fit.width, fit.height, frame.width, frame.height, view.scale].every(
      (n) => Number.isFinite(n) && n > 0,
    ) &&
    Number.isFinite(view.x) &&
    Number.isFinite(view.y)
  );
}

/** Camera for a viewport-sized SVG. Zoom stays in SVG coordinates, so mobile
 * compositors never enlarge a sheet-sized bitmap of the annotation layer. */
export function drawingVectorViewBox(
  fit: DrawingSize,
  frame: DrawingSize,
  view: DrawingView,
  coordinateWidth = 1000,
): string | null {
  if (
    !valid(fit, frame, view) ||
    !(coordinateWidth > 0) ||
    !Number.isFinite(coordinateWidth)
  )
    return null;
  const unit = coordinateWidth / (fit.width * view.scale);
  const left = coordinateWidth / 2 - (frame.width / 2 + view.x) * unit;
  const top =
    (coordinateWidth * fit.height) / fit.width / 2 -
    (frame.height / 2 + view.y) * unit;
  return `${left} ${top} ${frame.width * unit} ${frame.height * unit}`;
}

export function visibleDrawingRect(
  fit: DrawingSize,
  frame: DrawingSize,
  view: DrawingView,
): DrawingRect | null {
  if (!valid(fit, frame, view)) return null;
  const width = fit.width * view.scale,
    height = fit.height * view.scale;
  const x = frame.width / 2 + view.x - width / 2;
  const y = frame.height / 2 + view.y - height / 2;
  const rect = {
    left: Math.max(0, -x / width),
    top: Math.max(0, -y / height),
    right: Math.min(1, (frame.width - x) / width),
    bottom: Math.min(1, (frame.height - y) / height),
  };
  return rect.right > rect.left && rect.bottom > rect.top ? rect : null;
}
/**
 * `lead` is how far the visible centre is expected to travel, in sheet
 * fractions, before the patch is ready. The guard band is spent on that side.
 */
export function planDrawingPatch(
  fit: DrawingSize,
  frame: DrawingSize,
  view: DrawingView,
  dpr: number,
  lead?: { x: number; y: number } | null,
): DrawingPatch | null {
  const visible = visibleDrawingRect(fit, frame, view);
  if (!visible) return null;
  // Slight oversampling keeps fine lines/text crisp through fractional CSS
  // zoom, within the same fixed buffer budget.
  const density =
    (Number.isFinite(dpr) ? Math.min(3, Math.max(1, dpr)) : 1) * 1.1;
  const fullWidth = fit.width * view.scale * density;
  const fullHeight = fit.height * view.scale * density;
  // Size the allowance from visible pixels, not the full zoomed sheet. The
  // old fixed 4 MP limit undersampled a 1032 x 1376 Retina iPad viewport.
  const pixelBudget = Math.min(
    MAX_DRAWING_PATCH_PIXELS,
    Math.max(
      BASE_DRAWING_PATCH_PIXELS,
      Math.ceil(
        (visible.right - visible.left) * fullWidth *
        (visible.bottom - visible.top) * fullHeight * 1.15,
      ),
    ),
  );
  // A guard band prevents ordinary drags from needing another PDF render.
  const marginX = (frame.width / (fit.width * view.scale)) * 0.25;
  const marginY = (frame.height / (fit.height * view.scale)) * 0.25;
  const rectangle = (guard: number) => {
    // Shifting by at most one margin keeps everything visible now covered.
    const shift = (by: number | undefined, margin: number) =>
      Number.isFinite(by) ? Math.max(-margin, Math.min(margin, by!)) : 0;
    const shiftX = shift(lead?.x, marginX * guard);
    const shiftY = shift(lead?.y, marginY * guard);
    const left = Math.max(0, visible.left - marginX * guard + shiftX);
    const top = Math.max(0, visible.top - marginY * guard + shiftY);
    return {
      left,
      top,
      width: Math.min(1, visible.right + marginX * guard + shiftX) - left,
      height: Math.min(1, visible.bottom + marginY * guard + shiftY) - top,
    };
  };
  const fitsBudget = (guard: number) => {
    const box = rectangle(guard);
    const width = box.width * fullWidth,
      height = box.height * fullHeight;
    return (
      width <= MAX_DRAWING_PATCH_EDGE &&
      height <= MAX_DRAWING_PATCH_EDGE &&
      width * height <= pixelBudget
    );
  };
  let guard = 1;
  if (!fitsBudget(guard)) {
    // Spend the budget on visible pixels first. Only reduce their resolution
    // when even a patch with no offscreen padding exceeds the canvas limits.
    let low = 0,
      high = 1;
    for (let step = 0; step < 12; step++) {
      const middle = (low + high) / 2;
      if (fitsBudget(middle)) low = middle;
      else high = middle;
    }
    guard = low;
  }
  const { left, top, width, height } = rectangle(guard);
  const requestedWidth = width * fullWidth,
    requestedHeight = height * fullHeight;
  const reduce = Math.min(
    1,
    MAX_DRAWING_PATCH_EDGE / requestedWidth,
    MAX_DRAWING_PATCH_EDGE / requestedHeight,
    Math.sqrt(pixelBudget / (requestedWidth * requestedHeight)),
  );
  const pixelWidth = Math.max(1, Math.floor(requestedWidth * reduce));
  const pixelHeight = Math.max(1, Math.floor(requestedHeight * reduce));
  return {
    left,
    top,
    width,
    height,
    pixelWidth,
    pixelHeight,
    fullWidth: pixelWidth / width,
    fullHeight: pixelHeight / height,
  };
}
export function patchScreenCoverage(
  patch: DrawingPatch,
  fit: DrawingSize,
  frame: DrawingSize,
  view: DrawingView,
) {
  const visible = visibleDrawingRect(fit, frame, view);
  if (!visible) return 0;
  const width = Math.max(
    0,
    Math.min(visible.right, patch.left + patch.width) -
      Math.max(visible.left, patch.left),
  );
  const height = Math.max(
    0,
    Math.min(visible.bottom, patch.top + patch.height) -
      Math.max(visible.top, patch.top),
  );
  return (
    (width * height) /
    ((visible.right - visible.left) * (visible.bottom - visible.top))
  );
}
export function patchCoversView(
  patch: DrawingPatch,
  fit: DrawingSize,
  frame: DrawingSize,
  view: DrawingView,
  dpr: number,
) {
  const target = planDrawingPatch(fit, frame, view, dpr);
  if (!target) return true;
  return (
    patchScreenCoverage(patch, fit, frame, view) >= 0.9999 &&
    patch.fullWidth >= target.fullWidth * 0.95 &&
    patch.fullHeight >= target.fullHeight * 0.95
  );
}

export type DrawingCameraSample = DrawingView & { at: number };
/** Camera samples older than this no longer describe the current motion. */
const MOTION_WINDOW_MS = 100;

/**
 * How far the visible centre will travel in `ms`, in sheet fractions, if the
 * camera keeps its recent speed. Null when the camera is at rest.
 */
export function drawingViewLead(
  samples: readonly DrawingCameraSample[],
  fit: DrawingSize,
  now: number,
  ms: number,
): { x: number; y: number } | null {
  const last = samples.at(-1);
  if (!last || now - last.at > 50) return null;
  const first = samples.find((sample) => last.at - sample.at <= MOTION_WINDOW_MS)!;
  const elapsed = last.at - first.at;
  if (elapsed < 8) return null;
  // The visible centre, so zooming about a point and panning predict alike.
  const centre = (sample: DrawingCameraSample) => ({
    x: -sample.x / (fit.width * sample.scale),
    y: -sample.y / (fit.height * sample.scale),
  });
  const from = centre(first),
    to = centre(last);
  const lead = {
    x: ((to.x - from.x) / elapsed) * ms,
    y: ((to.y - from.y) / elapsed) * ms,
  };
  return Number.isFinite(lead.x) && Number.isFinite(lead.y) ? lead : null;
}
/** The same camera with its visible centre moved by `lead` sheet fractions. */
export function shiftDrawingView(
  view: DrawingView,
  fit: DrawingSize,
  lead: { x: number; y: number },
): DrawingView {
  return {
    scale: view.scale,
    x: view.x - lead.x * fit.width * view.scale,
    y: view.y - lead.y * fit.height * view.scale,
  };
}

/** Keep useful sharp pixels while the finger moves. Long pans refill at the
 * edge, and a scale change or settled view always permits a fresh render. */
export function keepDrawingPatchDuringPan(
  patch: DrawingPatch, renderedScale: number, fit: DrawingSize,
  frame: DrawingSize, view: DrawingView, moving: boolean,
) {
  return moving && Math.abs(view.scale / renderedScale - 1) < 0.001 &&
    patchScreenCoverage(patch, fit, frame, view) >= 0.65;
}

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
export type DrawingLead = { x: number; y: number; zoom?: number };
/** A scale change smaller than this stays within the density tolerance. */
const ZOOM_LEAD_MIN = 1.05;
/** Detail is drawn at most this far ahead of the current scale. */
const MAX_ZOOM_LEAD = 2;

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
 * `lead` is where the camera is expected to be when the patch is ready: how
 * far the visible centre travels, in sheet fractions, and the scale change.
 * A pan spends the guard band on the side it is heading. A zoom is drawn for
 * the area it will show, at the density that will need.
 */
export function planDrawingPatch(
  fit: DrawingSize,
  frame: DrawingSize,
  view: DrawingView,
  dpr: number,
  lead?: DrawingLead | null,
): DrawingPatch | null {
  if (
    lead &&
    Number.isFinite(lead.x) &&
    Number.isFinite(lead.y) &&
    Number.isFinite(lead.zoom) &&
    Math.abs(Math.log(lead.zoom!)) > Math.log(ZOOM_LEAD_MIN)
  )
    return planDrawingPatch(fit, frame, shiftDrawingView(view, fit, lead), dpr);
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
 * Where the camera will be in `ms` if it keeps its recent motion: how far the
 * visible centre travels, in sheet fractions, and the scale change, which
 * stops at the viewer's `zoom` limits. Null when the camera is at rest.
 */
export function drawingViewLead(
  samples: readonly DrawingCameraSample[],
  fit: DrawingSize,
  now: number,
  ms: number,
  zoom?: { min: number; max: number },
): DrawingLead | null {
  const last = samples.at(-1);
  if (!last || now - last.at > 50) return null;
  const first = samples.find((sample) => last.at - sample.at <= MOTION_WINDOW_MS)!;
  const elapsed = last.at - first.at;
  if (elapsed < 8) return null;
  const scale = Math.min(
    zoom?.max ?? Number.POSITIVE_INFINITY,
    Math.max(
      zoom?.min ?? 0,
      last.scale *
        Math.min(
          MAX_ZOOM_LEAD,
          Math.max(1 / MAX_ZOOM_LEAD, (last.scale / first.scale) ** (ms / elapsed)),
        ),
    ),
  );
  // A zoom keeps one point of the sheet under the cursor or fingers, so the
  // offset changes in step with the scale. A pan is the limit of no zoom.
  const ratio =
    last.scale === first.scale
      ? ms / elapsed
      : (scale - last.scale) / (last.scale - first.scale);
  const centre = (view: DrawingView) => ({
    x: -view.x / (fit.width * view.scale),
    y: -view.y / (fit.height * view.scale),
  });
  const from = centre(last);
  const to = centre({
    scale,
    x: last.x + (last.x - first.x) * ratio,
    y: last.y + (last.y - first.y) * ratio,
  });
  const lead = { x: to.x - from.x, y: to.y - from.y, zoom: scale / last.scale };
  return Number.isFinite(lead.x) && Number.isFinite(lead.y) && Number.isFinite(lead.zoom)
    ? lead
    : null;
}
/** The camera after `lead`: its visible centre moved and its scale changed. */
export function shiftDrawingView(
  view: DrawingView,
  fit: DrawingSize,
  lead: DrawingLead,
): DrawingView {
  const zoom = lead.zoom ?? 1;
  const scale = view.scale * zoom;
  return {
    scale,
    x: view.x * zoom - lead.x * fit.width * scale,
    y: view.y * zoom - lead.y * fit.height * scale,
  };
}

/** `from`, `to` and the edges between them, in order. */
const cuts = (from: number, to: number, edges: number[]) =>
  [...new Set([from, to, ...edges.filter((edge) => edge > from && edge < to)])].sort(
    (a, b) => a - b,
  );

/** A strip ahead of a pan reaches at least this share of the screen, so a few cover it. */
export const DRAWING_STRIP_REACH = 0.25;
/** A strip is drawn instead of a whole patch only while it is at most this share of one. */
const STRIP_SHARE = 0.6;
/** Canvas pixels a strip reaches into the detail beside it, so no hairline shows between. */
const STRIP_OVERLAP = 2;

/**
 * A pan's `lead` stretched to reach at least `reach` of the screen ahead, and
 * at most all of it. Null for a zoom, or a camera that is not going anywhere.
 */
export function stretchDrawingLead(
  lead: DrawingLead,
  fit: DrawingSize,
  frame: DrawingSize,
  scale: number,
  reach = DRAWING_STRIP_REACH,
): DrawingLead | null {
  if (Math.abs(Math.log(lead.zoom ?? 1)) > Math.log(ZOOM_LEAD_MIN)) return null;
  // Screens travelled, along whichever axis moves furthest.
  const screens = Math.max(
    Math.abs(lead.x * fit.width * scale) / frame.width,
    Math.abs(lead.y * fit.height * scale) / frame.height,
  );
  if (!(screens > 0) || !Number.isFinite(screens)) return null;
  const stretch = Math.min(Math.max(1, reach / screens), 1 / screens);
  return { x: lead.x * stretch, y: lead.y * stretch, zoom: 1 };
}

/** The part of the sheet a patch covers. */
export const drawingPatchRect = (patch: DrawingPatch): DrawingRect => ({
  left: patch.left,
  top: patch.top,
  right: patch.left + patch.width,
  bottom: patch.top + patch.height,
});

/**
 * During a pan the detail on screen stays right; only the part of the sheet
 * the camera moves into is missing. Returns the piece of `area` worth drawing
 * next at the density of `whole`, the patch a full render would draw, scored
 * at `views`: on the pixel grid of the detail it adjoins, so the two meet
 * without a seam. Null when no detail at that density shows yet, or the piece
 * would not save most of a whole render's work.
 */
export function planDrawingStrip(
  whole: DrawingPatch,
  area: DrawingRect,
  shown: readonly DrawingPatch[],
  fit: DrawingSize,
  frame: DrawingSize,
  views: readonly DrawingView[],
  dpr: number,
): DrawingPatch | null {
  const same = shown.filter(
    (patch) =>
      Math.abs(patch.fullWidth / whole.fullWidth - 1) < 0.001 &&
      Math.abs(patch.fullHeight / whole.fullHeight - 1) < 0.001,
  );
  if (!same.length) return null;
  const xs = cuts(
    area.left,
    area.right,
    same.flatMap((patch) => [patch.left, patch.left + patch.width]),
  );
  const ys = cuts(
    area.top,
    area.bottom,
    same.flatMap((patch) => [patch.top, patch.top + patch.height]),
  );
  // Cells of the area that detail at this density does not reach yet.
  const nx = xs.length - 1,
    ny = ys.length - 1;
  const open = xs.slice(1).map((right, i) =>
    ys.slice(1).map((bottom, j) => {
      const x = (xs[i]! + right) / 2,
        y = (ys[j]! + bottom) / 2;
      return !same.some(
        (patch) =>
          x >= patch.left &&
          x <= patch.left + patch.width &&
          y >= patch.top &&
          y <= patch.top + patch.height,
      );
    }),
  );
  // Covered cells before each cell, so a block of cells is checked at once.
  const covered = Array.from({ length: nx + 1 }, () => Array<number>(ny + 1).fill(0));
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      covered[i + 1]![j + 1] =
        (open[i]![j] ? 0 : 1) + covered[i]![j + 1]! + covered[i + 1]![j]! - covered[i]![j]!;
  const isOpen = (i0: number, i1: number, j0: number, j1: number) =>
    covered[i1 + 1]![j1 + 1]! - covered[i0]![j1 + 1]! - covered[i1 + 1]![j0]! + covered[i0]![j0]! ===
    0;
  // Every block of open cells that cannot grow any wider or taller: a
  // sideways pan opens one beside the detail, a diagonal one an L of two.
  const blocks: DrawingRect[] = [];
  for (let i0 = 0; i0 < nx; i0++)
    for (let i1 = i0; i1 < nx; i1++)
      for (let j0 = 0; j0 < ny; ) {
        if (!isOpen(i0, i1, j0, j0)) {
          j0++;
          continue;
        }
        let j1 = j0;
        while (j1 + 1 < ny && isOpen(i0, i1, j1 + 1, j1 + 1)) j1++;
        if (!(i0 > 0 && isOpen(i0 - 1, i1, j0, j1)) && !(i1 + 1 < nx && isOpen(i0, i1 + 1, j0, j1)))
          blocks.push({ left: xs[i0]!, right: xs[i1 + 1]!, top: ys[j0]!, bottom: ys[j1 + 1]! });
        j0 = j1 + 1;
      }
  if (!blocks.length) return null;
  // One rectangle around them all can beat several renders.
  if (blocks.length > 1)
    blocks.push({
      left: Math.min(...blocks.map((block) => block.left)),
      top: Math.min(...blocks.map((block) => block.top)),
      right: Math.max(...blocks.map((block) => block.right)),
      bottom: Math.max(...blocks.map((block) => block.bottom)),
    });
  // Snap to the pixel grid of the nearest detail, reaching slightly into it.
  const snap = (rect: DrawingRect): DrawingPatch | null => {
    const gap = (patch: DrawingPatch) =>
      Math.max(0, patch.left - rect.right, rect.left - patch.left - patch.width) +
      Math.max(0, patch.top - rect.bottom, rect.top - patch.top - patch.height);
    const grid = same.reduce((best, patch) => (gap(patch) < gap(best) ? patch : best));
    const { fullWidth, fullHeight } = grid;
    const x0 = Math.max(
      Math.ceil(-grid.left * fullWidth - 1e-6),
      Math.floor((rect.left - grid.left) * fullWidth + 1e-6) - STRIP_OVERLAP,
    );
    const x1 = Math.min(
      Math.floor((1 - grid.left) * fullWidth + 1e-6),
      Math.ceil((rect.right - grid.left) * fullWidth - 1e-6) + STRIP_OVERLAP,
    );
    const y0 = Math.max(
      Math.ceil(-grid.top * fullHeight - 1e-6),
      Math.floor((rect.top - grid.top) * fullHeight + 1e-6) - STRIP_OVERLAP,
    );
    const y1 = Math.min(
      Math.floor((1 - grid.top) * fullHeight + 1e-6),
      Math.ceil((rect.bottom - grid.top) * fullHeight - 1e-6) + STRIP_OVERLAP,
    );
    if (
      x1 <= x0 ||
      y1 <= y0 ||
      x1 - x0 > MAX_DRAWING_PATCH_EDGE ||
      y1 - y0 > MAX_DRAWING_PATCH_EDGE
    )
      return null;
    return {
      left: grid.left + x0 / fullWidth,
      top: grid.top + y0 / fullHeight,
      width: (x1 - x0) / fullWidth,
      height: (y1 - y0) / fullHeight,
      pixelWidth: x1 - x0,
      pixelHeight: y1 - y0,
      fullWidth,
      fullHeight,
    };
  };
  const sharpness = (stack: readonly DrawingPatch[]) =>
    views.reduce(
      (sum, view) => sum + drawingPatchSharpness(stack, fit, frame, view, dpr),
      0,
    );
  const before = sharpness(shown);
  const pixels = whole.pixelWidth * whole.pixelHeight;
  let best: { strip: DrawingPatch; score: number } | null = null;
  for (const block of blocks) {
    const strip = snap(block);
    if (!strip || strip.pixelWidth * strip.pixelHeight > pixels * STRIP_SHARE) continue;
    const gain = sharpness([...shown, strip]) - before;
    // Sharpness gained per pixel drawn; each render also costs a little.
    const score = gain / (strip.pixelWidth * strip.pixelHeight + pixels * 0.05);
    if (gain > 1e-6 && (!best || score > best.score)) best = { strip, score };
  }
  return best?.strip ?? null;
}

/** Share of the visible sheet a stack of patches shows, each point weighted
 * by the `quality` of the top patch there; the densest patch is on top. */
function stackShare(
  patches: readonly DrawingPatch[],
  visible: DrawingRect,
  quality: (patch: DrawingPatch) => number,
) {
  const stack = [...patches].sort((a, b) => b.fullWidth - a.fullWidth);
  // Split the visible rectangle along every patch edge; each cell then shows
  // a single patch, or none.
  const xs = cuts(
    visible.left,
    visible.right,
    stack.flatMap((patch) => [patch.left, patch.left + patch.width]),
  );
  const ys = cuts(
    visible.top,
    visible.bottom,
    stack.flatMap((patch) => [patch.top, patch.top + patch.height]),
  );
  let shown = 0;
  for (let i = 1; i < xs.length; i++) {
    for (let j = 1; j < ys.length; j++) {
      const x = (xs[i - 1]! + xs[i]!) / 2,
        y = (ys[j - 1]! + ys[j]!) / 2;
      const top = stack.find(
        (patch) =>
          x >= patch.left &&
          x <= patch.left + patch.width &&
          y >= patch.top &&
          y <= patch.top + patch.height,
      );
      if (top)
        shown += (xs[i]! - xs[i - 1]!) * (ys[j]! - ys[j - 1]!) * quality(top);
    }
  }
  return (
    shown /
    ((visible.right - visible.left) * (visible.bottom - visible.top))
  );
}
/**
 * How much of the visible sheet a stack of patches shows at the density the
 * screen needs, from 0 to 1. A point shown at half that density counts half.
 */
export function drawingPatchSharpness(
  patches: readonly DrawingPatch[],
  fit: DrawingSize,
  frame: DrawingSize,
  view: DrawingView,
  dpr: number,
) {
  const visible = visibleDrawingRect(fit, frame, view);
  const target = planDrawingPatch(fit, frame, view, dpr);
  if (!visible || !target) return 1;
  return stackShare(patches, visible, (patch) =>
    Math.min(
      1,
      patch.fullWidth / (target.fullWidth * 0.95),
      patch.fullHeight / (target.fullHeight * 0.95),
    ),
  );
}
/** How much of the visible sheet a stack of patches shows at any density. */
export function drawingPatchStackCoverage(
  patches: readonly DrawingPatch[],
  fit: DrawingSize,
  frame: DrawingSize,
  view: DrawingView,
) {
  const visible = visibleDrawingRect(fit, frame, view);
  return visible ? stackShare(patches, visible, () => 1) : 1;
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

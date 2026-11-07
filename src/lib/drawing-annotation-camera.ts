import {
  drawingVectorViewBox,
  type DrawingSize,
  type DrawingView,
} from "./drawing-viewport";

type Camera = {
  fitWidth: number;
  fitHeight: number;
  width: number;
  height: number;
  scale: number;
  x: number;
  y: number;
  margin: number;
  zooming: boolean;
};
const cameras = new WeakMap<SVGSVGElement, Camera>();

/**
 * Pan a bounded, overscanned SVG with compositor translation. Changing viewBox
 * invalidates every vector/text paint, so only rebase at the guard-band edge or
 * on resize/settle. A pinch temporarily reuses bounded compositor pixels; settled
 * ink is always rerasterized at the exact zoom, including 5000%.
 */
export function paintDrawingAnnotationCamera(
  svg: SVGSVGElement | null,
  fit: DrawingSize,
  frame: DrawingSize,
  view: DrawingView,
  moving = false,
  overscan = true,
) {
  if (!svg || !drawingVectorViewBox(fit, frame, view)) return;
  // HTML wrappers are composited reliably; transforming an SVG root itself
  // still repaints its descendants in Chromium.
  const surface = svg.parentElement?.hasAttribute("data-annotation-pan-surface")
    ? svg.parentElement
    : svg;
  let camera = cameras.get(svg);
  const zooming = Boolean(
    moving && camera && (camera.zooming || camera.scale !== view.scale),
  );
  const ratio = camera ? view.scale / camera.scale : 1;
  const dx = camera
    ? view.x -
      camera.x * ratio +
      (frame.width / 2 + camera.margin) * (1 - ratio)
    : 0;
  const dy = camera
    ? view.y -
      camera.y * ratio +
      (frame.height / 2 + camera.margin) * (1 - ratio)
    : 0;
  // Reuse compositor pixels during a pinch. Repaint only at a resolution/coverage
  // boundary, and always restore exact vectors when the gesture settles.
  const reusableZoom =
    moving &&
    camera &&
    ratio >= 0.75 &&
    ratio <= 1.5 &&
    dx <= camera.margin &&
    dy <= camera.margin &&
    dx + (frame.width + camera.margin * 2) * ratio >=
      frame.width + camera.margin &&
    dy + (frame.height + camera.margin * 2) * ratio >=
      frame.height + camera.margin;
  if (
    camera?.fitWidth !== fit.width ||
    camera.fitHeight !== fit.height ||
    camera.width !== frame.width ||
    camera.height !== frame.height ||
    camera.zooming !== zooming ||
    (camera.scale !== view.scale && !reusableZoom) ||
    (ratio === 1 &&
      (Math.abs(view.x - camera.x) > camera.margin * 0.95 ||
        Math.abs(view.y - camera.y) > camera.margin * 0.95))
  ) {
    // Keep extra painted ink for ordinary drags within a 16M-device-pixel
    // budget (~64MB RGBA). Active ink uses a separate, unbuffered surface: repainting
    // one changing markup is cheap and needs no extra offscreen allocation.
    const density = Math.max(1, globalThis.devicePixelRatio || 1);
    const pixelBudget = 16_000_000 / (density * density);
    const budgetMargin = Math.max(
      0,
      (Math.sqrt((frame.width - frame.height) ** 2 + 4 * pixelBudget) -
        frame.width -
        frame.height) /
        4,
    );
    const margin = overscan
      ? Math.min(
          zooming ? 192 : 384,
          Math.min(frame.width, frame.height) * 0.5,
          budgetMargin,
        )
      : 0;
    // Spend the existing guard band ahead of a continuing pan. This extends
    // the next cheap translation stretch without allocating a larger surface.
    const continuingPan =
      camera?.fitWidth === fit.width &&
      camera.fitHeight === fit.height &&
      camera.width === frame.width &&
      camera.height === frame.height &&
      camera.scale === view.scale;
    // Rasterize at device-pixel anchors, avoiding an extra fractional offset
    // that would soften text when the compositor translates the surface.
    const snap = (value: number) => Math.round(value * density) / density;
    const anchorX = snap(
      view.x +
        (continuingPan && camera
          ? Math.sign(view.x - camera.x) * margin * 0.5
          : 0),
    );
    const anchorY = snap(
      view.y +
        (continuingPan && camera
          ? Math.sign(view.y - camera.y) * margin * 0.5
          : 0),
    );
    camera = {
      fitWidth: fit.width,
      fitHeight: fit.height,
      width: frame.width,
      height: frame.height,
      scale: view.scale,
      x: anchorX,
      y: anchorY,
      margin,
      zooming,
    };
    cameras.set(svg, camera);
    surface.style.left = `-${margin}px`;
    surface.style.top = `-${margin}px`;
    surface.style.width = `${frame.width + margin * 2}px`;
    surface.style.height = `${frame.height + margin * 2}px`;
    surface.style.willChange = "transform";
    svg.setAttribute(
      "viewBox",
      drawingVectorViewBox(
        fit,
        {
          width: frame.width + margin * 2,
          height: frame.height + margin * 2,
        },
        { scale: view.scale, x: anchorX, y: anchorY },
      )!,
    );
  }
  const zoom = view.scale / camera.scale;
  const translateX =
    view.x - camera.x * zoom + (frame.width / 2 + camera.margin) * (1 - zoom);
  const translateY =
    view.y - camera.y * zoom + (frame.height / 2 + camera.margin) * (1 - zoom);
  surface.style.transformOrigin = "0 0";
  surface.style.transform = `translate3d(${translateX}px, ${translateY}px, 0)${zoom === 1 ? "" : ` scale(${zoom})`}`;
}

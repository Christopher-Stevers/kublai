import { drawingVectorViewBox, type DrawingSize, type DrawingView } from "./drawing-viewport";

type Camera = {
  fitWidth: number;
  fitHeight: number;
  width: number;
  height: number;
  scale: number;
  x: number;
  y: number;
  margin: number;
};
const cameras = new WeakMap<SVGSVGElement, Camera>();

/**
 * Pan a bounded, overscanned SVG with compositor translation. Changing viewBox
 * invalidates every vector/text paint, so only rebase at the guard-band edge or
 * on zoom/resize. Never CSS-scale the ink: it stays sharp even at 5000%.
 */
export function paintDrawingAnnotationCamera(
  svg: SVGSVGElement | null,
  fit: DrawingSize,
  frame: DrawingSize,
  view: DrawingView,
) {
  if (!svg || !drawingVectorViewBox(fit, frame, view)) return;
  // HTML wrappers are composited reliably; transforming an SVG root itself
  // still repaints its descendants in Chromium.
  const surface = svg.parentElement?.hasAttribute("data-annotation-pan-surface")
    ? svg.parentElement : svg;
  let camera = cameras.get(svg);
  if (
    camera?.fitWidth !== fit.width || camera.fitHeight !== fit.height ||
    camera.width !== frame.width || camera.height !== frame.height ||
    camera.scale !== view.scale ||
    Math.abs(view.x - camera.x) > camera.margin * 0.75 ||
    Math.abs(view.y - camera.y) > camera.margin * 0.75
  ) {
    // At most 192 CSS pixels on each edge, independent of drawing size/zoom.
    const margin = Math.min(192, Math.min(frame.width, frame.height) * 0.25);
    // Spend the existing guard band ahead of a continuing pan. This extends
    // the next cheap translation stretch without allocating a larger surface.
    const continuingPan = camera?.fitWidth === fit.width &&
      camera.fitHeight === fit.height && camera.width === frame.width &&
      camera.height === frame.height && camera.scale === view.scale;
    // Rasterize at device-pixel anchors, avoiding an extra fractional offset
    // that would soften text when the compositor translates the surface.
    const density = Math.max(1, globalThis.devicePixelRatio || 1);
    const snap = (value: number) => Math.round(value * density) / density;
    const anchorX = snap(view.x + (continuingPan ? Math.sign(view.x - camera.x) * margin * 0.5 : 0));
    const anchorY = snap(view.y + (continuingPan ? Math.sign(view.y - camera.y) * margin * 0.5 : 0));
    camera = {
      fitWidth: fit.width, fitHeight: fit.height,
      width: frame.width, height: frame.height,
      scale: view.scale, x: anchorX, y: anchorY, margin,
    };
    cameras.set(svg, camera);
    surface.style.left = `-${margin}px`;
    surface.style.top = `-${margin}px`;
    surface.style.width = `${frame.width + margin * 2}px`;
    surface.style.height = `${frame.height + margin * 2}px`;
    surface.style.willChange = "transform";
    svg.setAttribute("viewBox", drawingVectorViewBox(fit, {
      width: frame.width + margin * 2,
      height: frame.height + margin * 2,
    }, { scale: view.scale, x: anchorX, y: anchorY })!);
  }
  surface.style.transform = `translate3d(${view.x - camera.x}px, ${view.y - camera.y}px, 0)`;
}

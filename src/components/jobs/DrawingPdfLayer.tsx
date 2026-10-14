"use client";

import { useEffect, useLayoutEffect, useRef, type RefCallback, type RefObject } from "react";
import type { RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  drawingPdfOperationsFilter,
  isFullDrawingPatch,
  type PdfOperationBounds,
} from "~/lib/drawing-pdf-operations";
import { discardPdfDocument, loadPdfDocument } from "~/lib/pdf-client";
import { recordDrawingPerformance } from "~/lib/drawing-performance";
import {
  patchCoversView,
  patchScreenCoverage,
  planDrawingPatch,
  type DrawingPatch,
  type DrawingSize,
  type DrawingView,
} from "~/lib/drawing-viewport";

type Props = {
  pdf: { url: string; page: number };
  fit: DrawingSize;
  frameSize: DrawingSize;
  view: DrawingView;
  dpr: number;
  enabled: boolean;
  moving: boolean;
  /** Render outside the CSS-scaled sheet to preserve canvas pixels on Safari. */
  screenSpace?: boolean;
  appearanceFilter?: string;
  paintRef?: RefObject<((view: DrawingView) => void) | null>;
};
type Snapshot = { index: number; patch: DrawingPatch };
// Only successful full-page renders are safe to reuse. PDF.js can expose
// incomplete bounds after cancellation; never use those for filtering.
const completedPageBounds = new WeakMap<object, PdfOperationBounds>();

/**
 * Double-buffered, overscanned PDF detail. Primary drawings use screen-space
 * placement so a CSS-scaled ancestor cannot flatten their high-resolution ink.
 * Comparison callers can still use sheet-relative placement.
 * Motion never erases it or cancels useful work; only changing sheets does.
 */
export function DrawingPdfLayer(props: Props) {
  const canvases = useRef<Array<HTMLCanvasElement | null>>([null, null]);
  const latest = useRef(props);
  latest.current = props;
  const request = useRef<() => void>(() => undefined);
  const patches = useRef<Array<DrawingPatch | null>>([null, null]);
  const camera = useRef(props.view);
  const position = (index: number, view: DrawingView) => {
    const canvas = canvases.current[index];
    const patch = patches.current[index];
    if (!canvas || !patch) return;
    const p = latest.current;
    const width = p.fit.width * view.scale;
    const height = p.fit.height * view.scale;
    Object.assign(canvas.style, p.screenSpace ? {
      left: `${(p.frameSize.width - width) / 2 + view.x + patch.left * width}px`,
      top: `${(p.frameSize.height - height) / 2 + view.y + patch.top * height}px`,
      width: `${patch.width * width}px`,
      height: `${patch.height * height}px`,
    } : {
      left: `${patch.left * 100}%`, top: `${patch.top * 100}%`,
      width: `${patch.width * 100}%`, height: `${patch.height * 100}%`,
    });
  };
  useLayoutEffect(() => {
    const paint = (view: DrawingView) => {
      camera.current = view;
      position(0, view);
      position(1, view);
    };
    paint(props.view);
    if (props.paintRef) props.paintRef.current = paint;
    return () => { if (props.paintRef) props.paintRef.current = null; };
  });

  useEffect(() => {
    const buffers = [...canvases.current];
    let disposed = false;
    let rendering = false;
    let current: Snapshot | null = null;
    let task: RenderTask | null = null;
    let nextTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAfter = 0;
    let stalledTimer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let viewRequestedAt = performance.now();
    let requestedView = "";
    const source = { ...props.pdf };
    for (const canvas of buffers) {
      if (canvas) {
        canvas.style.visibility = "hidden";
        canvas.width = 0;
        canvas.height = 0;
      }
    }

    // Prepare the current page after the initial image has painted. Byte-range
    // loading keeps this to needed PDF objects, avoiding a cold worker/page
    // lookup the first time the user zooms beyond the pre-rendered tiles.
    const warm = () => {
      if (disposed) return;
      void loadPdfDocument(source.url)
        .then((document) =>
          disposed ? undefined : document.getPage(source.page),
        )
        .catch(() => undefined);
    };
    const idle =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(warm, { timeout: 2000 })
        : null;
    const warmTimer = idle === null ? setTimeout(warm, 500) : null;

    const schedule = (delay = 0) => {
      if (disposed || rendering || nextTimer !== null) return;
      nextTimer = setTimeout(() => {
        nextTimer = null;
        void draw();
      }, delay);
    };
    const draw = async () => {
      if (disposed || rendering) return;
      const start = latest.current;
      if (!start.enabled || document.visibilityState === "hidden" || Date.now() < retryAfter) return;
      if (!planDrawingPatch(start.fit, start.frameSize, start.view, start.dpr))
        return;
      if (
        current &&
        patchCoversView(
          current.patch,
          start.fit,
          start.frameSize,
          start.view,
          start.dpr,
        )
      )
        return;
      const index = current?.index === 0 ? 1 : 0;
      const canvas = buffers[index];
      if (!canvas) return;
      rendering = true;
      const loadingAt = performance.now();
      let renderingAt = loadingAt;
      let pixels = 0;
      try {
        const loading = loadPdfDocument(source.url);
        const page = await Promise.race([
          loading.then((document) => disposed ? null : document.getPage(source.page)),
          new Promise<never>((_, reject) => {
            stalledTimer = setTimeout(() => {
              discardPdfDocument(source.url, loading);
              reject(new Error("Drawing PDF loading timed out"));
            }, 30_000);
          }),
        ]);
        if (stalledTimer !== null) clearTimeout(stalledTimer);
        stalledTimer = null;
        if (disposed || !page) return;
        // Loading a cold document may outlast a whole gesture. Rasterize the
        // newest view, not the one captured before the network/worker wait.
        const ready = latest.current;
        if (!ready.enabled) return;
        const patch = planDrawingPatch(
          ready.fit,
          ready.frameSize,
          ready.view,
          ready.dpr,
        );
        if (!patch) return;
        const raw = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: patch.fullWidth / raw.width,
        });
        canvas.style.visibility = "hidden";
        canvas.width = patch.pixelWidth;
        canvas.height = patch.pixelHeight;
        pixels = canvas.width * canvas.height;
        renderingAt = performance.now();
        const bounds = completedPageBounds.get(page);
        const recordFullPage = !bounds && isFullDrawingPatch(patch);
        if (recordFullPage) page.recordedBBoxes = null;
        const render = page.render({
          canvas,
          viewport,
          // Recording while the whole page is visible lets later crops skip
          // offscreen ink and its unused state. Deep-link opens without a full
          // recording retain the complete rendering path.
          recordOperations: recordFullPage,
          operationsFilter: drawingPdfOperationsFilter(bounds, patch),
          transform: [
            1,
            0,
            0,
            patch.fullHeight / viewport.height,
            -patch.left * patch.fullWidth,
            -patch.top * patch.fullHeight,
          ],
        });
        task = render;
        // A stuck PDF task must not block all future zoom/detail requests.
        stalledTimer = setTimeout(() => render.cancel(), 30_000);
        // Display rendering in the installed PDF.js already yields via RAF.
        // Keep that scheduler instead of adding another frame of latency.
        await render.promise;
        if (stalledTimer !== null) clearTimeout(stalledTimer);
        stalledTimer = null;
        if (disposed) return;
        if (recordFullPage && page.recordedBBoxes)
          completedPageBounds.set(
            page,
            page.recordedBBoxes as PdfOperationBounds,
          );
        const now = latest.current;
        const coverage = patchScreenCoverage(
          patch,
          now.fit,
          now.frameSize,
          now.view,
        );
        const oldCoverage = current
          ? patchScreenCoverage(current.patch, now.fit, now.frameSize, now.view)
          : 0;
        // A render can finish after a fast fling. Do not replace good detail
        // with an obsolete patch covering less of the view; refill the latest.
        if (coverage > 0 && (coverage + 0.001 >= oldCoverage || !current)) {
          patches.current[index] = patch;
          position(index, camera.current);
          canvas.style.visibility = "visible";
          if (current) {
            const previous = buffers[current.index];
            if (previous) {
              previous.style.visibility = "hidden";
              // Safari retains hidden canvas backing stores. Free the old
              // bitmap only after the replacement is ready and visible.
              previous.width = 0;
              previous.height = 0;
              patches.current[current.index] = null;
            }
          }
          current = { index, patch };
        }
        const sharp =
          current?.index === index &&
          patchCoversView(patch, now.fit, now.frameSize, now.view, now.dpr);
        recordDrawingPerformance({
          loadMs: renderingAt - loadingAt,
          renderMs: performance.now() - renderingAt,
          viewToSharpMs: sharp ? performance.now() - viewRequestedAt : null,
          pixels,
          outcome: sharp ? "sharp" : "partial",
        });
        retryAfter = 0;
        failures = 0;
      } catch {
        if (!disposed)
          recordDrawingPerformance({
            loadMs: renderingAt - loadingAt,
            renderMs: performance.now() - renderingAt,
            viewToSharpMs: null,
            pixels,
            outcome: "failed",
          });
        // Preserve the existing sharp patch/tiles through transient failures.
        // After the quick retries, keep a low-frequency recovery attempt while
        // visible. A stationary drawing must not remain blurry indefinitely.
        failures++;
        retryAfter = Date.now() + (failures >= 4 ? 60_000 : 3000 * failures);
      } finally {
        if (stalledTimer !== null) clearTimeout(stalledTimer);
        stalledTimer = null;
        // Failed and obsolete work must not retain a second large bitmap.
        if (!disposed && current?.index !== index) {
          canvas.width = 0;
          canvas.height = 0;
        }
        task = null;
        rendering = false;
        if (!disposed) schedule(Math.max(0, retryAfter - Date.now()));
      }
    };
    request.current = () => {
      const p = latest.current;
      const key = `${p.view.scale}:${p.view.x}:${p.view.y}:${p.frameSize.width}:${p.frameSize.height}:${p.fit.width}:${p.fit.height}:${p.dpr}:${p.moving}`;
      if (key !== requestedView) {
        // A fresh settled view gets an immediate retry after a transient failure.
        if (!p.moving && failures > 0) {
          failures = 0;
          retryAfter = 0;
          if (nextTimer !== null) clearTimeout(nextTimer);
          nextTimer = null;
        }
        requestedView = key;
        viewRequestedAt = performance.now();
      }
      schedule(Math.max(0, retryAfter - Date.now()));
    };
    const resume = () => {
      if (document.visibilityState === "hidden") return;
      failures = 0;
      retryAfter = 0;
      if (nextTimer !== null) clearTimeout(nextTimer);
      nextTimer = null;
      schedule();
    };
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    schedule();
    return () => {
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
      if (stalledTimer !== null) clearTimeout(stalledTimer);
      disposed = true;
      request.current = () => undefined;
      task?.cancel();
      if (nextTimer !== null) clearTimeout(nextTimer);
      if (idle !== null) window.cancelIdleCallback(idle);
      if (warmTimer !== null) clearTimeout(warmTimer);
      for (const canvas of buffers) {
        if (canvas) {
          canvas.style.visibility = "hidden";
          canvas.width = 0;
          canvas.height = 0;
        }
      }
    };
    // Geometry changes request a refill below; only a different source tears down buffers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pdf.url, props.pdf.page]);

  useEffect(() => {
    request.current();
  }, [
    props.view,
    props.fit,
    props.frameSize,
    props.dpr,
    props.enabled,
    props.moving,
  ]);
  const bind =
    (index: number): RefCallback<HTMLCanvasElement> =>
    (canvas) => {
      canvases.current[index] = canvas;
    };
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{ display: props.enabled ? undefined : "none", zIndex: 1, filter: props.appearanceFilter, overflow: props.screenSpace ? "hidden" : undefined }}
    >
      {[0, 1].map((index) => (
        <canvas
          key={index}
          ref={bind(index)}
          data-pdf-detail=""
          className="absolute"
          style={{ visibility: "hidden" }}
        />
      ))}
    </div>
  );
}

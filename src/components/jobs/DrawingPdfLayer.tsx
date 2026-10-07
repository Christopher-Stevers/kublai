"use client";

import { useEffect, useRef, type RefCallback } from "react";
import type { RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import { loadPdfDocument } from "~/lib/pdf-client";
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
};
type Snapshot = { index: number; patch: DrawingPatch };

/**
 * Double-buffered, overscanned PDF detail inside the transformed sheet layer.
 * The front buffer follows the exact same compositor transform as the tiles.
 * Motion never erases it or cancels useful work; only changing sheets does.
 */
export function DrawingPdfLayer(props: Props) {
  const canvases = useRef<Array<HTMLCanvasElement | null>>([null, null]);
  const latest = useRef(props);
  latest.current = props;
  const request = useRef<() => void>(() => undefined);

  useEffect(() => {
    const buffers = [...canvases.current];
    let disposed = false;
    let rendering = false;
    let current: Snapshot | null = null;
    let task: RenderTask | null = null;
    let nextTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAfter = 0;
    let failures = 0;
    const source = { ...props.pdf };
    for (const canvas of buffers)
      if (canvas) canvas.style.visibility = "hidden";

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
      if (!start.enabled || Date.now() < retryAfter || failures >= 4) return;
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
      try {
        const document = await loadPdfDocument(source.url);
        const page = await document.getPage(source.page);
        if (disposed) return;
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
        const render = page.render({
          canvas,
          viewport,
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
        // Display rendering in the installed PDF.js already yields via RAF.
        // Keep that scheduler instead of adding another frame of latency.
        await render.promise;
        if (disposed) return;
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
          Object.assign(canvas.style, {
            left: `${patch.left * 100}%`,
            top: `${patch.top * 100}%`,
            width: `${patch.width * 100}%`,
            height: `${patch.height * 100}%`,
            visibility: "visible",
          });
          if (current) {
            const previous = buffers[current.index];
            if (previous) previous.style.visibility = "hidden";
          }
          current = { index, patch };
        }
        retryAfter = 0;
        failures = 0;
      } catch {
        // Preserve the existing sharp patch/tiles through transient failures.
        retryAfter = Date.now() + 3000 * ++failures;
      } finally {
        task = null;
        rendering = false;
        if (!disposed) schedule(Math.max(0, retryAfter - Date.now()));
      }
    };
    request.current = () => schedule(Math.max(0, retryAfter - Date.now()));
    schedule();
    return () => {
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
  }, [props.view, props.fit, props.frameSize, props.dpr, props.enabled]);
  const bind =
    (index: number): RefCallback<HTMLCanvasElement> =>
    (canvas) => {
      canvases.current[index] = canvas;
    };
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{ display: props.enabled ? undefined : "none", zIndex: 1 }}
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

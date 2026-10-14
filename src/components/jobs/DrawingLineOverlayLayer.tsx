"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import { loadPdfDocument } from "~/lib/pdf-client";
import {
  boundedOverlayPatch,
  drawingInk,
  overlaySourceRect,
  overlayBounds,
  planOverlayPatch,
  type OverlayInkStyle,
} from "~/lib/drawing-line-overlay";
import {
  type DrawingPatch,
  type DrawingSize,
  type DrawingView,
} from "~/lib/drawing-viewport";
import type { ComparisonSource } from "./DrawingComparisonLayer";

import {
  addStackInk,
  compositeInkStack,
  createInkStack,
  type InkStack,
} from "~/lib/drawing-overlay-stack";

type Props = {
  additional?: Array<{
    source: ComparisonSource;
    style: OverlayInkStyle;
    alignment: { x: number; y: number; scale: number };
  }>;
  first: ComparisonSource;
  second: ComparisonSource;
  styles: [OverlayInkStyle, OverlayInkStyle];
  alignment: { x: number; y: number; scale: number };
  fit: DrawingSize;
  frameSize: DrawingSize;
  view: DrawingView;
  dpr: number;
  inverted?: boolean;
  screenSpace?: boolean;
  paintRef?: RefObject<((view: DrawingView) => void) | null>;
};
type Raster = { patch: DrawingPatch; ink: InkStack };
const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("Could not open the drawings for overlay."));
    image.src = src;
  });
}

/** Bounded PDF patches follow the camera without CSS-scaling the detail canvas. */
export function DrawingLineOverlayLayer(props: Props) {
  const overview = useRef<HTMLCanvasElement>(null);
  const detail = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const camera = useRef(props.view);
  const patches = useRef<Array<DrawingPatch | null>>([null, null]);
  const position = (canvas: HTMLCanvasElement, patch: DrawingPatch, view: DrawingView) => {
    const p = latest.current;
    const width = p.fit.width * view.scale, height = p.fit.height * view.scale;
    Object.assign(canvas.style, p.screenSpace ? {
      left: `${(p.frameSize.width - width) / 2 + view.x + patch.left * width}px`,
      top: `${(p.frameSize.height - height) / 2 + view.y + patch.top * height}px`,
      width: `${patch.width * width}px`, height: `${patch.height * height}px`,
    } : {
      left: `${patch.left * 100}%`, top: `${patch.top * 100}%`,
      width: `${patch.width * 100}%`, height: `${patch.height * 100}%`,
    });
  };
  useLayoutEffect(() => {
    const paint = (view: DrawingView) => {
      camera.current = view;
      [overview.current, detail.current].forEach((canvas, index) => {
        const patch = patches.current[index];
        if (canvas && patch) position(canvas, patch, view);
      });
    };
    paint(props.view);
    if (props.paintRef) props.paintRef.current = paint;
    return () => { if (props.paintRef) props.paintRef.current = null; };
  });
  const request = useRef<() => void>(() => undefined);
  const repaint = useRef<() => void>(() => undefined);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const layers = [
    {
      source: props.first,
      style: props.styles[0],
      alignment: { x: 0, y: 0, scale: 1 },
    },
    {
      source: props.second,
      style: props.styles[1],
      alignment: props.alignment,
    },
    ...(props.additional ?? []),
  ];
  const styleKey = JSON.stringify([
    layers.map((layer) => layer.style),
    Boolean(props.inverted),
  ]);
  const paper = props.inverted ? "#000000" : "#ffffff";
  const sourcesKey = JSON.stringify([
    layers.map(({ source, alignment, style }) => ({
      source: { src: source.src, pdf: source.pdf },
      alignment,
      opacity: style.opacity,
    })),
    attempt,
  ]);

  useEffect(() => {
    let disposed = false,
      rendering = false;
    let task: RenderTask | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let bounds: ReturnType<typeof overlayBounds> | null = null;
    let preview: Raster | null = null,
      sharp: Raster | null = null;
    let paintId = 0;
    let failures = 0;
    let retryAfter = 0;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const canvases = [overview.current, detail.current];
    setError(null);
    setReady(false);
    for (const canvas of canvases)
      if (canvas) canvas.style.visibility = "hidden";
    const [sources] = JSON.parse(sourcesKey) as [
      Array<{
        source: ComparisonSource;
        alignment: Props["alignment"];
        opacity: number;
      }>,
    ];
    const paint = async () => {
      if (!preview) return;
      const id = ++paintId,
        styles = [
          ...latest.current.styles,
          ...(latest.current.additional ?? []).map((layer) => layer.style),
        ];
      for (const [raster, canvas] of [
        [preview, canvases[0]],
        [sharp, canvases[1]],
      ] as const) {
        if (!raster || !canvas || disposed) continue;
        const context = canvas.getContext("2d");
        if (!context)
          throw new Error("Drawing overlay is unavailable in this browser.");
        const pixels = context.createImageData(
          raster.patch.pixelWidth,
          raster.patch.pixelHeight,
        );
        for (
          let offset = 0;
          offset < raster.ink.first.length;
          offset += 64 * raster.patch.pixelWidth
        ) {
          compositeInkStack(
            pixels.data,
            raster.ink,
            styles,
            offset,
            Math.min(
              raster.ink.first.length,
              offset + 64 * raster.patch.pixelWidth,
            ),
            latest.current.inverted ? "#ffffff" : "#000000",
          );
          await nextTurn();
          if (disposed || id !== paintId) return;
        }
        canvas.width = raster.patch.pixelWidth;
        canvas.height = raster.patch.pixelHeight;
        context.putImageData(pixels, 0, 0);
        patches.current[canvas === canvases[0] ? 0 : 1] = raster.patch;
        position(canvas, raster.patch, camera.current);
        canvas.style.visibility = "visible";
      }
      if (!disposed && id === paintId) setReady(true);
    };
    const recolor = () => {
      void paint().catch(() => {
        if (!disposed) setError("Could not display the drawing overlay.");
      });
    };
    repaint.current = recolor;
    const raster = async (
      patch: DrawingPatch,
      usePdf: boolean,
    ): Promise<Raster> => {
      const ink = createInkStack(patch.pixelWidth * patch.pixelHeight);
      for (const [index, { source, alignment, opacity }] of sources.entries()) {
        if (opacity <= 0) continue;
        if (disposed) throw new Error("Overlay closed");
        const image = await loadImage(source.src);
        if (disposed) throw new Error("Overlay closed");
        const canvas = document.createElement("canvas");
        canvas.width = patch.pixelWidth;
        canvas.height = patch.pixelHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context)
          throw new Error("Drawing overlay is unavailable in this browser.");
        const rect = overlaySourceRect(
          patch,
          latest.current.fit,
          image.naturalHeight / image.naturalWidth,
          alignment,
        );
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        if (usePdf && source.pdf) {
          try {
            const pdf = await loadPdfDocument(source.pdf.url);
            const page = await pdf.getPage(source.pdf.page);
            if (disposed) throw new Error("Overlay closed");
            const raw = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({
              scale: rect.width / raw.width,
            });
            const render = page.render({
              canvas,
              viewport,
              transform: [
                1,
                0,
                0,
                rect.height / viewport.height,
                rect.left,
                rect.top,
              ],
            });
            task = render;
            watchdog = setTimeout(() => render.cancel(), 30_000);
            try { await render.promise; }
            finally {
              if (watchdog !== null) clearTimeout(watchdog);
              watchdog = null;
              task = null;
            }
          } catch (error) {
            image.onload = image.onerror = null;
            image.removeAttribute("src");
            canvas.width = canvas.height = 0;
            throw error;
          }

        } else
          context.drawImage(
            image,
            rect.left,
            rect.top,
            rect.width,
            rect.height,
          );
        const mask = drawingInk(
          context.getImageData(0, 0, canvas.width, canvas.height).data,
        );
        for (
          let offset = 0;
          offset < mask.length;
          offset += 64 * patch.pixelWidth
        ) {
          addStackInk(
            ink,
            mask,
            index,
            opacity,
            offset,
            Math.min(mask.length, offset + 64 * patch.pixelWidth),
          );
          await nextTurn();
          if (disposed) throw new Error("Overlay closed");
        }
        image.onload = image.onerror = null;
        image.removeAttribute("src");
        canvas.width = 0;
        canvas.height = 0;
        await nextTurn();
      }
      return { patch, ink };
    };
    const schedule = () => {
      if (disposed || rendering || timer !== null || failures >= 4) return;
      timer = setTimeout(() => {
        timer = null;
        void draw();
      }, Math.max(50, retryAfter - Date.now()));
    };
    const draw = async () => {
      if (disposed || rendering || !preview || !bounds) return;
      const current = latest.current;
      const patch = planOverlayPatch(
        current.fit,
        current.frameSize,
        current.view,
        current.dpr,
        bounds,
      );
      if (!patch) return;
      if (
        sharp &&
        sharp.patch.left <= patch.left + 0.0001 &&
        sharp.patch.top <= patch.top + 0.0001 &&
        sharp.patch.left + sharp.patch.width >=
          patch.left + patch.width - 0.0001 &&
        sharp.patch.top + sharp.patch.height >=
          patch.top + patch.height - 0.0001 &&
        sharp.patch.fullWidth >= patch.fullWidth * 0.95 &&
        sharp.patch.fullHeight >= patch.fullHeight * 0.95
      )
        return;
      rendering = true;
      // Keep the displayed canvas, but release its large ink arrays before rebuilding.
      sharp = null;
      try {
        const next = await raster(patch, true);
        if (disposed) return;
        sharp = next;
        failures = 0;
        retryAfter = 0;
        setError(null);
        await paint();
      } catch {
        failures++;
        retryAfter = Date.now() + failures * 3000;
        if (!disposed)
          setError(
            "Could not load drawing detail. The overview is still available.",
          );
      } finally {
        rendering = false;
        if (!disposed) schedule();
      }
    };
    const resume = () => {
      if (document.visibilityState === "hidden") return;
      failures = 0;
      retryAfter = 0;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      schedule();
    };
    request.current = resume;
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    void (async () => {
      const { fit } = latest.current;
      bounds = { left: 0, top: 0, right: 1, bottom: 1 };
      for (const { source, alignment, opacity } of sources) {
        if (opacity <= 0) continue;
        const image = await loadImage(source.src);
        if (disposed) return;
        const sourceBounds = overlayBounds(
          fit,
          image.naturalHeight / image.naturalWidth,
          alignment,
        );
        bounds = {
          left: Math.min(bounds.left, sourceBounds.left),
          top: Math.min(bounds.top, sourceBounds.top),
          right: Math.max(bounds.right, sourceBounds.right),
          bottom: Math.max(bounds.bottom, sourceBounds.bottom),
        };
        image.onload = image.onerror = null;
        image.removeAttribute("src");
        await nextTurn();
      }
      const spanX = bounds.right - bounds.left,
        spanY = bounds.bottom - bounds.top;
      const density = Math.min(1200 / (fit.width * spanX), 1);
      const width = Math.max(1, Math.round(fit.width * spanX * density)),
        height = Math.max(1, Math.round(fit.height * spanY * density));
      const patch = boundedOverlayPatch({
        left: bounds.left,
        top: bounds.top,
        width: spanX,
        height: spanY,
        pixelWidth: width,
        pixelHeight: height,
        fullWidth: width / spanX,
        fullHeight: height / spanY,
      });
      preview = await raster(patch, false);
      await paint();
      schedule();
    })().catch(() => {
      if (!disposed)
        setError(
          "Could not open the drawings for overlay. Check the connection and try again.",
        );
    });
    return () => {
      disposed = true;
      paintId++;
      request.current = () => undefined;
      repaint.current = () => undefined;
      task?.cancel();
      if (watchdog !== null) clearTimeout(watchdog);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
      patches.current = [null, null];
      if (timer !== null) clearTimeout(timer);
      for (const canvas of canvases)
        if (canvas) {
          canvas.style.visibility = "hidden";
          canvas.width = 0;
          canvas.height = 0;
        }
    };
  }, [sourcesKey]);
  useEffect(() => {
    request.current();
  }, [props.fit, props.frameSize, props.view, props.dpr]);
  useEffect(() => {
    repaint.current();
  }, [styleKey]);
  return (
    <div
      data-line-overlay="true"
      data-overlay-ready={ready}
      className="pointer-events-none absolute inset-0"
      style={{ zIndex: 2, backgroundColor: paper }}
    >
      <canvas
        ref={overview}
        data-overlay-overview="true"
        className="absolute"
        style={{ visibility: "hidden", backgroundColor: paper }}
      />
      <canvas
        ref={detail}
        data-overlay-detail="true"
        className="absolute"
        style={{ visibility: "hidden", backgroundColor: paper }}
      />
      {(!ready || error) && (
        <p
          role={error ? "alert" : "status"}
          className="bg-background/95 absolute top-2 left-2 max-w-xs rounded border px-3 py-2 text-sm"
        >
          {error ?? "Preparing drawing overlay…"}
          {error && (
            <button
              type="button"
              className="pointer-events-auto ml-2 underline"
              onClick={() => setAttempt((current) => current + 1)}
            >
              Retry overlay
            </button>
          )}
        </p>
      )}
    </div>
  );
}

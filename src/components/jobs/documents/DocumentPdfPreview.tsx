"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
  MinusIcon,
  PlusIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { loadPdfDocument } from "~/lib/pdf-client";
import { useSnapshotSource } from "~/components/chat/SnapshotSourceContext";
import type { SnapshotState } from "~/lib/snapshot-source";

/** Render passive PDF pages locally; never depend on mobile browser PDF plugins. */
export function DocumentPdfPreview({
  url,
  title,
  onReady,
  initialView,
}: {
  url: string;
  title: string;
  onReady?: () => void;
  initialView?: SnapshotState["pdf"];
}) {
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const ready = useRef(onReady);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(initialView?.page ?? 1);
  const [pages, setPages] = useState(0);
  const [zoom, setZoom] = useState(initialView?.zoom ?? 1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const position = useRef(initialView);
  useLayoutEffect(() => {
    if (loading || error || !position.current || !frame.current) return;
    // Restore after the loading indicator is removed from the scroll area.
    frame.current.scrollLeft =
      position.current.left * frame.current.scrollWidth;
    frame.current.scrollTop = position.current.top * frame.current.scrollHeight;
    position.current = undefined;
  }, [loading, error]);
  useSnapshotSource("pdf", () => ({
    page,
    zoom,
    left: frame.current
      ? frame.current.scrollLeft / Math.max(1, frame.current.scrollWidth)
      : 0,
    top: frame.current
      ? frame.current.scrollTop / Math.max(1, frame.current.scrollHeight)
      : 0,
  }));
  useEffect(() => {
    ready.current = onReady;
  }, [onReady]);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const update = () => setWidth(Math.max(0, element.clientWidth - 16));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const target = canvas.current;
    if (!target || !width) return;
    let active = true;
    let task: RenderTask | null = null;
    void (async () => {
      const document = await loadPdfDocument(url);
      if (!active) return;
      setLoading(true);
      setError("");
      setPages(document.numPages);
      const pdfPage = await document.getPage(Math.min(page, document.numPages));
      if (!active) return;
      const unit = pdfPage.getViewport({ scale: 1 });
      const cssWidth = width * zoom;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // Keep high-DPI text sharp while bounding the canvas on large shop drawings.
      const scale = Math.min(
        (cssWidth / unit.width) * dpr,
        Math.sqrt(8_000_000 / (unit.width * unit.height)),
      );
      const viewport = pdfPage.getViewport({ scale });
      target.width = Math.ceil(viewport.width);
      target.height = Math.ceil(viewport.height);
      target.style.width = `${cssWidth}px`;
      target.style.height = `${(cssWidth * unit.height) / unit.width}px`;
      task = pdfPage.render({ canvas: target, viewport });
      await task.promise;
      if (active) {
        setLoading(false);
        ready.current?.();
      }
    })().catch((reason: unknown) => {
      if (!active) return;
      setLoading(false);
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not load the PDF. Download it to view it in another app.",
      );
    });
    return () => {
      active = false;
      task?.cancel();
    };
  }, [url, page, width, zoom]);
  return (
    <section
      aria-label={title}
      data-snapshot-rendering={loading}
      className="flex w-full flex-col overflow-hidden rounded-md border"
    >
      <div className="bg-background flex flex-wrap items-center justify-between gap-2 border-b p-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Previous PDF page"
            disabled={loading || page <= 1}
            onClick={() => {
              setPage((value) => value - 1);
              if (frame.current) frame.current.scrollTop = 0;
            }}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="min-w-16 text-center text-xs tabular-nums">
            {page} / {pages || "…"}
          </span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Next PDF page"
            disabled={loading || page >= pages}
            onClick={() => {
              setPage((value) => value + 1);
              if (frame.current) frame.current.scrollTop = 0;
            }}
          >
            <ChevronRightIcon />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Zoom PDF out"
            disabled={zoom <= 1}
            onClick={() => setZoom((value) => Math.max(1, value - 0.5))}
          >
            <MinusIcon />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-xs"
            onClick={() => setZoom(1)}
          >
            Fit
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Zoom PDF in"
            disabled={zoom >= 3}
            onClick={() => setZoom((value) => Math.min(3, value + 0.5))}
          >
            <PlusIcon />
          </Button>
        </div>
      </div>
      <div
        ref={frame}
        className="relative h-[48dvh] min-h-60 overflow-auto bg-slate-100 p-2"
      >
        <canvas
          ref={canvas}
          aria-label={`${title}, page ${page}`}
          className={`mx-auto block bg-white ${error ? "hidden" : ""}`}
        />
        {loading && (
          <div
            role="status"
            className="bg-background/95 sticky bottom-2 mx-auto flex w-fit items-center gap-2 rounded-md px-3 py-2 text-xs shadow-sm"
          >
            <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
            Loading PDF…
          </div>
        )}
        {error && (
          <p
            role="alert"
            className="bg-background text-destructive rounded-md p-4 text-sm break-words"
          >
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

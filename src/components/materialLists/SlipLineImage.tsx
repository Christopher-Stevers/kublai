"use client";
import { useEffect, useRef, useState } from "react";
import { loadPdfJs } from "~/lib/pdf-client";
import type { SlipBox } from "~/lib/packing-slip-review";

/** Rendered pages of one slip file, shared by every line image of a review. */
type Page = HTMLCanvasElement | ImageBitmap;
const sources = new Map<string, Promise<(page: number) => Promise<Page>>>();
const KEEP = 3;

function slipSource(url: string) {
  const cached = sources.get(url);
  if (cached) return cached;
  const promise = (async () => {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) throw Error("Slip file unavailable.");
    const blob = await response.blob();
    if (blob.type !== "application/pdf") {
      const image = await createImageBitmap(blob);
      return async () => image;
    }
    const pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
      wasmUrl: "/api/pdfjs-assets/wasm/",
      standardFontDataUrl: "/api/pdfjs-assets/standard_fonts/",
    }).promise;
    const pages = new Map<number, Promise<Page>>();
    return (n: number) => {
      let page = pages.get(n);
      if (!page) {
        page = pdf.getPage(n).then(async (p) => {
          const raw = p.getViewport({ scale: 1 });
          const viewport = p.getViewport({
            scale: Math.min(3, 1800 / Math.max(raw.width, raw.height)),
          });
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          await p.render({ canvas, viewport }).promise;
          return canvas;
        });
        pages.set(n, page);
      }
      return page;
    };
  })();
  sources.set(url, promise);
  void promise.catch(() => sources.delete(url));
  while (sources.size > KEEP) sources.delete(sources.keys().next().value!);
  return promise;
}

/** The slip's column headings above one printed line, cut from the page so
 * the reader can compare the numbers with what was read. */
export function SlipLineImage({
  url,
  page,
  box,
  header,
  label,
}: {
  url: string;
  page: number;
  box: SlipBox;
  /** Column headings, printed on `page` unless the table started earlier. */
  header?: { page: number; box: SlipBox };
  label: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"waiting" | "ready" | "failed">("waiting");
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    const target = canvas.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    let cancelled = false;
    const draw = async () => {
      const source = await slipSource(url);
      const head = header?.box;
      const left = Math.max(0, Math.min(box.x, head?.x ?? 1) - 0.01),
        right = Math.min(
          1,
          Math.max(box.x + box.width, head ? head.x + head.width : 0) + 0.01,
        );
      const pad = Math.max(box.height * 0.25, 0.004);
      const strips = await Promise.all(
        [
          ...(header
            ? [
                {
                  page: header.page,
                  y: header.box.y - 0.003,
                  h: header.box.height + 0.006,
                },
              ]
            : []),
          { page, y: box.y - pad, h: box.height + pad * 2 },
        ].map(async (s) => {
          const image = await source(s.page);
          const y = Math.max(0, s.y);
          return {
            image,
            sx: Math.round(left * image.width),
            sy: Math.round(y * image.height),
            sw: Math.max(1, Math.round((right - left) * image.width)),
            sh: Math.max(1, Math.round(Math.min(1 - y, s.h) * image.height)),
          };
        }),
      );
      if (cancelled) return;
      const gap = header ? 6 : 0;
      const width = Math.max(...strips.map((s) => s.sw));
      target.width = width;
      target.height =
        strips.reduce((sum, s) => sum + (s.sh * width) / s.sw, 0) + gap;
      const ctx = target.getContext("2d");
      if (!ctx) throw Error("No canvas.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, target.width, target.height);
      let at = 0;
      strips.forEach((s, i) => {
        const h = (s.sh * width) / s.sw;
        ctx.drawImage(s.image, s.sx, s.sy, s.sw, s.sh, 0, at, width, h);
        at += h;
        if (header && i === 0) {
          ctx.fillStyle = "#d4d4d8";
          ctx.fillRect(0, at + gap / 2 - 1, width, 2);
          at += gap;
        }
      });
      setState("ready");
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        draw().catch(() => {
          if (!cancelled) setState("failed");
        });
      },
      { rootMargin: "200px" },
    );
    observer.observe(target);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [url, page, box, header]);
  if (state === "failed") return null;
  // Whole line by default; tap to enlarge on small screens.
  return (
    <div className="overflow-x-auto rounded border bg-white">
      <button
        type="button"
        className="block w-full cursor-zoom-in text-left aria-pressed:cursor-zoom-out"
        aria-pressed={zoom}
        title={zoom ? "Fit to width" : "Enlarge"}
        disabled={state !== "ready"}
        onClick={() => setZoom((z) => !z)}
      >
        <canvas
          ref={canvas}
          role="img"
          aria-label={label}
          className={
            state !== "ready"
              ? "block h-10 w-full animate-pulse bg-zinc-100"
              : zoom
                ? "block h-auto w-[48rem] max-w-none"
                : "block h-auto w-full"
          }
        />
      </button>
    </div>
  );
}

"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ScanLine,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { loadPdfJs } from "~/lib/pdf-client";
import type { SlipBox } from "~/lib/packing-slip-review";
import {
  boundedSlipBox,
  selectedSlipText,
  slipSourceTextUrl,
  slipPdfTextBox,
  type SlipSourceWord,
} from "~/lib/slip-source-selection";

type Source = {
  pages: number;
  render: (
    page: number,
    target: HTMLCanvasElement,
  ) => Promise<SlipSourceWord[]>;
  close: () => void;
};

export type RecoveredSlipSource = {
  page: number;
  box?: SlipBox;
  description: string;
};
export type ResolveSlipSourceProps = {
  url: string;
  initialPage?: number;
  initialBox?: SlipBox;
  savedWords?: SlipSourceWord[];
  onUse: (source: RecoveredSlipSource) => void;
  onCancel: () => void;
  onDetect?: (page: number, box: SlipBox) => Promise<void>;
  disabled?: boolean;
};

/** Original evidence stays in the review window. No selected text or crop is
 * accepted as a receipt or confirmed quantity; the parent opens an editable line. */
export function ResolveSlipSource({
  url,
  initialPage = 1,
  initialBox,
  savedWords,
  onUse,
  onCancel,
  disabled,
  onDetect,
}: ResolveSlipSourceProps) {
  const id = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<Source>();
  const [page, setPage] = useState(initialPage);
  const [box, setBox] = useState<SlipBox | undefined>(
    initialBox && boundedSlipBox(initialBox),
  );
  const [words, setWords] = useState<SlipSourceWord[]>([]);
  const [cachedWords, setCachedWords] = useState<SlipSourceWord[]>([]);
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [selecting, setSelecting] = useState(Boolean(onDetect));
  const [zoom, setZoom] = useState(false);
  const drag = useRef<{ x: number; y: number; pointerId: number } | undefined>(
    undefined,
  );

  useEffect(() => {
    let disposed = false;
    let close: (() => void) | undefined;
    const controller = new AbortController();
    const textUrl = slipSourceTextUrl(url);
    setSource(undefined);
    setReady(false);
    setError("");
    setPage(initialPage);
    setBox(initialBox && boundedSlipBox(initialBox));
    setDescription("");
    setWords([]);
    setCachedWords([]);
    if (!textUrl) {
      setError(
        "The original slip is unavailable here. Enter the missing line manually.",
      );
      return;
    }
    void fetch(textUrl, {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) =>
        response.ok
          ? (response.json() as Promise<{ words?: SlipSourceWord[] }>)
          : undefined,
      )
      .then((data) => {
        if (!disposed && Array.isArray(data?.words)) setCachedWords(data.words);
      })
      .catch(() => undefined);
    void (async () => {
      const response = await fetch(url, {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok)
        throw Error(
          "The original slip could not be loaded. You can enter the missing line manually.",
        );
      const blob = await response.blob();
      if (disposed) return;
      const pdfSignature = await blob.slice(0, 5).text();
      let next: Source;
      if (blob.type === "application/pdf" || pdfSignature === "%PDF-") {
        const pdfjs = await loadPdfJs();
        if (disposed) return;
        const task = pdfjs.getDocument({
          data: new Uint8Array(await blob.arrayBuffer()),
          wasmUrl: "/api/pdfjs-assets/wasm/",
          standardFontDataUrl: "/api/pdfjs-assets/standard_fonts/",
        });
        close = () => {
          void task.destroy().catch(() => undefined);
        };
        if (disposed) {
          close();
          return;
        }
        const pdf = await task.promise;
        next = {
          pages: pdf.numPages,
          close,
          render: async (number, target) => {
            const p = await pdf.getPage(number);
            const raw = p.getViewport({ scale: 1 });
            const viewport = p.getViewport({
              scale: Math.min(3, 2600 / Math.max(raw.width, raw.height)),
            });
            target.width = Math.ceil(viewport.width);
            target.height = Math.ceil(viewport.height);
            await p.render({ canvas: target, viewport }).promise;
            const text = await p.getTextContent();
            return text.items.flatMap((item) => {
              if (!("str" in item) || !item.str.trim()) return [];
              const m = pdfjs.Util.transform(
                raw.transform,
                item.transform,
              ) as number[];
              const rect = slipPdfTextBox(m, item.width, raw.width, raw.height);
              return rect ? [{ ...rect, page: number, text: item.str }] : [];
            });
          },
        };
      } else if (/^image\/(png|jpeg|webp|gif)$/.test(blob.type)) {
        const bitmap = await createImageBitmap(blob);
        close = () => bitmap.close();
        next = {
          pages: 1,
          close,
          render: async (_number, target) => {
            const scale = Math.min(
              1,
              2600 / Math.max(bitmap.width, bitmap.height),
            );
            target.width = Math.max(1, Math.round(bitmap.width * scale));
            target.height = Math.max(1, Math.round(bitmap.height * scale));
            const context = target.getContext("2d");
            if (!context) throw Error("The slip image could not be displayed.");
            context.drawImage(bitmap, 0, 0, target.width, target.height);
            return [];
          },
        };
      } else
        throw Error(
          "This file cannot be previewed. Open the original or enter the missing line manually.",
        );
      if (disposed) {
        next.close();
        return;
      }
      setSource(next);
      setPage(Math.max(1, Math.min(next.pages, initialPage)));
    })().catch((cause: unknown) => {
      if (!disposed)
        setError(
          cause instanceof Error
            ? cause.message
            : "The original slip could not be loaded.",
        );
    });
    return () => {
      disposed = true;
      controller.abort();
      close?.();
    };
    // The source is immutable for this mount; page/box edits belong to the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    if (!source || !canvas.current) return;
    let cancelled = false;
    setReady(false);
    setWords([]);
    // Render on an isolated canvas so quick paging cannot collide in PDF.js.
    const target = document.createElement("canvas");
    void source
      .render(page, target)
      .then((extracted) => {
        if (cancelled || !canvas.current) return;
        const visible = canvas.current;
        visible.width = target.width;
        visible.height = target.height;
        visible.getContext("2d")?.drawImage(target, 0, 0);
        setWords(extracted);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "This page could not be displayed. Open the original or enter the line manually.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [source, page]);

  const changePage = (value: number) => {
    if (
      !source ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > source.pages
    )
      return;
    setPage(value);
    setBox(undefined);
    setDescription("");
    setMessage("");
    setError("");
  };
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };
  const moveSelection = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start?.pointerId !== event.pointerId) return;
    const end = point(event);
    setBox(
      boundedSlipBox({
        x: onDetect ? 0 : Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: onDetect ? 1 : Math.abs(start.x - end.x),
        height: Math.abs(start.y - end.y),
      }),
    );
  };
  const readSelection = () => {
    if (!box) return;
    const embedded = selectedSlipText(words, page, box);
    const saved = selectedSlipText(savedWords ?? cachedWords, page, box);
    setDescription(embedded || saved);
    setMessage(
      embedded
        ? "Text from the selected PDF area. Check and correct it before using it."
        : saved
          ? "Saved OCR text from the selected area. Check it against the image before using it."
          : "No readable saved text in this area. Type what the slip shows below.",
    );
  };

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="space-y-3 rounded-lg border p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-heading`} className="font-semibold">
          Find the line on the slip
        </h3>
        {slipSourceTextUrl(url) && (
          <a
            href={`${url}#page=${page}`}
            target="_blank"
            rel="noreferrer"
            className="text-primary text-sm underline"
          >
            Open original
          </a>
        )}
      </div>
      <p className="text-muted-foreground text-sm">
        Find the printed line, choose Select area, then drag a box around it.
        You can also enter the line manually.
      </p>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label="Previous slip page"
          disabled={!source || page <= 1}
          onClick={() => changePage(page - 1)}
        >
          <ChevronLeft />
        </Button>
        <label className="flex items-center gap-1 text-sm">
          Page{" "}
          <input
            aria-label="Slip page"
            type="number"
            min={1}
            max={source?.pages ?? 1}
            disabled={!source}
            value={page}
            onChange={(event) => changePage(Number(event.target.value))}
            className="bg-background w-14 rounded border px-2 py-1"
          />{" "}
          of {source?.pages ?? "…"}
        </label>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label="Next slip page"
          disabled={!source || page >= source.pages}
          onClick={() => changePage(page + 1)}
        >
          <ChevronRight />
        </Button>
        <Button
          type="button"
          size="sm"
          variant={selecting ? "default" : "outline"}
          aria-pressed={selecting}
          disabled={!ready}
          onClick={() => setSelecting((value) => !value)}
        >
          <ScanLine />
          {selecting ? "Selecting area" : "Select area"}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label={zoom ? "Fit slip to width" : "Enlarge slip"}
          disabled={!ready}
          onClick={() => setZoom((value) => !value)}
        >
          {zoom ? <ZoomOut /> : <ZoomIn />}
        </Button>
      </div>
      <div className="max-h-[55dvh] overflow-auto rounded border bg-zinc-100">
        <div
          className={`relative ${zoom ? "w-[200%]" : "w-full"} ${selecting ? "cursor-crosshair touch-none" : ""}`}
          onPointerDown={(event) => {
            if (!selecting || !ready || event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { ...point(event), pointerId: event.pointerId };
            setBox(undefined);
            setDescription("");
            setMessage("");
          }}
          onPointerMove={moveSelection}
          onPointerUp={(event) => {
            moveSelection(event);
            drag.current = undefined;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = undefined;
            setBox(undefined);
          }}
        >
          <canvas
            ref={canvas}
            role="img"
            aria-label={`Original packing slip, page ${page}`}
            className={`block h-auto w-full ${ready ? "" : "min-h-40 animate-pulse"}`}
          />
          {ready && box && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute border-2 border-blue-600 bg-blue-400/15"
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
              }}
            />
          )}
        </div>
      </div>
      {ready && (
        <details className="text-sm">
          <summary className="cursor-pointer">
            Set selection without dragging
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(["x", "y", "width", "height"] as const).map((key) => (
              <label key={key} className="space-y-1">
                {{ x: "Left", y: "Top", width: "Width", height: "Height" }[key]}{" "}
                %
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={
                    Math.round(
                      (box?.[key] ??
                        { x: 0, y: 0, width: 1, height: 0.1 }[key]) * 1000,
                    ) / 10
                  }
                  className="bg-background w-full rounded border p-2"
                  onChange={(event) => {
                    setBox(
                      boundedSlipBox({
                        ...(box ?? { x: 0, y: 0, width: 1, height: 0.1 }),
                        [key]: Number(event.target.value) / 100,
                      }),
                    );
                    setDescription("");
                    setMessage("");
                  }}
                />
              </label>
            ))}
          </div>
        </details>
      )}
      {!onDetect && <><Button
        type="button"
        variant="outline"
        disabled={!ready || !box || disabled === true}
        onClick={readSelection}
      >
        Read selected area
      </Button>
      {message && (
        <p role="status" className="text-muted-foreground text-sm">
          {message}
        </p>
      )}
      <label className="block space-y-1 text-sm" htmlFor={`${id}-text`}>
        <span>Line text — check or enter manually</span>
        <textarea
          id={`${id}-text`}
          value={description}
          maxLength={700}
          rows={3}
          onChange={(event) => setDescription(event.target.value)}
          className="bg-background w-full rounded border p-2"
        />
      </label>
      {description.length > 700 && (
        <p role="alert" className="text-destructive text-sm">
          The selected area contains too much text. Select one line or shorten
          it to 700 characters.
        </p>
      )}
      </>}
      {onDetect && <p className="text-sm text-muted-foreground">Draw a box over one item. Detection reads the full width of that row, including quantities and backorders.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={
            disabled === true || (onDetect ? !ready || !box : !description.trim() || description.length > 700)
          }
          onClick={() => { if (onDetect && box) { void onDetect(page, { ...box, x: 0, width: 1 }); } else onUse({ page, box, description: description.trim() }); }}
        >
          {onDetect ? (disabled ? "Detecting…" : "Detect This Line") : "Use this line"}
        </Button>
      </div>
    </section>
  );
}

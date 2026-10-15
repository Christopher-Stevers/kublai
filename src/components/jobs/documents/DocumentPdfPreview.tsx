"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
  MinusIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { loadPdfDocument } from "~/lib/pdf-client";
import { pdfTitleBlockWord } from "~/lib/drawing-title-block";
import {
  findPdfPageMatches,
  indexPdfText,
  MAX_PDF_SEARCH_MATCHES,
  normalizePdfSearchText,
  type PdfSearchMatch,
  type PdfTextIndex,
} from "~/lib/pdf-document-search";
import { useSnapshotSource } from "~/components/chat/SnapshotSourceContext";
import type { SnapshotState } from "~/lib/snapshot-source";

type SearchState = {
  matches: PdfSearchMatch[];
  scanned: number;
  total: number;
  searching: boolean;
  hasText: boolean;
  error: string;
  capped: boolean;
};
const emptySearch = (): SearchState => ({
  matches: [],
  scanned: 0,
  total: 0,
  searching: false,
  hasText: false,
  error: "",
  capped: false,
});

/** Private PDF rendering and document-wide text search, including mobile browsers. */
export function DocumentPdfPreview({
  url,
  title,
  onReady,
  initialView,
  fillHeight = false,
}: {
  url: string;
  title: string;
  onReady?: () => void;
  initialView?: SnapshotState["pdf"];
  fillHeight?: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const activeHighlight = useRef<HTMLSpanElement>(null);
  const rendering = useRef<RenderTask | null>(null);
  const ready = useRef(onReady);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(initialView?.page ?? 1);
  const [pages, setPages] = useState(0);
  const [zoom, setZoom] = useState(initialView?.zoom ?? 1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>(emptySearch);
  const [matchIndex, setMatchIndex] = useState(0);
  const indexes = useRef(new Map<string, PdfTextIndex>());
  const position = useRef(initialView);
  const selected = search.matches[matchIndex];
  const highlights = useMemo(
    () =>
      search.matches.flatMap((match, index) =>
        match.page === page
          ? match.rects.map((rect, part) => ({
              rect,
              active: index === matchIndex,
              key: `${index}:${part}`,
            }))
          : [],
      ),
    [search.matches, page, matchIndex],
  );

  useLayoutEffect(() => {
    if (loading || error || !position.current || !frame.current) return;
    frame.current.scrollLeft =
      position.current.left * frame.current.scrollWidth;
    frame.current.scrollTop = position.current.top * frame.current.scrollHeight;
    position.current = undefined;
  }, [loading, error]);
  useLayoutEffect(() => {
    if (!loading && selected?.page === page)
      activeHighlight.current?.scrollIntoView?.({
        block: "center",
        inline: "center",
      });
  }, [loading, page, selected, zoom]);
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
    if (!fillHeight) return;
    const find = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
      }
    };
    window.addEventListener("keydown", find);
    return () => window.removeEventListener("keydown", find);
  }, [fillHeight]);
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
    setLoading(true);
    setError("");
    void (async () => {
      // Cancellation is asynchronous: do not reuse the canvas until it finishes.
      await rendering.current?.promise.catch(() => undefined);
      const document = await loadPdfDocument(url);
      if (!active) return;
      setPages(document.numPages);
      const actualPage = Math.max(1, Math.min(page, document.numPages));
      if (actualPage !== page) {
        setPage(actualPage);
        return;
      }
      const pdfPage = await document.getPage(actualPage);
      if (!active) return;
      const unit = pdfPage.getViewport({ scale: 1 });
      const cssWidth = width * zoom;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
      rendering.current = task;
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

  useEffect(() => {
    const needle = normalizePdfSearchText(query);
    let active = true;
    setMatchIndex(0);
    setSearch({ ...emptySearch(), searching: !!needle });
    if (!needle) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const document = await loadPdfDocument(url);
        const matches: PdfSearchMatch[] = [];
        let hasText = false;
        for (let number = 1; number <= document.numPages; number++) {
          if (!active) return;
          const key = `${url}:${number}`;
          let index = indexes.current.get(key);
          if (!index) {
            const pdfPage = await document.getPage(number);
            if (!active) return;
            const content = await pdfPage.getTextContent();
            if (!active) return;
            const viewport = pdfPage.getViewport({ scale: 1 });
            index = indexPdfText(
              content.items.flatMap((item) =>
                "str" in item
                  ? [
                      {
                        rect: pdfTitleBlockWord(item, viewport),
                        hasEOL: item.hasEOL,
                      },
                    ]
                  : [],
              ),
            );
            indexes.current.set(key, index);
            // Scope private text to this viewer and bound retained page indexes.
            while (indexes.current.size > 12)
              indexes.current.delete(indexes.current.keys().next().value!);
          }
          hasText ||= !!index.text;
          const found = findPdfPageMatches(
            index,
            needle,
            number,
            MAX_PDF_SEARCH_MATCHES - matches.length,
          );
          if (!matches.length && found.length) setPage(number);
          matches.push(...found);
          const capped = matches.length >= MAX_PDF_SEARCH_MATCHES;
          setSearch({
            matches: [...matches],
            scanned: number,
            total: document.numPages,
            searching: !capped && number < document.numPages,
            hasText,
            error: "",
            capped,
          });
          if (capped) break;
        }
      })().catch(() => {
        if (active)
          setSearch({
            ...emptySearch(),
            error:
              "Could not search the PDF. Check your connection and try again.",
          });
      });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, url]);
  const goMatch = (direction: number) => {
    if (!search.matches.length) return;
    const index =
      (matchIndex + direction + search.matches.length) % search.matches.length;
    setMatchIndex(index);
    setPage(search.matches[index]!.page);
  };
  const searchStatus =
    search.error ||
    (search.matches.length
      ? `${matchIndex + 1} of ${search.matches.length.toLocaleString()}${search.capped ? "+" : ""}${search.searching ? " · Searching…" : ""}`
      : search.searching
        ? `Searching ${search.scanned} / ${search.total || "…"} pages…`
        : !search.hasText
          ? "No searchable text. This PDF may contain scanned images."
          : "No matches");
  return (
    <section
      aria-label={title}
      data-snapshot-rendering={loading}
      className={`flex w-full flex-col overflow-hidden ${fillHeight ? "min-h-0 flex-1" : "rounded-md border"}`}
    >
      <div className="bg-background flex shrink-0 flex-wrap items-center justify-between gap-2 border-b p-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-9"
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
            className="size-9"
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
            className="size-9"
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
            className="h-9 px-2 text-xs"
            onClick={() => setZoom(1)}
          >
            Fit
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-9"
            aria-label="Zoom PDF in"
            disabled={zoom >= 5}
            onClick={() => setZoom((value) => Math.min(5, value + 0.5))}
          >
            <PlusIcon />
          </Button>
        </div>
      </div>
      <div className="bg-background flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5">
        <SearchIcon
          className="text-muted-foreground mx-1 size-4 shrink-0"
          aria-hidden="true"
        />
        <input
          ref={searchInput}
          type="search"
          aria-label="Search PDF text"
          placeholder="Search this PDF"
          value={query}
          maxLength={250}
          className="focus-visible:ring-ring h-9 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-base outline-none focus-visible:ring-2 sm:text-sm"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              goMatch(event.shiftKey ? -1 : 1);
            }
            if (event.key === "Escape" && query) {
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
            }
          }}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-9"
          aria-label="Previous search result"
          disabled={!search.matches.length}
          onClick={() => goMatch(-1)}
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-9"
          aria-label="Next search result"
          disabled={!search.matches.length}
          onClick={() => goMatch(1)}
        >
          <ChevronRightIcon />
        </Button>
        {query && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-9"
            aria-label="Clear PDF search"
            onClick={() => {
              setQuery("");
              searchInput.current?.focus();
            }}
          >
            <XIcon />
          </Button>
        )}
        {!!query && (
          <p
            role="status"
            aria-label="PDF search results"
            className="text-muted-foreground w-full px-1 text-xs"
          >
            {searchStatus}
          </p>
        )}
      </div>
      <div
        ref={frame}
        data-testid="pdf-scroll-area"
        className={`relative overflow-auto bg-slate-200 p-2 dark:bg-slate-900 ${fillHeight ? "min-h-0 flex-1" : "h-[48dvh] min-h-60"}`}
      >
        <div
          className="relative mx-auto"
          style={{ width: width ? width * zoom : undefined }}
        >
          <canvas
            ref={canvas}
            aria-label={`${title}, page ${page}`}
            className={`block bg-white ${error ? "hidden" : ""}`}
          />
          {!loading &&
            !error &&
            highlights.map(({ rect, active, key }) => (
              <span
                key={key}
                ref={active ? activeHighlight : undefined}
                data-pdf-search-match=""
                data-active={active}
                className={`pointer-events-none absolute mix-blend-multiply ${active ? "bg-orange-400/60 outline-2 outline-orange-600" : "bg-yellow-300/50"}`}
                style={{
                  left: `${rect.left * 100}%`,
                  top: `${rect.top * 100}%`,
                  width: `${Math.max(0.001, rect.right - rect.left) * 100}%`,
                  height: `${Math.max(0.001, rect.bottom - rect.top) * 100}%`,
                }}
              />
            ))}
        </div>
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

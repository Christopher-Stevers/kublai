"use client";

import { DocumentDrawingWorkspace } from "./DocumentDrawingWorkspace";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DrawingSheetViewer,
  type DrawingViewport,
} from "../DrawingSheetViewer";
import type { DrawingEntity } from "~/lib/drawing-workspace";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
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

type PreviewProps = {
  url: string;
  title: string;
  onReady?: () => void;
  initialView?: SnapshotState["pdf"];
  fillHeight?: boolean;
  jobId?: string;
  versionId?: string;
  onDocumentDetails?: () => void;
  onClose?: () => void;
};
/** Full document views use the actual Drawings workspace. Comparisons retain a passive preview. */
export function DocumentPdfPreview(props: PreviewProps) {
  if (props.jobId && props.versionId)
    return (
      <DocumentDrawingWorkspace
        jobId={props.jobId}
        versionId={props.versionId}
        initialView={props.initialView}
        onReady={props.onReady}
        onDocumentDetails={props.onDocumentDetails}
        onClose={props.onClose}
      />
    );
  return <PassiveDocumentPdfPreview {...props} />;
}

function PassiveDocumentPdfPreview({
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
  const [backing, setBacking] = useState<{ page: number; src: string } | null>(
    null,
  );
  const [viewport, setViewport] = useState<DrawingViewport>(
    initialView?.viewport ?? {
      zoom: initialView?.zoom ?? 1,
      center: { x: 0.5, y: 0.5 },
    },
  );
  const [navigate, setNavigate] = useState<
    (DrawingViewport & { requestId: string; page: number }) | null
  >(null);
  const searchInput = useRef<HTMLInputElement>(null);

  const ready = useRef(onReady);
  const [page, setPage] = useState(initialView?.page ?? 1);
  const [pages, setPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>(emptySearch);
  const [matchIndex, setMatchIndex] = useState(0);
  const indexes = useRef(new Map<string, PdfTextIndex>());
  const selected = search.matches[matchIndex];
  const highlights = useMemo<DrawingEntity[]>(
    () =>
      search.matches.flatMap((match, index) =>
        match.page === page
          ? match.rects.map((rect, part) => ({
              id: `search-${index}-${part}`,
              sheetId: "document",
              kind: "markup" as const,
              visibility: "private" as const,
              revision: 0,
              authorId: "",
              authorName: "",
              createdAt: "",
              updatedAt: "",
              comments: [],
              data: {
                sourceSheetId: "document",
                type: "rect" as const,
                points: [
                  { x: rect.left, y: rect.top },
                  { x: rect.right, y: rect.bottom },
                ],
                stroke: index === matchIndex ? "#ea580c" : "#eab308",
                fill: index === matchIndex ? "#fb923c66" : "#fde04755",
                width: 1,
              },
            }))
          : [],
      ),
    [search.matches, page, matchIndex],
  );
  useEffect(() => {
    if (selected?.page !== page || !selected.rects[0]) return;
    const rect = selected.rects[0];
    setNavigate({
      page,
      center: {
        x: (rect.left + rect.right) / 2,
        y: (rect.top + rect.bottom) / 2,
      },
      zoom: Math.max(2, viewport.zoom),
      requestId: `search-${page}-${matchIndex}-${query}`,
    });
    // A search result moves once; panning afterwards must remain under user control.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, page, matchIndex, query]);
  useSnapshotSource("pdf", () => ({
    page,
    zoom: viewport.zoom,
    viewport,
    left: 0,
    top: 0,
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
    let active = true;
    setLoading(true);
    setError("");
    setBacking(null);
    void (async () => {
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
      const size = pdfPage.getViewport({ scale: 1 });
      // Only a white page-sized backing image is needed. All PDF ink, including
      // sharp detail at deep zoom, is rendered by the shared drawing viewer.
      const src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}"><rect width="100%" height="100%" fill="white"/></svg>`)}`;
      setBacking({ page: actualPage, src });
    })().catch((reason: unknown) => {
      if (active) {
        setLoading(false);
        setError(
          reason instanceof Error ? reason.message : "Could not load the PDF.",
        );
      }
    });
    return () => {
      active = false;
    };
  }, [url, page]);

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
        className={`relative min-h-0 flex-1 ${fillHeight ? "" : "h-[48dvh] min-h-60"}`}
      >
        {backing?.page === page && (
          <DrawingSheetViewer
            key={`${url}:${page}`}
            src={backing.src}
            alt={`${title}, page ${page}`}
            pdf={{ url, page }}
            sheetKey={`document:${url}:${page}`}
            initialViewport={
              initialView?.page === page
                ? (initialView.viewport ?? {
                    center: { x: 0.5, y: 0.5 },
                    zoom: initialView.zoom,
                  })
                : null
            }
            navigateTo={navigate?.page === page ? navigate : null}
            onViewportChange={setViewport}
            annotations={highlights}
            canEditAnnotation={() => false}
            onPdfReady={() => {
              setLoading(false);
              setError("");
              ready.current?.();
            }}
            onPdfError={() => {
              setLoading(false);
              setError("Could not render the PDF. Retrying…");
            }}
            onPdfLink={(link) => {
              if (link.page) setPage(link.page);
              else if (link.url && /^(https?:|mailto:|tel:)/i.test(link.url))
                window.open(link.url, "_blank", "noopener,noreferrer");
            }}
          />
        )}
        {loading && (
          <p
            role="status"
            className="bg-background/95 absolute top-2 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-md px-3 py-2 text-xs shadow-sm"
          >
            <Loader2Icon className="size-4 animate-spin" />
            Loading PDF…
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="bg-background text-destructive absolute inset-x-2 top-2 rounded-md p-4 text-sm"
          >
            {error}
          </p>
        )}
      </div>
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
            }}
          >
            <ChevronRightIcon />
          </Button>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            setNavigate({
              page,
              center: { x: 0.5, y: 0.5 },
              zoom: 1,
              requestId: crypto.randomUUID(),
            })
          }
        >
          Fit
        </Button>
        <span className="text-xs tabular-nums">
          {Math.round(viewport.zoom * 100)}%
        </span>
      </div>
    </section>
  );
}

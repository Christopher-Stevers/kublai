"use client";

import { clearDrawingGeometryWorkers } from "./drawing-geometry-client";
import {
  clearPdfRangeSources,
  PDF_RANGE_BLOCK,
  pdfRangeSource,
} from "./pdf-range-source";

import type * as PdfJsModule from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Browser-side PDF.js, loaded only when a drawing is opened. The legacy build
 * supports older iPhones. Documents are kept for the folder being viewed so
 * paging between sheets of one uploaded PDF downloads it once.
 */
type PdfJs = typeof PdfJsModule;
let library: Promise<PdfJs> | null = null;
type Entry = { promise: Promise<PDFDocumentProxy>; destroy: () => void };
const documents = new Map<string, Entry>();
const KEEP_DOCUMENTS = 2;

/** Call on logout/account changes: parsed private pages must not outlive identity. */
export function clearPdfDocuments() {
  clearDrawingGeometryWorkers();
  const entries = [...documents.values()];
  documents.clear();
  for (const entry of entries) entry.destroy();
  clearPdfRangeSources();
}

export function loadPdfJs() {
  if (library) return library;
  const pending = import(
    /* webpackChunkName: "drawing-pdf-runtime" */ "pdfjs-dist/legacy/build/pdf.mjs"
  ).then((pdfjs) => {
    // Served from the installed package (see /api/pdfjs-assets).
    pdfjs.GlobalWorkerOptions.workerSrc =
      "/api/pdfjs-assets/legacy/build/pdf.worker.min.mjs";
    return pdfjs;
  });
  library = pending;
  void pending.catch(() => {
    if (library === pending) library = null;
  });
  return pending;
}

export function loadPdfDocument(url: string) {
  const cached = documents.get(url);
  if (cached) {
    // Most recently used goes last.
    documents.delete(url);
    documents.set(url, cached);
    return cached.promise;
  }
  let destroyed = false;
  let destroyTask = () => undefined as void;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    destroyTask();
  };
  const start = (
    pdfjs: PdfJs,
    range: InstanceType<PdfJs["PDFDataRangeTransport"]> | null,
  ) => {
    const task = pdfjs.getDocument({
      ...(range
        ? { range, rangeChunkSize: PDF_RANGE_BLOCK }
        : { url, withCredentials: true, rangeChunkSize: 256 * 1024 }),
      // Read only the objects needed for the visible page. Streaming disables
      // PDF.js's demand-driven range mode, so turn it off along with prefetch.
      disableStream: true,
      disableAutoFetch: true,
      enableHWA: true,
      wasmUrl: "/api/pdfjs-assets/wasm/",
      standardFontDataUrl: "/api/pdfjs-assets/standard_fonts/",
    });
    destroyTask = () => {
      void task.destroy().catch(() => undefined);
    };
    if (destroyed) destroyTask();
    return task.promise;
  };
  const promise: Promise<PDFDocumentProxy> = loadPdfJs().then((pdfjs) => {
    // Bytes come through the shared downloader, so the detail worker and
    // this document never fetch the same range twice. Without range support
    // (or for a file already on this device) PDF.js loads the address itself.
    const source = pdfRangeSource(url);
    if (!source) return start(pdfjs, null);
    return source
      .open()
      .catch(() => null)
      .then((opened) => {
        if (!opened) return start(pdfjs, null);
        const range = new pdfjs.PDFDataRangeTransport(
          opened.length,
          opened.head,
        );
        range.requestDataRange = (begin, end) => {
          void source.read(begin, end).then(
            (chunk) => range.onDataRange(begin, chunk),
            // PDF.js has no failure signal for a range: drop the document so
            // waiting readers fail and the next one starts from the kept bytes.
            () => discardPdfDocument(url, promise),
          );
        };
        return start(pdfjs, range);
      });
  });
  void promise.catch(() => {
    destroy();
    if (documents.get(url)?.promise === promise) documents.delete(url);
  });
  documents.set(url, { promise, destroy });
  while (documents.size > KEEP_DOCUMENTS) {
    const [oldest, old] = documents.entries().next().value!;
    documents.delete(oldest);
    old.destroy();
  }
  return promise;
}

/** Evict only the stalled request; a newer consumer may already have replaced it. */
export function discardPdfDocument(
  url: string,
  expected: Promise<PDFDocumentProxy>,
) {
  const entry = documents.get(url);
  if (entry?.promise !== expected) return;
  documents.delete(url);
  entry.destroy();
}

/**
 * The original PDF page behind a split drawing image:
 * `/api/job-rooms/files/<job>/<upload>/floor-<n>.webp` → that upload's
 * `plan.pdf`, page n.
 */
export function sourcePdfPage(imageUrl: string) {
  const documentPage =
    /^\/api\/job-documents\/pages\/([0-9a-f-]{36})\/([1-9]\d*)\?jobId=([0-9a-f-]{36})$/i.exec(
      imageUrl,
    );
  if (documentPage)
    return {
      url: `/api/job-documents/files/${documentPage[1]}?jobId=${documentPage[3]}`,
      page: Number(documentPage[2]),
    };
  const match =
    /^(\/api\/job-rooms\/files\/[0-9a-f-]{36}\/[0-9a-f-]{36})\/floor-(\d+)\.webp$/i.exec(
      imageUrl,
    );
  return match ? { url: `${match[1]}/plan.pdf`, page: Number(match[2]) } : null;
}

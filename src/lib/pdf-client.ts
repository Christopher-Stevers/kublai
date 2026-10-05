"use client";

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

export function loadPdfJs() {
  library ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
    // Served from the installed package (see /api/pdfjs-assets).
    pdfjs.GlobalWorkerOptions.workerSrc = "/api/pdfjs-assets/legacy/build/pdf.worker.min.mjs";
    return pdfjs;
  });
  return library;
}

export function loadPdfDocument(url: string) {
  const cached = documents.get(url);
  if (cached) {
    // Most recently used goes last.
    documents.delete(url);
    documents.set(url, cached);
    return cached.promise;
  }
  let destroy = () => undefined as void;
  const promise = loadPdfJs().then((pdfjs) => {
    const task = pdfjs.getDocument({
      url,
      withCredentials: true,
      wasmUrl: "/api/pdfjs-assets/wasm/",
      standardFontDataUrl: "/api/pdfjs-assets/standard_fonts/",
    });
    destroy = () => void task.destroy();
    return task.promise;
  });
  promise.catch(() => documents.delete(url));
  documents.set(url, { promise, destroy: () => destroy() });
  while (documents.size > KEEP_DOCUMENTS) {
    const [oldest, old] = documents.entries().next().value!;
    documents.delete(oldest);
    old.destroy();
  }
  return promise;
}

/**
 * The original PDF page behind a split drawing image:
 * `/api/job-rooms/files/<job>/<upload>/floor-<n>.webp` → that upload's
 * `plan.pdf`, page n.
 */
export function sourcePdfPage(imageUrl: string) {
  const match = /^(\/api\/job-rooms\/files\/[0-9a-f-]{36}\/[0-9a-f-]{36})\/floor-(\d+)\.webp$/i.exec(imageUrl);
  return match ? { url: `${match[1]}/plan.pdf`, page: Number(match[2]) } : null;
}

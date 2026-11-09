/// <reference lib="webworker" />
// Rasterizes drawing PDF detail away from the page's main thread, so a long
// render never holds back a pinch, pan or wheel frame. PDF.js parses in this
// thread too, and finished pixels move to the page as a zero-copy ImageBitmap.
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type * as PdfJs from "pdfjs-dist/legacy/build/pdf.mjs";
import { completedPdfBounds, rememberPdfBounds } from "./drawing-pdf-bounds";
import {
  drawingPdfOperationsFilter,
  isFullDrawingPatch,
} from "./drawing-pdf-operations";
import type {
  RasterByteRequest,
  RasterRequest,
  RasterResponse,
} from "./drawing-pdf-raster-protocol";
import { PDF_RANGE_BLOCK } from "./pdf-range-source";

type RenderRequest = Extract<RasterRequest, { type: "render" }>;
const scope = self as unknown as DedicatedWorkerGlobalScope & {
  fonts?: FontFaceSet;
  pdfjsWorker?: unknown;
};
const ASSETS = `${scope.location.origin}/api/pdfjs-assets/`;
const KEEP_DOCUMENTS = 2;
const reply = (
  message: RasterResponse | RasterByteRequest,
  transfer: Transferable[] = [],
) => scope.postMessage(message, transfer);

// PDF bytes come from the page, which downloads each range once for this
// worker and its own readers alike.
type Bytes = Extract<RasterRequest, { type: "bytes" }>;
const byteRequests = new Map<number, (answer: Bytes) => void>();
let byteSequence = 0;
const askBytes = (url: string, begin?: number, end?: number) =>
  new Promise<Bytes>((resolve) => {
    const id = ++byteSequence;
    byteRequests.set(id, resolve);
    reply({ bytes: id, url, begin, end });
  });

let library: Promise<typeof PdfJs> | null = null;
const loadLibrary = () =>
  (library ??= (async () => {
    // The same worker file the page uses, run in this thread: parsing and
    // drawing then share one background thread instead of needing a nested one.
    scope.pdfjsWorker = await import(
      /* webpackIgnore: true */ `${ASSETS}legacy/build/pdf.worker.min.mjs`
    );
    return import(
      /* webpackChunkName: "drawing-pdf-runtime" */ "pdfjs-dist/legacy/build/pdf.mjs"
    );
  })().catch((error: unknown) => {
    // Offline without the renderer cached: let a later sheet try again.
    library = null;
    throw error;
  }));

class OffscreenCanvasFactory {
  #enableHWA: boolean;
  constructor({ enableHWA = false }: { enableHWA?: boolean }) {
    this.#enableHWA = enableHWA;
  }
  create(width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    const canvas = new OffscreenCanvas(width, height);
    return {
      canvas,
      context: canvas.getContext("2d", {
        willReadFrequently: !this.#enableHWA,
      }),
    };
  }
  reset(entry: { canvas: OffscreenCanvas | null }, width: number, height: number) {
    if (!entry.canvas) throw new Error("Canvas is not specified");
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    entry.canvas.width = width;
    entry.canvas.height = height;
  }
  destroy(entry: { canvas: OffscreenCanvas | null; context: unknown }) {
    if (!entry.canvas) throw new Error("Canvas is not specified");
    entry.canvas.width = entry.canvas.height = 0;
    entry.canvas = null;
    entry.context = null;
  }
}

// SVG filters (transfer functions, luminosity soft masks) live in a document.
// A page using them is drawn on the main thread instead of drawn wrongly here.
let needsDocument = false;
class WorkerFilterFactory {
  addFilter(maps: unknown) {
    if (maps) needsDocument = true;
    return "none";
  }
  addHCMFilter() {
    needsDocument = true;
    return "none";
  }
  addAlphaFilter() {
    needsDocument = true;
    return "none";
  }
  addLuminosityFilter() {
    needsDocument = true;
    return "none";
  }
  addKnockoutFilter() {
    return "none";
  }
  addHighlightHCMFilter() {
    return "none";
  }
  addSelectionHCMFilter() {
    return "none";
  }
  addSelectionFilter() {
    return "none";
  }
  createSelectionStyle() {
    return null;
  }
  destroy() {
    return undefined;
  }
}

type Entry = { task: PDFDocumentLoadingTask; promise: Promise<PDFDocumentProxy> };
const documents = new Map<string, Entry>();
function openDocument(url: string) {
  const cached = documents.get(url);
  if (cached) {
    documents.delete(url);
    documents.set(url, cached);
    return cached.promise;
  }
  const pending = loadLibrary().then(async (pdfjs) => {
    const fonts =
      scope.fonts && typeof FontFace === "function" ? scope.fonts : null;
    const opened = await askBytes(url);
    let range: InstanceType<(typeof PdfJs)["PDFDataRangeTransport"]> | null =
      null;
    if (opened.data && opened.length !== undefined) {
      range = new pdfjs.PDFDataRangeTransport(opened.length, opened.data);
      range.requestDataRange = (begin, end) => {
        void askBytes(url, begin, end).then(({ data }) => {
          if (data) range!.onDataRange(begin, data);
          // The download failed: fail this document's waiting renders. The
          // page keeps the bytes that did arrive for the next attempt.
          else if (documents.get(url) === entry) forget(url);
        });
      };
    }
    const task = pdfjs.getDocument({
      // Without ranges (or for a file already on this device) PDF.js loads
      // the address itself.
      ...(range
        ? { range, rangeChunkSize: PDF_RANGE_BLOCK }
        : {
            url: new URL(url, scope.location.href),
            withCredentials: true,
            rangeChunkSize: 256 * 1024,
          }),
      disableStream: true,
      disableAutoFetch: true,
      enableHWA: true,
      wasmUrl: `${ASSETS}wasm/`,
      standardFontDataUrl: `${ASSETS}standard_fonts/`,
      useWorkerFetch: false,
      isOffscreenCanvasSupported: true,
      // Embedded fonts load into this worker's own font set; without one,
      // glyphs are drawn as paths.
      disableFontFace: !fonts,
      ...(fonts ? { ownerDocument: { fonts } as unknown as Document } : {}),
      CanvasFactory: OffscreenCanvasFactory,
      FilterFactory: WorkerFilterFactory,
    } as Parameters<typeof pdfjs.getDocument>[0]);
    return task;
  });
  const entry: Entry = {
    task: null as unknown as PDFDocumentLoadingTask,
    promise: pending.then((task) => {
      entry.task = task;
      return task.promise;
    }),
  };
  documents.set(url, entry);
  entry.promise.catch(() => {
    if (documents.get(url) === entry) forget(url);
  });
  while (documents.size > KEEP_DOCUMENTS) {
    const oldest = documents.keys().next().value!;
    forget(oldest);
  }
  return entry.promise;
}
function forget(url: string) {
  const entry = documents.get(url);
  documents.delete(url);
  void entry?.promise
    .catch(() => undefined)
    .finally(() => void entry.task?.destroy().catch(() => undefined));
}

const queue: RenderRequest[] = [];
let active: { id: number; task: RenderTask | null; cancelled: boolean } | null =
  null;
let preparing: { page: PDFPageProxy; task: RenderTask; resume: (() => void) | null } | null =
  null;
const busy = () => !!active || queue.length > 0;
// setTimeout(0) is clamped to 4 ms once nested; a message hop is not.
const ticks = new MessageChannel();
const waiting: Array<() => void> = [];
ticks.port1.onmessage = () => waiting.shift()?.();
const soon = (next: () => void) => {
  waiting.push(next);
  ticks.port2.postMessage(null);
};

async function render(request: RenderRequest) {
  const job = { id: request.id, task: null as RenderTask | null, cancelled: false };
  active = job;
  const startedAt = performance.now();
  try {
    const document = await openDocument(request.url);
    const page = await document.getPage(request.page);
    if (job.cancelled) throw new Error("cancelled");
    const { patch } = request;
    const raw = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: patch.fullWidth / raw.width });
    const canvas = new OffscreenCanvas(patch.pixelWidth, patch.pixelHeight);
    const bounds = completedPdfBounds(page);
    const recordFullPage = !bounds && isFullDrawingPatch(patch);
    if (recordFullPage) page.recordedBBoxes = null;
    needsDocument = false;
    job.task = page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport,
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
    // Yield between chunks so a cancel or newer view can arrive mid-render.
    job.task.onContinue = soon;
    await job.task.promise;
    if (needsDocument)
      return reply({ id: job.id, ok: false, error: "unsupported", unsupported: true });
    if (recordFullPage) rememberPdfBounds(page);
    const bitmap = canvas.transferToImageBitmap();
    canvas.width = canvas.height = 0;
    reply({ id: job.id, ok: true, bitmap, renderMs: performance.now() - startedAt }, [bitmap]);
    if (!completedPdfBounds(page)) prepareBounds(page);
  } catch (error) {
    const cancelled =
      job.cancelled ||
      (error instanceof Error && error.name === "RenderingCancelledException");
    reply({
      id: job.id,
      ok: false,
      cancelled,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    active = null;
  }
}

/** A small full-page recording lets later crops skip offscreen ink. It only
 * runs while no detail is wanted and pauses as soon as one is. */
function prepareBounds(page: PDFPageProxy) {
  if (preparing || attempted.has(page)) return;
  attempted.add(page);
  const raw = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({
    scale: Math.min(1, 768 / Math.max(raw.width, raw.height)),
  });
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.ceil(viewport.width)),
    Math.max(1, Math.ceil(viewport.height)),
  );
  page.recordedBBoxes = null;
  const task = page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    viewport,
    recordOperations: true,
  });
  const job = { page, task, resume: null as (() => void) | null };
  preparing = job;
  task.onContinue = (next: () => void) => {
    if (busy()) job.resume = next;
    else soon(next);
  };
  void task.promise
    .then(() => rememberPdfBounds(page))
    .catch(() => undefined)
    .finally(() => {
      canvas.width = canvas.height = 0;
      if (preparing === job) preparing = null;
    });
}
const attempted = new WeakSet<PDFPageProxy>();

async function pump() {
  if (active) return;
  const next = queue.shift();
  if (next) await render(next);
  if (queue.length) return pump();
  const paused = preparing?.resume;
  if (paused && preparing) {
    preparing.resume = null;
    soon(paused);
  }
}

scope.onmessage = ({ data }: MessageEvent<RasterRequest>) => {
  if (data.type === "render") {
    queue.push(data);
    void pump();
  } else if (data.type === "cancel") {
    const queued = queue.findIndex((item) => item.id === data.id);
    if (queued >= 0) {
      queue.splice(queued, 1);
      reply({ id: data.id, ok: false, cancelled: true, error: "cancelled" });
    } else if (active?.id === data.id) {
      active.cancelled = true;
      active.task?.cancel();
    }
  } else if (data.type === "open") {
    void openDocument(data.url)
      .then((document) => document.getPage(data.page))
      .catch(() => undefined);
  } else if (data.type === "bytes") {
    byteRequests.get(data.request)?.(data);
    byteRequests.delete(data.request);
  } else if (data.type === "forget") forget(data.url);
};

"use client";

import { registerDrawingWorker } from "./drawing-geometry-client";
import type {
  RasterByteRequest,
  RasterRequest,
  RasterResponse,
} from "./drawing-pdf-raster-protocol";
import { pdfRangeSource } from "./pdf-range-source";
import type { DrawingPatch } from "./drawing-viewport";

/** The page needs main-thread drawing (SVG filters); not a loading failure. */
export class RasterUnsupportedError extends Error {}
const cancelled = () =>
  new DOMException("The drawing detail render was cancelled.", "AbortError");
export const isRasterCancel = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

/** Idle workers give back their parsed pages after this long. */
const IDLE_MS = 30_000;
type Pending = {
  resolve: (value: { bitmap: ImageBitmap; renderMs: number }) => void;
  reject: (error: unknown) => void;
};

class RasterClient {
  private worker: Worker;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private users = 0;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private unregister: () => void;
  closed = false;
  constructor() {
    this.worker = new Worker(
      new URL("./drawing-pdf-raster.worker.ts", import.meta.url),
      { type: "module", name: "drawing-pdf-raster" },
    );
    this.unregister = registerDrawingWorker(this);
    this.worker.onmessage = ({
      data,
    }: MessageEvent<RasterResponse | RasterByteRequest>) => {
      if ("bytes" in data) return this.serve(data);
      const pending = this.pending.get(data.id);
      if (!pending) {
        if (data.ok) data.bitmap.close();
        return;
      }
      this.pending.delete(data.id);
      if (data.ok) pending.resolve(data);
      else if (data.cancelled) pending.reject(cancelled());
      else if (data.unsupported)
        pending.reject(new RasterUnsupportedError(data.error));
      else pending.reject(new Error(data.error));
    };
    // A worker that cannot start or crashes is not retried this session.
    this.worker.onerror = () => {
      unavailable = true;
      this.dispose(new Error("The drawing detail worker stopped."));
    };
    this.worker.onmessageerror = () =>
      this.dispose(new Error("The drawing detail could not be read."));
  }
  private send(message: RasterRequest, transfer: Transferable[] = []) {
    this.worker.postMessage(message, transfer);
  }
  /** The worker's PDF bytes come from the page's shared download. */
  private serve({ bytes: request, url, begin, end }: RasterByteRequest) {
    const none = () => {
      if (!this.closed) this.send({ type: "bytes", request });
    };
    const source = pdfRangeSource(url);
    if (!source) return none();
    const reply = (data: Uint8Array, length?: number) => {
      if (this.closed) return;
      this.send({ type: "bytes", request, length, data }, [data.buffer]);
    };
    if (begin === undefined || end === undefined)
      void source
        .open()
        .then(
          (opened) => (opened ? reply(opened.head, opened.length) : none()),
          none,
        );
    else void source.read(begin, end).then((data) => reply(data), none);
  }
  acquire() {
    this.users++;
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    return () => {
      this.users--;
      if (this.users > 0 || this.closed) return;
      this.idle = setTimeout(() => this.dispose(), IDLE_MS);
    };
  }
  render(url: string, page: number, patch: DrawingPatch) {
    const id = ++this.sequence;
    const promise = new Promise<{ bitmap: ImageBitmap; renderMs: number }>(
      (resolve, reject) => {
        if (this.closed) return reject(cancelled());
        this.pending.set(id, { resolve, reject });
        this.send({ type: "render", id, url, page, patch });
      },
    );
    return {
      promise,
      cancel: () => {
        if (this.pending.has(id)) this.send({ type: "cancel", id });
      },
    };
  }
  /** Opens the document and page ahead of the first zoom. */
  warm(url: string, page: number) {
    if (!this.closed) this.send({ type: "open", url, page });
  }
  dispose(error: unknown = cancelled()) {
    if (this.closed) return;
    this.closed = true;
    if (this.idle) clearTimeout(this.idle);
    this.worker.terminate();
    this.unregister();
    if (shared === this) shared = null;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

let shared: RasterClient | null = null;
let unavailable = false;

/** True where a worker can draw a PDF and hand the pixels over without a copy. */
export function canRasterDrawingOffThread() {
  return (
    !unavailable &&
    typeof Worker === "function" &&
    typeof OffscreenCanvas === "function" &&
    typeof ImageBitmapRenderingContext === "function" &&
    typeof OffscreenCanvas.prototype.transferToImageBitmap === "function"
  );
}

/** One background renderer shared by every open drawing layer. */
export function drawingPdfRaster() {
  if (!canRasterDrawingOffThread()) return null;
  if (shared && !shared.closed) return shared;
  try {
    shared = new RasterClient();
  } catch {
    unavailable = true;
    shared = null;
  }
  return shared;
}

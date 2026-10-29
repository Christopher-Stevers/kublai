import type { RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import { loadPdfDocument } from "./pdf-client";
import { completedPdfBounds } from "./drawing-pdf-bounds";
import { drawingPdfOperationsFilter } from "./drawing-pdf-operations";

export type MagnifierCrop = {
  left: number;
  top: number;
  width: number;
  height: number;
  pixels: number;
};

/** Render a tiny sheet-space crop at lens resolution, never a giant page bitmap. */
export class DrawingPdfMagnifier {
  private desired: { key: string; crop: MagnifierCrop } | null = null;
  private ready: { key: string; crop: MagnifierCrop; canvas: HTMLCanvasElement } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private task: RenderTask | null = null;
  private running = false;
  private disposed = false;
  private retryAt = 0;

  constructor(
    private source: { url: string; page: number },
    private onReady: () => void,
  ) {}

  request(crop: MagnifierCrop): HTMLCanvasElement | null {
    if (
      this.disposed ||
      !Object.values(crop).every(Number.isFinite) ||
      crop.width <= 0 ||
      crop.height <= 0 ||
      crop.pixels <= 0
    )
      return null;
    crop = {
      ...crop,
      pixels: Math.min(1536, Math.max(1, Math.round(crop.pixels))),
    };
    const key = JSON.stringify(crop);
    if (this.desired?.key !== key) {
      this.desired = { key, crop };
      this.retryAt = 0;
      // Keep the pending render scheduled even while zoom changes every frame.
      // Restarting this timer would postpone detail until the gesture stopped.
    }
    if (this.ready?.key === key) return this.ready.canvas;
    this.schedule();
    return null;
  }

  /** Reproject completed detail as zoom advances; never show a different aim. */
  paint(context: CanvasRenderingContext2D, crop: MagnifierCrop, size: number) {
    const ready = this.ready;
    if (!ready || !contains(ready.crop, crop)) return;
    const scaleX = ready.canvas.width / ready.crop.width;
    const scaleY = ready.canvas.height / ready.crop.height;
    context.drawImage(
      ready.canvas,
      (crop.left - ready.crop.left) * scaleX,
      (crop.top - ready.crop.top) * scaleY,
      crop.width * scaleX, crop.height * scaleY,
      0, 0, size, size,
    );
  }

  private schedule() {
    if (
      this.disposed ||
      this.running ||
      this.timer ||
      !this.desired ||
      this.ready?.key === this.desired.key
    )
      return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.render();
      },
      Math.max(0, this.retryAt - Date.now()),
    );
  }

  private async render() {
    if (this.disposed || !this.desired) return;
    this.running = true;
    const canvas = document.createElement("canvas");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const page = await Promise.race([
        loadPdfDocument(this.source.url).then((doc) =>
          doc.getPage(this.source.page),
        ),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Magnifier PDF timed out")),
            30_000,
          );
        }),
      ]);
      if (timeout) clearTimeout(timeout);
      if (this.disposed || !this.desired) return;
      // A network wait may span multiple pointer moves. Always use the latest aim.
      const { key, crop } = this.desired;
      canvas.width = canvas.height = crop.pixels;
      const fullWidth = crop.pixels / crop.width;
      const fullHeight = crop.pixels / crop.height;
      const viewport = page.getViewport({
        scale: fullWidth / page.getViewport({ scale: 1 }).width,
      });
      const patch = {
        ...crop,
        pixelWidth: crop.pixels,
        pixelHeight: crop.pixels,
        fullWidth,
        fullHeight,
      };
      this.task = page.render({
        canvas,
        viewport,
        operationsFilter: drawingPdfOperationsFilter(
          completedPdfBounds(page),
          patch,
        ),
        transform: [
          1,
          0,
          0,
          fullHeight / viewport.height,
          -crop.left * fullWidth,
          -crop.top * fullHeight,
        ],
      });
      timeout = setTimeout(() => this.task?.cancel(), 30_000);
      await this.task.promise;
      if (this.disposed || !contains(crop, this.desired.crop)) return;
      if (this.ready?.key === this.desired.key && key !== this.desired.key) return;
      if (this.ready) this.ready.canvas.width = this.ready.canvas.height = 0;
      this.ready = { key, crop, canvas };
      this.retryAt = 0;
      this.onReady();
    } catch {
      // Keep the immediate image fallback usable if PDF detail is unavailable.
      this.retryAt = Date.now() + 3000;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (this.ready?.canvas !== canvas) canvas.width = canvas.height = 0;
      this.task = null;
      this.running = false;
      this.schedule();
    }
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.task?.cancel();
    if (this.ready) this.ready.canvas.width = this.ready.canvas.height = 0;
    this.ready = null;
    this.desired = null;
  }
}

function contains(outer: MagnifierCrop, inner: MagnifierCrop) {
  const epsilon = 1e-10;
  return inner.left >= outer.left - epsilon && inner.top >= outer.top - epsilon &&
    inner.left + inner.width <= outer.left + outer.width + epsilon &&
    inner.top + inner.height <= outer.top + outer.height + epsilon;
}

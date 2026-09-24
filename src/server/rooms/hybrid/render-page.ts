import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Renders one PDF page with its text layer suppressed, so room names and
 * annotations are not mistaken for walls. Returns RGBA pixels.
 */
export async function renderPdfPageWithoutText(
  pdf: Buffer | Uint8Array,
  pageNumber: number,
  longSide: number,
) {
  const loadingTask = getDocument({ data: new Uint8Array(pdf), useSystemFonts: true });
  const document = await loadingTask.promise;
  try {
    const page = await document.getPage(pageNumber);
    const raw = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: longSide / Math.max(raw.width, raw.height) });
    const width = Math.max(1, Math.round(viewport.width));
    const height = Math.max(1, Math.round(viewport.height));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    // pdf.js draws glyphs with fillText/strokeText; turning those into no-ops
    // leaves every vector path intact.
    const withoutText = new Proxy(context as unknown as Record<PropertyKey, unknown>, {
      get(target, property) {
        if (property === "fillText" || property === "strokeText") return () => undefined;
        const value = target[property];
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
      set(target, property, value) {
        target[property] = value;
        return true;
      },
    });
    try {
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: withoutText as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      const rgba = context.getImageData(0, 0, width, height).data;
      return { rgba: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), width, height };
    } finally {
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
}

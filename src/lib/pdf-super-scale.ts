"use client";
import { loadPdfJs, sourcePdfPage } from "./pdf-client";
import { segmentsFromOperators } from "./pdf-snap-lines";
import {
  identifyGrids,
  gridBubble,
  polygonGridBubbles,
  type GridBubble,
  type GridLabel,
} from "./super-scale";
import type { PDFDocumentLoadingTask } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Independent, bounded reader: scanning must not evict the visible viewer's PDF. */
export function createGridReader() {
  let task: PDFDocumentLoadingTask | null = null;
  let url = "";
  let closed = false;
  return {
    async read(imageUrl: string) {
      if (closed) throw new Error("Scan stopped");
      const source = sourcePdfPage(imageUrl);
      if (!source) throw new Error("No vector PDF available");
      const pdfjs = await loadPdfJs();
      if (closed) throw new Error("Scan stopped");
      if (url !== source.url || !task) {
        await task?.destroy();
        if (closed) throw new Error("Scan stopped");
        url = source.url;
        task = pdfjs.getDocument({
          url,
          withCredentials: true,
          disableStream: true,
          disableAutoFetch: true,
          rangeChunkSize: 256 * 1024,
          wasmUrl: "/api/pdfjs-assets/wasm/",
          standardFontDataUrl: "/api/pdfjs-assets/standard_fonts/",
        });
      }
      const doc = await task.promise;
      const page = await doc.getPage(source.page);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const [content, operators] = await Promise.all([
          page.getTextContent(),
          page.getOperatorList({
            annotationMode: pdfjs.AnnotationMode.DISABLE,
          }),
        ]);
        const toSheet = (x: number, y: number) => {
          const [px, py] = viewport.convertToViewportPoint(x, y) as [
            number,
            number,
          ];
          return { x: px / viewport.width, y: py / viewport.height };
        };
        const bubbles: GridBubble[] = [];
        const lines = segmentsFromOperators(
          operators.fnArray,
          operators.argsArray,
          toSheet,
          (points) => {
            const bubble = gridBubble(points, viewport.height / viewport.width);
            if (bubble) bubbles.push(bubble);
          },
        );
        if (lines.length >= 100000 || content.items.length > 50000)
          throw new Error("Drawing too complex for automatic grid matching");
        const labels: GridLabel[] = [];
        for (const item of content.items) {
          if (!("str" in item)) continue;
          const [x, y] = viewport.convertToViewportPoint(
            Number(item.transform[4]),
            Number(item.transform[5]),
          ) as [number, number];
          labels.push({
            text: item.str,
            x: (x + item.width / 2) / viewport.width,
            y: (y - item.height / 2) / viewport.height,
          });
        }
        bubbles.push(
          ...polygonGridBubbles(
            lines,
            labels,
            viewport.height / viewport.width,
          ),
        );
        return identifyGrids(
          lines,
          labels,
          viewport.height / viewport.width,
          bubbles,
        );
      } finally {
        page.cleanup();
      }
    },
    async close() {
      closed = true;
      const current = task;
      task = null;
      await current?.destroy().catch(() => undefined);
    },
  };
}

import { readFile, stat, writeFile, rename } from "node:fs/promises";
import {
  getDocument,
  type PDFDocumentLoadingTask,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { SERVER_PDF_RENDER_OPTIONS } from "../rooms/pdf-render-options";
import { drawingPdfLocation } from "../drawings/equipment-index";
import {
  MAX_PDF_LINE_SEGMENTS,
  segmentsFromOperators,
} from "~/lib/pdf-line-geometry";
import {
  gridBubble,
  polygonGridBubbles,
  identifyGrids,
  type GridBubble,
  type GridRead,
} from "~/lib/super-scale";

// Bump when detection rules change. PDF uploads are immutable; stat also protects replacements.
export const GRID_CACHE_VERSION = 1;
export function gridCacheKey(size: number, mtime: number, page: number) {
  return `grids-v${GRID_CACHE_VERSION}-${size}-${mtime}-${page}.json`;
}
export function createServerGridReader(jobId: string) {
  let task: PDFDocumentLoadingTask | null = null,
    current = "";
  return {
    async read(imageUrl: string): Promise<GridRead> {
      const location = drawingPdfLocation(imageUrl, jobId);
      if (!location) throw Error("No supported vector PDF available");
      const info = await stat(location.file);
      if (info.size > 512 * 1024 * 1024)
        throw Error("PDF exceeds grid-analysis size limit");
      const cache = `${location.file}.${gridCacheKey(info.size, info.mtimeMs, location.page)}`;
      try {
        const value = JSON.parse(await readFile(cache, "utf8")) as GridRead;
        if (
          Array.isArray(value.grids) &&
          value.aspect > 0 &&
          Array.isArray(value.ambiguous)
        )
          return value;
      } catch {
        /* Cold or invalid cache. */
      }
      if (current !== location.file || !task) {
        await task?.destroy();
        task = getDocument({
          ...SERVER_PDF_RENDER_OPTIONS,
          data: new Uint8Array(await readFile(location.file)),
          verbosity: 0,
        });
        current = location.file;
      }
      const doc = await task.promise,
        page = await doc.getPage(location.page);
      try {
        const viewport = page.getViewport({ scale: 1 }),
          aspect = viewport.height / viewport.width;
        const [content, ops] = await Promise.all([
          page.getTextContent(),
          page.getOperatorList({ annotationMode: 0 }),
        ]);
        const bubbles: GridBubble[] = [];
        const lines = segmentsFromOperators(
          ops.fnArray,
          ops.argsArray,
          (x, y) => {
            const p = viewport.convertToViewportPoint(x, y);
            return { x: p[0]! / viewport.width, y: p[1]! / viewport.height };
          },
          (points) => {
            const b = gridBubble(points, aspect);
            if (b) bubbles.push(b);
          },
        );
        if (
          lines.length >= MAX_PDF_LINE_SEGMENTS ||
          content.items.length > 50000
        )
          throw Error("Drawing too complex for automatic grid matching");
        const labels = content.items.flatMap((item) => {
          if (!("str" in item)) return [];
          const p = viewport.convertToViewportPoint(
            Number(item.transform[4]),
            Number(item.transform[5]),
          );
          return [
            {
              text: item.str,
              x: (p[0]! + item.width / 2) / viewport.width,
              y: (p[1]! - item.height / 2) / viewport.height,
            },
          ];
        });
        bubbles.push(...polygonGridBubbles(lines, labels, aspect));
        const result = identifyGrids(lines, labels, aspect, bubbles);
        const tmp = `${cache}.${process.pid}.tmp`;
        await writeFile(tmp, JSON.stringify(result), { mode: 0o600 });
        await rename(tmp, cache);
        return result;
      } finally {
        page.cleanup();
      }
    },
    async close() {
      await task?.destroy();
      task = null;
    },
  };
}

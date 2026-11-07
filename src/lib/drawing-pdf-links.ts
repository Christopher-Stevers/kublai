"use client";

import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { loadPdfDocument, sourcePdfPage } from "./pdf-client";
import type { DrawingPdfLink } from "./drawing-text";

const links = new Map<string, Promise<DrawingPdfLink[]>>();
let generation = 0;
export function clearDrawingPdfLinks() {
  generation++;
  links.clear();
}

/** Imported PDF links may use ordinary web, email, and telephone addresses. */
export function drawingPdfLinkUrl(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:", "tel:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function drawingPdfLinkTarget<T extends { imageUrl: string }>(
  link: DrawingPdfLink,
  source: { url: string; page: number },
  sheets: T[],
) {
  return sheets.find((sheet) => {
    const page = sourcePdfPage(sheet.imageUrl);
    return page?.url === source.url && page.page === link.page;
  });
}

/** Keep original annotation bounds in the same rotated space as the sheet. */
export function readDrawingPdfLinks(
  source: { url: string; page: number },
  parsedDocument?: PDFDocumentProxy,
) {
  const key = `${source.url}:${source.page}`;
  const cached = links.get(key);
  if (cached) return cached;
  const currentGeneration = generation;
  const result = (async () => {
    const document = parsedDocument ?? (await loadPdfDocument(source.url));
    const page = await document.getPage(source.page);
    const viewport = page.getViewport({ scale: 1 });
    const annotations: unknown[] = await page.getAnnotations({
      intent: "display",
    });
    const found: DrawingPdfLink[] = [];
    for (const raw of annotations) {
      try {
        const annotation = raw as {
          subtype?: string;
          rect?: number[];
          url?: string;
          dest?: unknown;
        };
        if (
          annotation?.subtype !== "Link" ||
          annotation.rect?.length !== 4 ||
          !annotation.rect.every(Number.isFinite)
        )
          continue;
        const [x1, y1, x2, y2] = annotation.rect as [
          number,
          number,
          number,
          number,
        ];
        const corners = [
          [x1, y1],
          [x1, y2],
          [x2, y1],
          [x2, y2],
        ].map(([x, y]) => viewport.convertToViewportPoint(x!, y!) as number[]);
        const bounds = {
          left: Math.max(
            0,
            Math.min(...corners.map((p) => p[0]! / viewport.width)),
          ),
          top: Math.max(
            0,
            Math.min(...corners.map((p) => p[1]! / viewport.height)),
          ),
          right: Math.min(
            1,
            Math.max(...corners.map((p) => p[0]! / viewport.width)),
          ),
          bottom: Math.min(
            1,
            Math.max(...corners.map((p) => p[1]! / viewport.height)),
          ),
        };
        if (bounds.right <= bounds.left || bounds.bottom <= bounds.top)
          continue;
        if (annotation.url) {
          const url = drawingPdfLinkUrl(annotation.url);
          if (url) found.push({ ...bounds, url });
        } else {
          const destination: unknown =
            typeof annotation.dest === "string"
              ? await document.getDestination(annotation.dest)
              : annotation.dest;
          if (!Array.isArray(destination)) continue;
          const ref: unknown = destination[0];
          if (
            typeof ref !== "number" &&
            (!ref ||
              typeof ref !== "object" ||
              !("num" in ref) ||
              !("gen" in ref))
          )
            continue;
          const index =
            typeof ref === "number"
              ? ref
              : await document.getPageIndex(
                  ref as { num: number; gen: number },
                );
          if (
            Number.isInteger(index) &&
            index >= 0 &&
            index < document.numPages
          )
            found.push({ ...bounds, page: index + 1 });
        }
      } catch {
        // One damaged destination must not disable the remaining links.
      }
    }
    if (generation !== currentGeneration)
      throw new DOMException("The drawing account changed.", "AbortError");
    return found;
  })();
  links.set(key, result);
  while (links.size > 6) links.delete(links.keys().next().value!);
  void result.catch(() => {
    if (links.get(key) === result) links.delete(key);
  });
  return result;
}

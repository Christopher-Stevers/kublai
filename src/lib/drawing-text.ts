"use client";

import { loadPdfDocument } from "./pdf-client";
import {
  extractDrawingIdentity,
  pdfTitleBlockWord,
} from "./drawing-title-block";
import { clearDrawingPdfLinks, readDrawingPdfLinks } from "./drawing-pdf-links";

export type DrawingText = {
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export type DrawingPdfLink = Omit<DrawingText, "text"> & {
  url?: string;
  page?: number;
};
export type DrawingTextIndex = {
  words: DrawingText[];
  links: DrawingPdfLink[];
};
const indexes = new Map<string, Promise<DrawingTextIndex>>();
let generation = 0;
export function clearDrawingTextIndexes() {
  generation++;
  indexes.clear();
  clearDrawingPdfLinks();
}

/** Text and imported links use the PDF's rotated viewport, like the drawing canvas. */
export function readDrawingText(source: { url: string; page: number }) {
  const currentGeneration = generation;
  const key = `${source.url}:${source.page}`;
  const cached = indexes.get(key);
  if (cached) return cached;
  const result = (async () => {
    const document = await loadPdfDocument(source.url);
    const page = await document.getPage(source.page);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const words: DrawingText[] = content.items.flatMap((item) =>
      "str" in item && item.str.trim()
        ? [pdfTitleBlockWord(item, viewport)]
        : [],
    );
    const links = await readDrawingPdfLinks(source, document);
    if (generation !== currentGeneration)
      throw new DOMException("The drawing account changed.", "AbortError");
    return { words, links };
  })();
  indexes.set(key, result);
  while (indexes.size > 6) indexes.delete(indexes.keys().next().value!);
  void result.catch(() => {
    if (indexes.get(key) === result) indexes.delete(key);
  });
  return result;
}

export function findDrawingText(words: DrawingText[], query: string) {
  const text = query.trim().toLocaleLowerCase();
  return text
    ? words
        .filter((word) => word.text.toLocaleLowerCase().includes(text))
        .slice(0, 100)
    : [];
}

export function suggestSheetMetadata(words: DrawingText[]) {
  // The register already restricts words to the user's selected title-block region.
  return extractDrawingIdentity(words, { allowInterior: true });
}

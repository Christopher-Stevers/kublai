"use client";

import { loadPdfDocument } from "./pdf-client";

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
    const box = (points: number[][]) => {
      const rotated = points.map(
        (p) => viewport.convertToViewportPoint(p[0]!, p[1]!) as number[],
      );
      return {
        left: Math.max(
          0,
          Math.min(...rotated.map((p) => p[0]! / viewport.width)),
        ),
        top: Math.max(
          0,
          Math.min(...rotated.map((p) => p[1]! / viewport.height)),
        ),
        right: Math.min(
          1,
          Math.max(...rotated.map((p) => p[0]! / viewport.width)),
        ),
        bottom: Math.min(
          1,
          Math.max(...rotated.map((p) => p[1]! / viewport.height)),
        ),
      };
    };
    const content = await page.getTextContent();
    const words: DrawingText[] = content.items.flatMap((item) => {
      if (!("str" in item) || !item.str.trim()) return [];
      const [a = 1, b = 0, c = 0, d = 1, x = 0, y = 0] =
        item.transform as number[];
      const length = Math.hypot(a, b) || 1,
        height = Math.hypot(c, d) || 1;
      const dx = (a / length) * item.width,
        dy = (b / length) * item.width;
      const hx = (c / height) * item.height,
        hy = (d / height) * item.height;
      return [
        {
          text: item.str,
          ...box([
            [x, y],
            [x + dx, y + dy],
            [x + hx, y + hy],
            [x + dx + hx, y + dy + hy],
          ]),
        },
      ];
    });
    const annotations: unknown[] = await page.getAnnotations({
      intent: "display",
    });
    const links: DrawingPdfLink[] = [];
    for (const raw of annotations.slice(0, 1000)) {
      const annotation = raw as {
        subtype?: string;
        rect?: number[];
        url?: string;
        dest?: unknown;
      };
      if (annotation.subtype !== "Link" || annotation.rect?.length !== 4)
        continue;
      const [x1, y1, x2, y2] = annotation.rect;
      if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
      const bounds = box([
        [x1!, y1!],
        [x2!, y2!],
      ]);
      if (annotation.url) {
        try {
          const url = new URL(annotation.url);
          if (url.protocol === "https:" && !url.username && !url.password)
            links.push({ ...bounds, url: url.href });
        } catch {}
      } else {
        const destination: unknown =
          typeof annotation.dest === "string"
            ? await document.getDestination(annotation.dest)
            : annotation.dest;
        if (!Array.isArray(destination)) continue;
        const ref: unknown = destination[0];
        try {
          const index =
            typeof ref === "number"
              ? ref
              : await document.getPageIndex(
                  ref as { num: number; gen: number },
                );
          if (index >= 0 && index < document.numPages)
            links.push({ ...bounds, page: index + 1 });
        } catch {
          /* A damaged PDF link must not disable text search. */
        }
      }
    }
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
  const block = words.filter((word) => word.left > 0.55 && word.top > 0.6);
  const number =
    block
      .map(
        (word) =>
          /\b[A-Z]{1,3}[-.]?\d{2,4}(?:\.\d{1,3})?[A-Z]?\b/i.exec(
            word.text,
          )?.[0],
      )
      .find(Boolean) ?? "";
  const title =
    block.find((word) =>
      /floor plan|elevation|section|detail|site plan|schedule/i.test(word.text),
    )?.text ?? "";
  const discipline =
    (
      {
        A: "Architectural",
        S: "Structural",
        M: "Mechanical",
        E: "Electrical",
        P: "Plumbing",
        C: "Civil",
        L: "Landscape",
      } as Record<string, string>
    )[number[0]?.toUpperCase() ?? ""] ?? "";
  return { number, title: title.slice(0, 255), discipline };
}

"use client";

import { loadPdfDocument } from "./pdf-client";
import {
  scaleFromSheetText,
  type ScaleRead,
  type ScaleTextItem,
} from "./sheet-scale-text";

/**
 * The scale printed on one PDF page.
 * The page width is the viewport width at scale 1, which is already in points.
 */
export async function readPdfSheetScale(source: {
  url: string;
  page: number;
}): Promise<ScaleRead> {
  const doc = await loadPdfDocument(source.url);
  const page = await doc.getPage(source.page);
  const viewport = page.getViewport({ scale: 1 });
  const width = viewport.width || 0;
  const height = viewport.height || 1;
  const content = await page.getTextContent();
  const items: ScaleTextItem[] = [];
  for (const item of content.items) {
    if (
      !("str" in item) ||
      typeof item.str !== "string" ||
      item.str.length === 0
    )
      continue;
    const transform = item.transform as unknown as number[];
    const converted = viewport.convertToViewportPoint(
      Number(transform[4] ?? 0),
      Number(transform[5] ?? 0),
    ) as [number, number];
    const run: ScaleTextItem = {
      str: item.str,
      x: converted[0] / (width || 1),
      y: converted[1] / height,
    };
    if (width > 0 && typeof item.width === "number" && item.width > 0)
      run.w = item.width / width;
    items.push(run);
  }
  return scaleFromSheetText(items, width);
}

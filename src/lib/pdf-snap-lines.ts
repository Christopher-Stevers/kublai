"use client";
import { loadPdfDocument, loadPdfJs } from "./pdf-client";
import { SNAP_OPS, segmentsFromOperators } from "./pdf-line-geometry";
export {
  MAX_PDF_LINE_SEGMENTS,
  SNAP_OPS,
  segmentsFromOperators,
} from "./pdf-line-geometry";

/** Straight lines on one PDF page, normalized the same way as the sheet image. */
export async function loadSnapLines(source: { url: string; page: number }) {
  const pdfjs = await loadPdfJs();
  if (
    pdfjs.OPS.constructPath !== SNAP_OPS.constructPath ||
    pdfjs.OPS.lineTo !== SNAP_OPS.lineTo
  ) {
    throw new Error(
      "This PDF viewer uses operator numbers the snap tool does not know.",
    );
  }
  const doc = await loadPdfDocument(source.url);
  const page = await doc.getPage(source.page);
  const viewport = page.getViewport({ scale: 1 });
  const width = viewport.width || 1;
  const height = viewport.height || 1;
  const opList = await page.getOperatorList();
  return segmentsFromOperators(opList.fnArray, opList.argsArray, (x, y) => {
    const converted = viewport.convertToViewportPoint(x, y) as [number, number];
    return { x: converted[0] / width, y: converted[1] / height };
  });
}

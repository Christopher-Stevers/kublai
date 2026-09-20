// Shared by the browser, request process and isolated PDF renderer.
export const MAX_DRAWING_PAGES = 100;
export const DRAWING_WORKER_SECONDS = 600;
export const DRAWING_POLL_MS = (DRAWING_WORKER_SECONDS + 60) * 1000;
export function validateDrawingPageCount(pages: number) {
  if (!Number.isSafeInteger(pages) || pages < 1)
    throw new Error("PDF has no valid pages");
  if (pages > MAX_DRAWING_PAGES)
    throw new Error(
      `PDF has more than ${MAX_DRAWING_PAGES} pages. Split it into smaller PDFs; no sheets were added.`,
    );
}

import type { PDFPageProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PdfOperationBounds } from "./drawing-pdf-operations";

// Page lifetime is also the identity/cache boundary: never persist these across
// file changes, accounts, PDF.js versions, or different page proxies.
const completed = new WeakMap<object, PdfOperationBounds>();
export const completedPdfBounds = (page: object) => completed.get(page);
export function rememberPdfBounds(page: PDFPageProxy) {
  if (page.recordedBBoxes)
    completed.set(page, page.recordedBBoxes as PdfOperationBounds);
}
type Listener = { ready: () => void; eligible: () => boolean };
type Job = { listeners: Set<Listener>; stop: () => void };
const jobs = new WeakMap<PDFPageProxy, Job>();
const attempted = new WeakSet<PDFPageProxy>();

/** Prepare only AFTER first visible detail. A tiny full-page recording unlocks
 * safe offscreen filtering for deep-link opens too. Work pauses during gestures,
 * is shared across layers, bounded in pixels/time, and never publishes failures.
 */
export function preparePdfBounds(
  page: PDFPageProxy,
  ready: () => void,
  eligible: () => boolean,
) {
  if (completed.has(page)) return () => undefined;
  const listener = { ready, eligible };
  const existing = jobs.get(page);
  if (existing) {
    existing.listeners.add(listener);
    return () => {
      existing.listeners.delete(listener);
      if (!existing.listeners.size) existing.stop();
    };
  }
  if (attempted.has(page)) return () => undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let task: RenderTask | undefined;
  let canvas: HTMLCanvasElement | undefined;
  const listeners = new Set([listener]);
  const stop = () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    if (watchdog !== undefined) clearTimeout(watchdog);
    task?.cancel();
    if (jobs.get(page) === job) jobs.delete(page);
    // The render promise releases its backing store once cancellation settles.
    if (!task && canvas) canvas.width = canvas.height = 0;
  };
  const job = { listeners, stop };
  jobs.set(page, job);
  const canRun = () =>
    document.visibilityState !== "hidden" &&
    [...listeners].some((item) => item.eligible());
  const start = () => {
    if (stopped) return;
    if (completed.has(page)) {
      stop();
      return;
    }
    if (!canRun()) {
      timer = setTimeout(start, 250);
      return;
    }
    attempted.add(page);
    try {
      canvas = document.createElement("canvas");
      const raw = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: Math.min(1, 768 / Math.max(raw.width, raw.height)),
      });
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      page.recordedBBoxes = null;
      task = page.render({ canvas, viewport, recordOperations: true });
      const resume = (next: () => void) => {
        if (stopped) return;
        if (canRun()) next();
        else timer = setTimeout(() => resume(next), 100);
      };
      task.onContinue = resume;
      watchdog = setTimeout(() => task?.cancel(), 5000);
      void task.promise
        .then(() => {
          if (!stopped) {
            rememberPdfBounds(page);
            if (completed.has(page)) for (const item of listeners) item.ready();
          }
        })
        .catch(() => undefined)
        .finally(() => {
          task = undefined;
          stop();
          if (canvas) canvas.width = canvas.height = 0;
        });
    } catch {
      task = undefined;
      stop();
      if (canvas) canvas.width = canvas.height = 0;
    }
  };
  timer = setTimeout(start, 200);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) stop();
  };
}

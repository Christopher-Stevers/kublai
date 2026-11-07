"use client";
import type {
  DrawingPdfExportOptions,
  DrawingPdfPackageOptions,
} from "./drawing-pdf-build";
import type {
  DrawingExportRequest,
  DrawingExportResponse,
  PreparedDrawingExport,
} from "./drawing-pdf-export-protocol";
import { registerDrawingWorker } from "./drawing-geometry-client";

type ExportJob =
  | { kind: "sheet"; options: DrawingPdfExportOptions }
  | { kind: "package"; options: DrawingPdfPackageOptions };
export async function buildDrawingExportInBackground(
  job: ExportJob,
  fallback: () => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const signal = job.options.signal;
  signal?.throwIfAborted();
  const sheets = job.kind === "sheet" ? [job.options] : job.options.sheets;
  // Preserve the browser font/canvas fallback for international notes. All
  // other drawing vectors, embedded PDF fonts, crop/rotation, and links use the
  // same builder in the worker, without changing rendering or export formats.
  if (
    typeof Worker === "undefined" ||
    sheets.some((sheet) =>
      sheet.markups?.some((markup) => /[^\x20-\x7e]/.test(markup.text ?? "")),
    )
  )
    return fallback();
  if (job.kind === "package" && (!sheets.length || sheets.length > 100))
    throw new Error("Select between 1 and 100 sheets for a PDF package.");
  let worker: Worker;
  try {
    worker = new Worker(
      new URL("./drawing-pdf-export.worker.ts", import.meta.url),
      { type: "module", name: "drawing-pdf-export" },
    );
  } catch {
    return fallback();
  }
  let closed = false;
  let rejectPending: ((error: Error) => void) | undefined;
  const dispose = () => {
    if (closed) return;
    closed = true;
    worker.terminate();
    rejectPending?.(
      new DOMException("The drawing export was cancelled.", "AbortError"),
    );
  };
  const failure: { error?: Error } = {};
  worker.onerror = () => {
    failure.error = new Error("The drawing export worker stopped. Try again.");
    rejectPending?.(failure.error);
  };
  worker.onmessageerror = () => {
    failure.error = new Error("The drawing export result could not be read.");
    rejectPending?.(failure.error);
  };
  const unregister = registerDrawingWorker({ dispose });
  signal?.addEventListener("abort", dispose, { once: true });
  try {
    const sources = new Map<string, Promise<string>>();
    const prepare = async (
      sheet: DrawingPdfExportOptions,
    ): Promise<PreparedDrawingExport> => {
      signal?.throwIfAborted();
      const { resolveSource: sheetResolver, markupLinkUrl } = sheet;
      const options = {
        pdfUrl: sheet.pdfUrl,
        pageNumber: sheet.pageNumber,
        markups: sheet.markups,
        sourceSheetId: sheet.sourceSheetId,
        sharedScale: sheet.sharedScale,
        title: sheet.title,
      };
      const resolver =
        job.kind === "sheet" ? sheetResolver : job.options.resolveSource;
      let source = sources.get(sheet.pdfUrl);
      if (!source) {
        source = resolver
          ? resolver(sheet.pdfUrl)
          : Promise.resolve(sheet.pdfUrl);
        sources.set(sheet.pdfUrl, source);
      }
      const pdfUrl = await source;
      if (closed)
        throw new DOMException(
          "The drawing export was cancelled.",
          "AbortError",
        );
      return {
        ...options,
        pdfUrl,
        linkUrls:
          options.markups?.map((markup) => markupLinkUrl?.(markup) ?? null) ??
          [],
      };
    };
    let request: DrawingExportRequest;
    if (job.kind === "sheet")
      request = { kind: "sheet", options: await prepare(job.options) };
    else {
      const prepared: PreparedDrawingExport[] = [];
      for (const sheet of job.options.sheets)
        prepared.push(await prepare(sheet));
      request = {
        kind: "package",
        options: { title: job.options.title, sheets: prepared },
      };
    }
    if (closed)
      throw new DOMException("The drawing export was cancelled.", "AbortError");
    if (failure.error) throw failure.error;
    return await new Promise<Uint8Array>((resolve, reject) => {
      rejectPending = reject;
      worker.onmessage = ({ data }: MessageEvent<DrawingExportResponse>) => {
        if (closed) return;
        if (data.ok) resolve(data.bytes);
        else reject(new Error(data.error));
      };
      worker.postMessage(request);
    });
  } finally {
    rejectPending = undefined;
    signal?.removeEventListener("abort", dispose);
    dispose();
    unregister();
  }
}

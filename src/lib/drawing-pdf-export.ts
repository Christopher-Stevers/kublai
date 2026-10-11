import type { DrawingPdfExportOptions, DrawingPdfPackageOptions } from "./drawing-pdf-build";
import { pdfBytes } from "./drawing-pdf-bytes";
import { buildDrawingExportInBackground } from "./drawing-pdf-export-client";
export { MAX_DRAWING_PACKAGE_BYTES } from "./drawing-pdf-bytes";
export type { DrawingPdfExportOptions, DrawingPdfPackageOptions } from "./drawing-pdf-build";

// Loading export controls/original downloads does not parse pdf-lib on the UI
// thread. The full builder loads here only for callers or the font fallback.
export async function buildDrawingPdf(options: DrawingPdfExportOptions) {
  return (await import("./drawing-pdf-build")).buildDrawingPdf(options);
}
export async function buildDrawingPackage(options: DrawingPdfPackageOptions) {
  return (await import("./drawing-pdf-build")).buildDrawingPackage(options);
}

export function pdfBlob(bytes: Uint8Array) {
  return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
}
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/[\\/:*?"<>|]/g, "_");
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export async function downloadOriginalDrawing(
  pdfUrl: string,
  filename = "drawings.pdf",
  options: Pick<DrawingPdfExportOptions, "signal" | "resolveSource"> = {},
) {
  download(
    pdfBlob(await pdfBytes(pdfUrl, options.signal, options.resolveSource)),
    filename,
  );
}
export async function downloadDrawingPdf(
  options: DrawingPdfExportOptions,
  filename = "drawing.pdf",
) {
  download(pdfBlob(await buildDrawingExportInBackground({ kind: "sheet", options }, () => buildDrawingPdf(options))), filename);
}
export async function downloadDrawingPackage(
  options: DrawingPdfPackageOptions,
  filename = "drawing-package.pdf",
) {
  download(pdfBlob(await buildDrawingExportInBackground({ kind: "package", options }, () => buildDrawingPackage(options))), filename);
}
/** Invoke directly from a click, before awaiting anything, to retain popup permission. */
export async function printDrawingPdf(
  options: DrawingPdfExportOptions,
  preparedWindow?: Window,
) {
  return printPdf(() => buildDrawingExportInBackground({ kind: "sheet", options }, () => buildDrawingPdf(options)), preparedWindow);
}
export async function printDrawingPackage(
  options: DrawingPdfPackageOptions,
  preparedWindow?: Window,
) {
  return printPdf(() => buildDrawingExportInBackground({ kind: "package", options }, () => buildDrawingPackage(options)), preparedWindow);
}
async function printPdf(
  build: () => Promise<Uint8Array>,
  preparedWindow?: Window,
) {
  const popup = preparedWindow ?? window.open("", "_blank");
  if (!popup)
    throw new Error("Allow this app to open the drawing's print window.");
  popup.opener = null;
  popup.document.title = "Preparing drawing";
  popup.document.body.textContent = "Preparing drawing for printing…";
  try {
    const url = URL.createObjectURL(pdfBlob(await build()));
    if (popup.closed) {
      URL.revokeObjectURL(url);
      return;
    }
    popup.addEventListener(
      "load",
      () => {
        try {
          popup.focus();
          popup.print();
        } catch {
          /* The PDF viewer's Print action remains available. */
        }
      },
      { once: true },
    );
    popup.location.replace(url);
    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer);
        URL.revokeObjectURL(url);
      }
    }, 1000);
    setTimeout(() => {
      clearInterval(timer);
      URL.revokeObjectURL(url);
    }, 30 * 60_000);
  } catch (error) {
    popup.close();
    throw error;
  }
}

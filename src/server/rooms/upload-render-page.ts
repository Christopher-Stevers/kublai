import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";
import { validateDrawingPageCount } from "~/lib/drawing-upload-limits";
import { extractSheetName } from "~/server/rooms/sheet-name";
import { pdfTitleBlockWord } from "~/lib/drawing-title-block";
import { readUploadTitleBlock } from "~/server/drawings/upload-title-block";
import { SERVER_PDF_RENDER_OPTIONS } from "./pdf-render-options";

async function load(dest: string) {
  const bytes = await readFile(path.join(dest, "plan.pdf"));
  const loadingTask = getDocument({
    ...SERVER_PDF_RENDER_OPTIONS,
    // Exports with removed layers make PDF.js warn thousands of times per page
    // ("Optional content group not found"); only real errors are useful here.
    verbosity: VerbosityLevel.ERRORS,
    // Use the existing buffer: copying a 500 MB PDF doubles its memory cost.
    data: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    maxImageSize: 16_000_000,
    canvasMaxAreaInBytes: 20_000_000,
  });
  const document = await loadingTask.promise;
  validateDrawingPageCount(document.numPages);
  return { document, loadingTask };
}

async function main() {
  const [mode, dest, jobId, uploadId, pageText, metadataMode] =
    process.argv.slice(2);
  if (!dest) throw new Error("PDF renderer destination required");
  const { document, loadingTask } = await load(dest);
  try {
    if (mode === "inspect") {
      process.stdout.write(JSON.stringify({ pages: document.numPages }));
      return;
    }
    const pageNumber = Number(pageText);
    if (
      mode !== "page" ||
      !jobId ||
      !uploadId ||
      !Number.isSafeInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > document.numPages
    )
      throw new Error("Invalid PDF page renderer arguments");

    sharp.cache(false);
    sharp.concurrency(1);
    const page = await document.getPage(pageNumber);
    const raw = page.getViewport({ scale: 1 });
    if (![raw.width, raw.height].every((n) => Number.isFinite(n) && n > 0))
      throw new Error("Invalid PDF page dimensions");
    const viewport = page.getViewport({
      scale: Math.min(2, 2200 / Math.max(raw.width, raw.height)),
    });
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    const canvas = createCanvas(width, height);
    try {
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: canvas.getContext(
          "2d",
        ) as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      const webp = await sharp(canvas.toBuffer("image/png"))
        .webp({ quality: 82 })
        .toBuffer();
      await writeFile(path.join(dest, `floor-${pageNumber}.webp`), webp);
      const text = await page.getTextContent();
      const words = text.items.flatMap((item) =>
        "str" in item && item.str.trim() ? [pdfTitleBlockWord(item, raw)] : [],
      );
      const metadata =
        metadataMode === "metadata"
          ? await readUploadTitleBlock(page, words)
          : undefined;
      const labels = words.map((word) => ({
        str: word.text,
        x: word.left,
        y: word.bottom,
      }));
      process.stdout.write(
        JSON.stringify({
          name: metadata
            ? metadata.number || `Sheet ${pageNumber}`
            : extractSheetName(labels, `Sheet ${pageNumber}`),
          ...(metadata ? { metadata } : {}),
          width,
          height,
          imageUrl: `/api/job-rooms/files/${jobId}/${uploadId}/floor-${pageNumber}.webp`,
        }),
      );
    } finally {
      canvas.width = 1;
      canvas.height = 1;
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

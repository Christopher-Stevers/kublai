/** Short-lived process: native PDF/canvas allocations never accumulate in Next.js. */
import { readFile, writeFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";
import { SERVER_PDF_RENDER_OPTIONS } from "../rooms/pdf-render-options";

async function main() {
  const [source, target, pageText] = process.argv.slice(2);
  const number = Number(pageText);
  if (!source || !target || !Number.isSafeInteger(number) || number < 1)
    throw new Error("Invalid document preview arguments");
  sharp.cache(false);
  sharp.concurrency(1);
  const bytes = await readFile(source);
  const task = getDocument({
    ...SERVER_PDF_RENDER_OPTIONS,
    verbosity: VerbosityLevel.ERRORS,
    data: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    canvasMaxAreaInBytes: 20_000_000,
  });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(number);
    const raw = page.getViewport({ scale: 1 });
    if (![raw.width, raw.height].every((n) => Number.isFinite(n) && n > 0))
      throw new Error("Invalid page size");
    const viewport = page.getViewport({
      scale: Math.min(2, 1400 / Math.max(raw.width, raw.height)),
    });
    const canvas = createCanvas(
      Math.max(1, Math.ceil(viewport.width)),
      Math.max(1, Math.ceil(viewport.height)),
    );
    try {
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        viewport,
      }).promise;
      const image = await sharp(canvas.toBuffer("image/png"))
        .webp({ quality: 82 })
        .toBuffer();
      await writeFile(target, image, { mode: 0o600, flag: "wx" });
    } finally {
      canvas.width = canvas.height = 1;
    }
  } finally {
    await task.destroy();
  }
}
main().catch(() => {
  process.exitCode = 1;
});

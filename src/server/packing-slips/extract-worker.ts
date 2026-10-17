/** Bounded, short-lived process; document bytes and OCR output never go into logs. */
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";
import {
  getDocument,
  VerbosityLevel,
  Util,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { SERVER_PDF_RENDER_OPTIONS } from "../rooms/pdf-render-options";
import { tsvWords, wordRows, type SlipRow, type SlipWord } from "./ocr-rows";
async function main() {
  const [source, target, mime] = process.argv.slice(2);
  if (!source || !target) throw Error();
  sharp.cache(false);
  sharp.concurrency(1);
  const bytes = await readFile(source);
  if (bytes.length > 50 * 1024 * 1024) throw Error();
  const rows: SlipRow[] = [],
    warnings: string[] = [];
  const ocr = async (png: Buffer, page: number) => {
    const image = await sharp(png, { limitInputPixels: 24_000_000 })
      .rotate()
      .resize({
        width: 2400,
        height: 3200,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "white" })
      .png()
      .toBuffer({ resolveWithObject: true });
    const tsv = execFileSync(
      "tesseract",
      ["stdin", "stdout", "-l", "eng", "--psm", "6", "tsv"],
      {
        input: image.data,
        encoding: "utf8",
        timeout: 25000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, OMP_THREAD_LIMIT: "1" },
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    rows.push(
      ...wordRows(tsvWords(tsv, image.info.width, image.info.height), page),
    );
  };
  if (mime === "application/pdf") {
    const task = getDocument({
      ...SERVER_PDF_RENDER_OPTIONS,
      verbosity: VerbosityLevel.ERRORS,
      data: new Uint8Array(bytes),
      canvasMaxAreaInBytes: 32_000_000,
    });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 20)
        warnings.push(
          "Only the first 20 pages were read. Review remaining pages manually.",
        );
      for (let n = 1; n <= Math.min(pdf.numPages, 20); n++) {
        try {
          const page = await pdf.getPage(n),
            raw = page.getViewport({ scale: 1 });
          const text = await page.getTextContent(),
            words: SlipWord[] = [];
          for (const item of text.items) {
            if (!("str" in item) || !item.str.trim()) continue;
            const m = Util.transform(raw.transform, item.transform);
            words.push({
              text: item.str,
              x: m[4]! / raw.width,
              y: (m[5]! - item.height) / raw.height,
              width: item.width / raw.width,
              height: Math.max(1, item.height) / raw.height,
              confidence: 100,
            });
          }
          if (words.reduce((s, w) => s + w.text.length, 0) > 80) {
            rows.push(...wordRows(words, n));
            continue;
          }
          const view = page.getViewport({
            scale: Math.min(3.5, 3000 / Math.max(raw.width, raw.height)),
          });
          const canvas = createCanvas(
            Math.ceil(view.width),
            Math.ceil(view.height),
          );
          try {
            await page.render({
              canvas: canvas as unknown as HTMLCanvasElement,
              viewport: view,
            }).promise;
            await ocr(canvas.toBuffer("image/png"), n);
          } finally {
            canvas.width = canvas.height = 1;
          }
        } catch {
          warnings.push(`Page ${n} could not be read. Review it manually.`);
        }
      }
    } finally {
      await task.destroy();
    }
  } else await ocr(bytes, 1);
  if (rows.length > 500)
    warnings.push(
      "This slip has more than 500 text rows; review omitted rows manually.",
    );
  await writeFile(
    target,
    JSON.stringify({ rows: rows.slice(0, 500), warnings }),
    { mode: 0o600 },
  );
}
main().catch(() => {
  process.exitCode = 1;
});

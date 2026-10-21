/** Isolated process: never logs customer source text. No remote document URLs. */
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createCanvas } from "@napi-rs/canvas";
import { unzipSync, strFromU8 } from "fflate";
import {
  getDocument,
  VerbosityLevel,
  Util,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { SERVER_PDF_RENDER_OPTIONS } from "../rooms/pdf-render-options";
import { wordRows, type SlipWord } from "../packing-slips/ocr-rows";
async function main() {
  const [source, target, mime, name] = process.argv.slice(2);
  if (!source || !target) throw Error();
  const bytes = await readFile(source);
  if (bytes.length > 50 * 1024 * 1024) throw Error();
  const pages: { page: number | null; text: string }[] = [],
    warnings: string[] = [];
  let chars = 0;
  const push = (page: number | null, text: string) => {
    if (chars >= 2_500_000) return;
    const capped = text.slice(0, Math.min(100000, 2_500_000 - chars));
    if (capped.length < text.length)
      warnings.push(
        `Page ${page ?? "text"} was truncated; review the remainder manually.`,
      );
    chars += capped.length;
    pages.push({ page, text: capped });
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
      let ocrPages = 0;
      if (pdf.numPages > 300)
        warnings.push(
          `Only the first 300 of ${pdf.numPages} pages were read. Split this specification into smaller PDFs.`,
        );
      for (let n = 1; n <= Math.min(pdf.numPages, 300); n++) {
        if (chars >= 2_500_000) {
          warnings.push(
            `Text limit reached at page ${n}; later pages were not read.`,
          );
          break;
        }
        try {
          const page = await pdf.getPage(n),
            view = page.getViewport({ scale: 1 }),
            content = await page.getTextContent(),
            words: SlipWord[] = [];
          for (const item of content.items) {
            if (!("str" in item) || !item.str.trim()) continue;
            const m = Util.transform(view.transform, item.transform);
            words.push({
              text: item.str,
              x: m[4]! / view.width,
              y: (m[5]! - item.height) / view.height,
              width: item.width / view.width,
              height: Math.max(1, item.height) / view.height,
              confidence: 100,
            });
          }
          if (words.reduce((sum, w) => sum + w.text.length, 0) > 80)
            push(
              n,
              wordRows(words, n)
                .map((r) => r.text)
                .join("\n"),
            );
          else if (ocrPages++ < 12) {
            const scaled = page.getViewport({
              scale: Math.min(3, 2600 / Math.max(view.width, view.height)),
            });
            const canvas = createCanvas(
              Math.ceil(scaled.width),
              Math.ceil(scaled.height),
            );
            try {
              await page.render({
                canvas: canvas as unknown as HTMLCanvasElement,
                viewport: scaled,
              }).promise;
              const text = execFileSync(
                "tesseract",
                ["stdin", "stdout", "-l", "eng", "--psm", "3"],
                {
                  input: canvas.toBuffer("image/png"),
                  encoding: "utf8",
                  timeout: 15000,
                  maxBuffer: 1024 * 1024,
                  stdio: ["pipe", "pipe", "ignore"],
                  env: { ...process.env, OMP_THREAD_LIMIT: "1" },
                },
              );
              push(n, text);
              warnings.push(
                `Page ${n} used OCR; check quoted evidence against the scan.`,
              );
            } finally {
              canvas.width = canvas.height = 1;
            }
          } else
            warnings.push(
              `Scanned page ${n} was not read after the 12-page OCR limit. Upload searchable PDFs.`,
            );
          page.cleanup();
        } catch {
          warnings.push(`Page ${n} could not be read. Review it manually.`);
        }
      }
    } finally {
      await task.destroy();
    }
  } else if (
    mime?.includes("wordprocessingml") ||
    /\.docx$/i.test(name ?? "")
  ) {
    // fflate's entry filter rejects zip bombs before decompression.
    const files = unzipSync(bytes, {
      filter: (f) =>
        f.name === "word/document.xml" && f.originalSize <= 4 * 1024 * 1024,
    });
    const xml = files["word/document.xml"];
    if (!xml) throw Error();
    push(
      null,
      strFromU8(xml)
        .replace(/<\/w:p>/g, "\n")
        .replace(/<w:tab\b[^>]*\/>/g, " ")
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&"),
    );
    warnings.push(
      "Word documents have section citations; page numbers require uploading the PDF version.",
    );
  } else if (mime?.startsWith("text/") || /\.(txt|md)$/i.test(name ?? ""))
    push(null, bytes.toString("utf8"));
  else throw Error();
  await writeFile(target, JSON.stringify({ pages, warnings }), { mode: 0o600 });
}
main().catch(() => {
  process.exitCode = 1;
});

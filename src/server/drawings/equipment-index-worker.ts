import { readFile, stat, writeFile, rename } from "node:fs/promises";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import { unzipSync, strFromU8 } from "fflate";
import { SERVER_PDF_RENDER_OPTIONS } from "../rooms/pdf-render-options";
import {
  pdfTitleBlockWord,
  type TitleBlockWord,
} from "~/lib/drawing-title-block";
import { createCanvas } from "@napi-rs/canvas";
import { execFileSync } from "node:child_process";
import { drawingOcrWords } from "./ocr";
const [file, output, format, ocrPage] = process.argv.slice(2);
if (!file || !output || !["pdf", "office"].includes(format ?? ""))
  throw Error("Invalid index arguments");
if ((await stat(file)).size > 160 * 1024 * 1024)
  throw Error("File exceeds text-index size limit");
const bytes = await readFile(file);
const pages: Array<{ page: number; words: TitleBlockWord[] }> = [];
let incomplete = false;
if (format === "pdf") {
  const task = getDocument({
    ...SERVER_PDF_RENDER_OPTIONS,
    verbosity: VerbosityLevel.ERRORS,
    data: new Uint8Array(bytes),
  });
  try {
    const doc = await task.promise;
    const requested = Number(ocrPage);
    if (
      ocrPage &&
      (!Number.isInteger(requested) ||
        requested < 1 ||
        requested > doc.numPages)
    )
      throw Error("Invalid page");
    for (
      let n = ocrPage ? requested : 1;
      n <= (ocrPage ? requested : Math.min(doc.numPages, 2000));
      n++
    ) {
      const page = await doc.getPage(n),
        viewport = page.getViewport({ scale: 1 }),
        content = await page.getTextContent();
      let words = content.items.flatMap((item) =>
        "str" in item && item.str.trim()
          ? [pdfTitleBlockWord(item, viewport)]
          : [],
      );
      if (ocrPage) {
        const view = page.getViewport({
          scale: Math.min(4, 4200 / Math.max(viewport.width, viewport.height)),
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
          const tsv = execFileSync(
            "tesseract",
            ["stdin", "stdout", "-l", "eng", "--psm", "11", "tsv"],
            {
              input: canvas.toBuffer("image/png"),
              encoding: "utf8",
              timeout: 35_000,
              maxBuffer: 8 * 1024 * 1024,
              env: { ...process.env, OMP_THREAD_LIMIT: "1" },
              stdio: ["pipe", "pipe", "ignore"],
            },
          );
          words = drawingOcrWords(tsv, {
            sheetWidth: 1,
            sheetHeight: 1,
            left: 0,
            top: 0,
            cropWidth: 1,
            cropHeight: 1,
            rasterWidth: canvas.width,
            rasterHeight: canvas.height,
          });
        } finally {
          canvas.width = 1;
          canvas.height = 1;
        }
      }
      pages.push({ page: n, words });
      page.cleanup();
    }
    incomplete = !ocrPage && doc.numPages > 2000;
  } finally {
    await task.destroy();
  }
} else {
  let size = 0;
  const files = unzipSync(bytes, {
    filter: (entry) => {
      if (
        !/^(?:word\/document|xl\/(?:sharedStrings|worksheets\/sheet\d+)|ppt\/slides\/slide\d+)\.xml$/.test(
          entry.name,
        )
      )
        return false;
      size += entry.originalSize;
      if (size > 32 * 1024 * 1024)
        throw Error("Office text exceeds index size limit");
      return true;
    },
  });
  const text = Object.values(files)
    .map((data) =>
      strFromU8(data)
        .replace(/<[^>]*>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">"),
    )
    .join(" ");
  pages.push({
    page: 1,
    words: [{ text, left: 0, top: 0, right: 1, bottom: 1 }],
  });
}
const json = JSON.stringify({ pages, incomplete });
if (json.length > 48 * 1024 * 1024)
  throw Error("Text index exceeds size limit");
const temporary = `${output}.${process.pid}.tmp`;
await writeFile(temporary, json, { mode: 0o600 });
await rename(temporary, output);

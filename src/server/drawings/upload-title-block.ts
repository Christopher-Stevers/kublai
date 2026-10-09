import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createCanvas } from "@napi-rs/canvas";
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { drawingOcrWords } from "./ocr";
import {
  extractDrawingIdentity,
  type SheetIdentity,
  type TitleBlockWord,
} from "~/lib/drawing-title-block";
const execute = promisify(execFile);
/** Read cropped, high-resolution title blocks, not a reduced whole-sheet thumbnail. OCR failure cannot discard an uploaded drawing. */
export async function readUploadTitleBlock(
  page: PDFPageProxy,
  words: TitleBlockWord[],
): Promise<SheetIdentity> {
  const direct = extractDrawingIdentity(words);
  if (direct.number && direct.title) return direct;
  const raw = page.getViewport({ scale: 1 });
  const regions = [
    { left: 0.65, top: 0, width: 0.35, height: 1 },
    { left: 0, top: 0.78, width: 1, height: 0.22 },
  ];
  let result = direct;
  for (const region of regions) {
    let directory: string | undefined;
    const cropWidth = raw.width * region.width,
      cropHeight = raw.height * region.height;
    const scale = Math.min(
      2,
      5000 / Math.max(cropWidth, cropHeight),
      Math.sqrt(6_000_000 / (cropWidth * cropHeight)),
    );
    const canvas = createCanvas(
      Math.max(1, Math.ceil(cropWidth * scale)),
      Math.max(1, Math.ceil(cropHeight * scale)),
    );
    try {
      const ctx = canvas.getContext("2d");
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport: page.getViewport({ scale }),
        transform: [
          1,
          0,
          0,
          1,
          -region.left * raw.width * scale,
          -region.top * raw.height * scale,
        ],
      }).promise;
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let at = 0; at < pixels.length; at += 64)
        if (pixels[at]! < 160 && pixels[at + 1]! < 160 && pixels[at + 2]! < 160)
          ink++;
      if (ink < 20) continue;
      directory = await mkdtemp(path.join(tmpdir(), "foreman-upload-title-"));
      const filename = path.join(directory, "title.png");
      await writeFile(filename, canvas.toBuffer("image/png"), { mode: 0o600 });
      const { stdout } = await execute(
        "tesseract",
        [filename, "stdout", "--psm", "11", "tsv"],
        {
          timeout: 3000,
          maxBuffer: 2_000_000,
          env: {
            NODE_ENV: process.env.NODE_ENV,
            PATH: process.env.PATH,
            OMP_THREAD_LIMIT: "1",
          },
        },
      );
      const trusted = stdout
        .split("\n")
        .filter(
          (line, index) => index === 0 || Number(line.split("\t")[10]) >= 65,
        )
        .join("\n");
      const recognized = drawingOcrWords(trusted, {
        sheetWidth: raw.width,
        sheetHeight: raw.height,
        left: region.left * raw.width,
        top: region.top * raw.height,
        cropWidth,
        cropHeight,
        rasterWidth: canvas.width,
        rasterHeight: canvas.height,
      });
      const scanned = extractDrawingIdentity(recognized);
      result = {
        number: result.number || scanned.number,
        title: result.title || scanned.title,
        discipline: result.discipline || scanned.discipline,
      };
      if (result.number && result.title) break;
    } catch {
      /* Preserve the PDF and any confident embedded text if recognition is unavailable. */
    } finally {
      canvas.width = canvas.height = 1;
      if (directory)
        await rm(directory, { recursive: true, force: true }).catch(
          () => undefined,
        );
    }
  }
  return result;
}

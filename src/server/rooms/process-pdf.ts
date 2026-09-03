import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";

import { extractSheetName } from "./sheet-name";
import {
  getJobFloorImageKey,
  getJobRoomFileUrl,
  writeJobRoomFile,
} from "./storage";

export type ProcessedFloor = {
  pageNumber: number;
  sourcePageNumber: number;
  name: string;
  imageUrl: string;
  width: number;
  height: number;
};

const MAX_PAGES = 25;
const RENDER_SCALE = 2;

export async function processJobFloorPlanPdf(
  jobId: string,
  pdfBuffer: Buffer,
  options?: { uploadId?: string; pageNumberOffset?: number },
): Promise<ProcessedFloor[]> {
  const data = new Uint8Array(pdfBuffer);
  const document = await getDocument({
    data,
    useSystemFonts: true,
  }).promise;

  const pageCount = Math.min(document.numPages, MAX_PAGES);
  const floors: ProcessedFloor[] = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    const canvasContext = canvas.getContext("2d");
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: canvasContext as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;

    const png = canvas.toBuffer("image/png");
    const webp = await sharp(png)
      .rotate()
      .resize({
        width: 2200,
        height: 2200,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();

    const metadata = await sharp(webp).metadata();
    const width = metadata.width ?? Math.ceil(viewport.width);
    const height = metadata.height ?? Math.ceil(viewport.height);
    const displayPage =
      (options?.pageNumberOffset ?? 0) + pageNumber;
    const storageKey = getJobFloorImageKey(
      jobId,
      pageNumber,
      options?.uploadId,
    );
    await writeJobRoomFile(storageKey, webp);

    const textContent = await page.getTextContent();
    const canvasW = Math.max(1, Math.ceil(viewport.width));
    const canvasH = Math.max(1, Math.ceil(viewport.height));
    const labels = textContent.items.flatMap((item) => {
      if (!("str" in item) || !item.str) return [];
      const transform = item.transform as number[];
      const [vx, vy] = viewport.convertToViewportPoint(
        transform[4] ?? 0,
        transform[5] ?? 0,
      );
      return [
        {
          str: String(item.str),
          x: vx / canvasW,
          y: vy / canvasH,
        },
      ];
    });

    floors.push({
      pageNumber: displayPage,
      sourcePageNumber: pageNumber,
      name: extractSheetName(labels, `Sheet ${displayPage}`),
      imageUrl: getJobRoomFileUrl(storageKey),
      width,
      height,
    });
  }

  return floors;
}

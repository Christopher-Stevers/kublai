import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";

import { detectRoomsFromPdfText, type DetectedRoom } from "./detect";
import {
  getJobFloorImageKey,
  getJobRoomFileUrl,
  writeJobRoomFile,
} from "./storage";

export type ProcessedFloor = {
  pageNumber: number;
  name: string;
  imageUrl: string;
  width: number;
  height: number;
  rooms: DetectedRoom[];
};

const MAX_PAGES = 25;
const RENDER_SCALE = 2;

export async function processJobFloorPlanPdf(
  jobId: string,
  pdfBuffer: Buffer,
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
    const storageKey = getJobFloorImageKey(jobId, pageNumber);
    await writeJobRoomFile(storageKey, webp);

    const textContent = await page.getTextContent();
    const items = textContent.items.flatMap((item) => {
      if (!("str" in item) || !item.str) return [];
      const transform = item.transform as number[];
      const x = transform[4] ?? 0;
      const y = transform[5] ?? 0;
      const w = "width" in item ? Number(item.width) || 0 : 0;
      const h = Math.abs(transform[3] ?? transform[0] ?? 12);
      return [
        {
          str: String(item.str),
          x,
          y,
          w,
          h,
        },
      ];
    });

    floors.push({
      pageNumber,
      name: `Floor ${pageNumber}`,
      imageUrl: getJobRoomFileUrl(storageKey),
      width,
      height,
      rooms: detectRoomsFromPdfText(items, viewport.width / RENDER_SCALE, viewport.height / RENDER_SCALE),
    });
  }

  return floors;
}

import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";

import type { RoomPoint } from "~/lib/room-shape";

export type NormalizedCrop = { x: number; y: number; w: number; h: number };

export type PdfRoomCropPlan = {
  crop: NormalizedCrop;
  scale: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  mapPoint: (x: number, y: number) => RoomPoint;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const stable = (value: number) => Math.round(value * 1e12) / 1e12;

/**
 * Plan a local, high-resolution render from the source PDF page. Rendering the
 * crop directly avoids allocating a huge full-page bitmap and preserves the
 * detail a human sees after zooming into one room.
 */
export function planPdfRoomCrop(
  pageWidth: number,
  pageHeight: number,
  requested: NormalizedCrop,
  targetLongSide = 2048,
): PdfRoomCropPlan {
  const x = clamp01(requested.x);
  const y = clamp01(requested.y);
  const x2 = clamp01(requested.x + requested.w);
  const y2 = clamp01(requested.y + requested.h);
  const crop = {
    x,
    y,
    w: Math.max(0.01, x2 - x),
    h: Math.max(0.01, y2 - y),
  };
  const sourceWidth = Math.max(1, pageWidth * crop.w);
  const sourceHeight = Math.max(1, pageHeight * crop.h);
  const scale = targetLongSide / Math.max(sourceWidth, sourceHeight);
  const width = Math.max(32, Math.floor(sourceWidth * scale));
  const height = Math.max(32, Math.floor(sourceHeight * scale));

  return {
    crop,
    scale,
    width,
    height,
    offsetX: crop.x * pageWidth * scale,
    offsetY: crop.y * pageHeight * scale,
    mapPoint(localX, localY) {
      return {
        x: stable(clamp01(crop.x + clamp01(localX) * crop.w)),
        y: stable(clamp01(crop.y + clamp01(localY) * crop.h)),
      };
    },
  };
}

export async function renderPdfRoomCrop(
  pdfBuffer: Buffer,
  pageNumber: number,
  crop: NormalizedCrop,
  targetLongSide = 2048,
) {
  const document = await getDocument({
    data: new Uint8Array(pdfBuffer),
    useSystemFonts: true,
  }).promise;
  try {
    const page = await document.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const plan = planPdfRoomCrop(
      base.width,
      base.height,
      crop,
      targetLongSide,
    );
    const viewport = page.getViewport({ scale: plan.scale });
    const canvas = createCanvas(plan.width, plan.height);
    const canvasContext = canvas.getContext("2d");
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: canvasContext as unknown as CanvasRenderingContext2D,
      viewport,
      transform: [1, 0, 0, 1, -plan.offsetX, -plan.offsetY],
    }).promise;
    const jpeg = await sharp(canvas.toBuffer("image/png"))
      .jpeg({ quality: 88 })
      .toBuffer();
    return {
      jpeg,
      sentWidth: plan.width,
      sentHeight: plan.height,
      mapPoint: plan.mapPoint,
      crop: plan.crop,
    };
  } finally {
    await document.cleanup();
  }
}

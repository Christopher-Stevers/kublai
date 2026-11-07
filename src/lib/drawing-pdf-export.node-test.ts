import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, PDFName, PDFNumber, degrees, rgb } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildDrawingPdf } from "./drawing-pdf-export";

async function sourcePdf(rotation: number, unit: number) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 400]);
  page.setMediaBox(17, 23, 600, 400);
  page.setCropBox(50, 40, 500, 300);
  page.setRotation(degrees(rotation));
  page.node.set(PDFName.of("UserUnit"), PDFNumber.of(unit));
  page.drawRectangle({
    x: 62,
    y: 54,
    width: 40,
    height: 60,
    color: rgb(0, 0, 0),
  });
  page.drawRectangle({
    x: 410,
    y: 257,
    width: 70,
    height: 22,
    color: rgb(0, 0.3, 0.8),
  });
  page.drawLine({
    start: { x: 165, y: 130 },
    end: { x: 165, y: 295 },
    thickness: 2,
    color: rgb(0, 0, 0),
  });
  return doc.save();
}
async function raster(bytes: Uint8Array) {
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  });
  try {
    const pdf = await task.promise,
      page = await pdf.getPage(1),
      viewport = page.getViewport({ scale: 1 });
    const canvas = createCanvas(viewport.width, viewport.height);
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport,
    }).promise;
    return {
      width: canvas.width,
      height: canvas.height,
      pixels: canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height).data,
    };
  } finally {
    await task.destroy();
  }
}

for (const rotation of [0, 90, 180, 270]) {
  for (const unit of [1, 2]) {
    void test(`vector export preserves original pixels, crop and markup position: rotate ${rotation}, user unit ${unit}`, async () => {
      const source = await sourcePdf(rotation, unit);
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response(new Uint8Array(source), {
          headers: { "Content-Type": "application/pdf" },
        });
      try {
        const clean = await buildDrawingPdf({
          pdfUrl: "/fixture.pdf",
          pageNumber: 1,
        });
        const annotated = await buildDrawingPdf({
          pdfUrl: "/fixture.pdf",
          pageNumber: 1,
          markups: [
            {
              sourceSheetId: "0391aed4-7773-47ec-9141-09df373ec008",
              type: "rect",
              points: [
                { x: 0.2, y: 0.2 },
                { x: 0.4, y: 0.4 },
              ],
              width: 2,
              stroke: "#ff0000",
              fill: "#ff0000",
            },
          ],
        });
        const original = await raster(source),
          exported = await raster(clean),
          marked = await raster(annotated);
        assert.equal(exported.width, original.width);
        assert.equal(exported.height, original.height);
        assert.ok(
          exported.pixels.every(
            (value, index) => value === original.pixels[index],
          ),
          "Unannotated export must preserve the original independently drawn vector fixture pixel for pixel",
        );
        const index =
          (Math.floor(marked.height * 0.3) * marked.width +
            Math.floor(marked.width * 0.3)) *
          4;
        assert.deepEqual(
          Array.from(marked.pixels.slice(index, index + 4)),
          [255, 0, 0, 255],
          "Normalized top-left markup coordinates must survive crop, rotation and UserUnit",
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
}

// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import sharp from "sharp";
import { expect, it } from "vitest";
import { hyperlinkImages } from "./hyperlink-images";
it("renders digital, rotated and image-only PDFs into bounded overlapping page regions", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "hyperlink-render-test-"),
  );
  try {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([600, 400]);
    page.drawText("AHU-1", { x: 80, y: 300, size: 18, font });
    page.setRotation(degrees(90));
    const canvas = createCanvas(600, 400);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, 600, 400);
    context.fillStyle = "black";
    context.font = "24px sans-serif";
    context.fillText("P-2", 200, 150);
    const scan = await pdf.embedPng(canvas.toBuffer("image/png"));
    pdf
      .addPage([600, 400])
      .drawImage(scan, { x: 0, y: 0, width: 600, height: 400 });
    const file = path.join(directory, "source.pdf");
    await writeFile(file, await pdf.save());
    const digital = await hyperlinkImages(file, 1);
    const raster = await hyperlinkImages(file, 2);
    expect(digital.words.some((w) => w.text === "AHU-1")).toBe(true);
    expect(raster.words).toHaveLength(0);
    for (const result of [digital, raster]) {
      expect(result.images).toHaveLength(5);
      expect(result.images[0]).toMatchObject({
        left: 0,
        top: 0,
        right: 1,
        bottom: 1,
      });
      expect(result.images[1]!.right).toBeGreaterThan(result.images[2]!.left);
      for (const [i, image] of result.images.entries()) {
        const metadata = await sharp(image.png).metadata();
        expect(Math.max(metadata.width, metadata.height)).toBeLessThanOrEqual(
          i === 0 ? 1400 : 2200,
        );
        expect(image.left).toBeLessThan(image.right);
        expect(image.top).toBeLessThan(image.bottom);
      }
    }
    for (const word of digital.words) {
      expect(word.left).toBeGreaterThanOrEqual(0);
      expect(word.right).toBeLessThanOrEqual(1);
      expect(word.top).toBeGreaterThanOrEqual(0);
      expect(word.bottom).toBeLessThanOrEqual(1);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

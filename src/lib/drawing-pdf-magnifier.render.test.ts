// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { loadPdfDocument } from "./pdf-client";
import { DrawingPdfMagnifier } from "./drawing-pdf-magnifier";
vi.mock("./pdf-client", () => ({ loadPdfDocument: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
for (const rotation of [0, 90]) {
  for (const width of [0.02, 0.002]) {
    it(`resolves two vector lines independently at crop ${width}, rotation ${rotation}`, async () => {
      const source = await PDFDocument.create();
      const sheet = source.addPage([100, 100]);
      sheet.setRotation(degrees(rotation));
      for (const x of [49.95, 50.05])
        sheet.drawLine({
          start: { x, y: 40 },
          end: { x, y: 60 },
          thickness: 0.01,
        });
      const task = getDocument({
        data: await source.save(),
        useSystemFonts: false,
      });
      const doc = await task.promise;
      vi.mocked(loadPdfDocument).mockResolvedValue(doc);
      vi.stubGlobal("document", { createElement: () => createCanvas(1, 1) });
      let done!: () => void;
      const rendered = new Promise<void>((resolve) => {
        done = resolve;
      });
      const lens = new DrawingPdfMagnifier(
        { url: "/synthetic-vector.pdf", page: 1 },
        done,
      );
      const crop = {
        left: 0.5 - width / 2,
        top: 0.5 - width / 2,
        width,
        height: width,
        pixels: 200,
      };
      try {
        lens.request(crop);
        await rendered;
        const canvas = createCanvas(200, 200);
        lens.paint(canvas.getContext("2d") as unknown as CanvasRenderingContext2D, crop, 200);
        const pixels = canvas
          .getContext("2d")!
          .getImageData(0, 0, 200, 200).data;
        const ink = (p: number) =>
          pixels[(rotation === 0 ? 100 * 200 + p : p * 200 + 100) * 4]!;
        const offset = (0.0005 / width) * 200;
        // Both source lines stay distinct, with white space at the aimed center.
        expect(
          Math.min(
            ink(Math.floor(100 - offset)),
            ink(Math.floor(100 - offset) - 1),
          ),
        ).toBeLessThan(140);
        expect(
          Math.min(
            ink(Math.floor(100 + offset)),
            ink(Math.floor(100 + offset) - 1),
          ),
        ).toBeLessThan(140);
        expect(ink(100)).toBeGreaterThan(245);
      } finally {
        lens.dispose();
        await task.destroy();
      }
    });
  }
}

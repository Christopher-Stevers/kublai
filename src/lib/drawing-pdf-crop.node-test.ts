import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import {
  drawingPdfOperationsFilter,
  type PdfOperationBounds,
} from "./drawing-pdf-operations";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** An independently authored vector fixture, never a customer drawing. */
function vectorPdf(rotation: number) {
  const commands = [
    "0.15 0.55 0.85 rg 22 28 190 110 re f",
    "1 1 1 rg 27 33 180 100 re f",
    "0.1 0.1 0.1 RG 1.5 w 30 40 m 30 118 l 202 118 l S",
    "0.9 0.15 0.1 rg 49 60 47 33 re f",
    "0.1 0.7 0.2 rg 131 77 41 44 re f",
    "0.15 0.1 0.7 RG 2 w 40 51 m 194 51 l 194 109 l S",
    // Isolated offscreen marks, with scoped color and transform state.
    "q 1 0 0 1 19 25 cm 0.2 0.6 0.8 rg 0 0 3 3 re f Q",
    "q 1 0 0 1 211 137 cm 0.8 0.6 0.2 rg 0 0 3 3 re f Q",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [17 23 217 143] /Rotate ${rotation} /Resources << >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf));
}

for (const rotation of [0, 90, 180, 270]) {
  for (const verticalScale of [1, 1.5]) {
    void test(`PDF.js cropped viewport stays pixel-aligned at rotation ${rotation} and vertical scale ${verticalScale}`, async () => {
      const loading = getDocument({
        data: vectorPdf(rotation),
        useSystemFonts: false,
      });
      const document = await loading.promise;
      try {
        const page = await document.getPage(1);
        const fullViewport = page.getViewport({ scale: 2 });
        const full = createCanvas(
          fullViewport.width,
          fullViewport.height * verticalScale,
        );
        await page.render({
          canvas: full as unknown as HTMLCanvasElement,
          viewport: fullViewport,
          recordOperations: true,
          transform: [1, 0, 0, verticalScale, 0, 0],
        }).promise;

        // The viewer expresses patches in normalized, already-rotated page space.
        const left = full.width / 4;
        const top = full.height / 4;
        const crop = createCanvas(full.width / 2, full.height / 2);
        assert.ok(
          page.recordedBBoxes,
          "The whole-page render must record operation bounds",
        );
        const filter = drawingPdfOperationsFilter(
          page.recordedBBoxes as PdfOperationBounds,
          {
            left: 0.25,
            top: 0.25,
            width: 0.5,
            height: 0.5,
            pixelWidth: crop.width,
            pixelHeight: crop.height,
            fullWidth: full.width,
            fullHeight: full.height,
          },
        )!;
        let skipped = 0;
        await page.render({
          operationsFilter: (index) => {
            const keep = filter(index);
            if (!keep) skipped++;
            return keep;
          },
          canvas: crop as unknown as HTMLCanvasElement,
          viewport: page.getViewport({ scale: 2 }),
          // Same normalized-page transform used by DrawingPdfLayer, including
          // the tiny independent x/y density adjustment from canvas rounding.
          // A larger 1.5 fixture stretch makes transform order errors obvious.
          transform: [1, 0, 0, verticalScale, -left, -top],
        }).promise;
        assert.ok(
          skipped > 0,
          "The optimized crop must skip offscreen operations",
        );
        const expected = full
          .getContext("2d")
          .getImageData(left, top, crop.width, crop.height).data;
        const actual = crop
          .getContext("2d")
          .getImageData(0, 0, crop.width, crop.height).data;
        assert.ok(
          actual.every((value, index) => value === expected[index]),
          "A cropped canvas must preserve every fixture pixel's position and color",
        );
        assert.ok(
          actual.some((value, index) => index % 4 !== 3 && value < 80),
          "The crop must contain drawing detail, not an empty page",
        );
      } finally {
        await loading.destroy();
      }
    });
  }
}

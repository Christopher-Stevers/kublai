/** Read-only PDF crop parity/timing study. Never uploads or changes drawings.
 * Native canvas timings are not measurements from an actual phone.
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  drawingPdfOperationsFilter,
  type PdfOperationBounds,
} from "../src/lib/drawing-pdf-operations";
const [outputPath, ...inputPaths] = process.argv.slice(2);
if (!outputPath || !inputPaths.length)
  throw Error(
    "Usage: benchmark-drawing-pdf-crops.ts report.json drawing.pdf [drawing.pdf ...]",
  );
const reports = [];
const seen = new Set<string>();
for (const file of inputPaths) {
  const data = fs.readFileSync(file);
  const inputHash = createHash("sha256").update(data).digest("hex");
  if (seen.has(inputHash)) continue;
  seen.add(inputHash);
  const loading = getDocument({
    data: new Uint8Array(data),
    useSystemFonts: false,
    standardFontDataUrl:
      path.resolve("node_modules/pdfjs-dist/standard_fonts") + "/",
  });
  const doc = await loading.promise;
  try {
    const page = await doc.getPage(1),
      raw = page.getViewport({ scale: 1 }),
      fullView = page.getViewport({ scale: 1024 / raw.width });
    const full = createCanvas(
      Math.ceil(fullView.width),
      Math.ceil(fullView.height),
    );
    const first = performance.now();
    await page.render({
      canvas: full as unknown as HTMLCanvasElement,
      viewport: fullView,
    }).promise;
    const initialMs = performance.now() - first;
    console.log(JSON.stringify({ inputHash, stage: "initial", ms: initialMs }));
    const begin = performance.now();
    await page.render({
      canvas: full as unknown as HTMLCanvasElement,
      viewport: fullView,
      recordOperations: true,
    }).promise;
    const recordingMs = performance.now() - begin;
    console.log(
      JSON.stringify({ inputHash, stage: "record", ms: recordingMs }),
    );
    assert.ok(page.recordedBBoxes);
    const results = [];
    const regions: Array<[number, number]> =
      data.length > 2000000
        ? [[0.4, 0.4]]
        : [
            [0.1, 0.1],
            [0.4, 0.4],
            [0.7, 0.65],
          ];
    for (const [left, top] of regions) {
      const viewport = page.getViewport({
          scale: (data.length > 2000000 ? 1024 : 4096) / raw.width,
        }),
        width = 0.2,
        height = 0.2;
      const patch = {
        left,
        top,
        width,
        height,
        fullWidth: viewport.width,
        fullHeight: viewport.height,
        pixelWidth: Math.ceil(width * viewport.width),
        pixelHeight: Math.ceil(height * viewport.height),
      };
      const filter = drawingPdfOperationsFilter(
        page.recordedBBoxes as PdfOperationBounds,
        patch,
      )!;
      const times: { full: number[]; filtered: number[] } = {
        full: [],
        filtered: [],
      };
      let skipped = 0,
        visited = 0,
        expected: Uint8ClampedArray | undefined;
      for (let repeat = 0; repeat < (data.length > 2000000 ? 1 : 3); repeat++)
        for (const mode of ["full", "filtered"] as const) {
          const canvas = createCanvas(patch.pixelWidth, patch.pixelHeight);
          const start = performance.now();
          await page.render({
            canvas: canvas as unknown as HTMLCanvasElement,
            viewport,
            transform: [
              1,
              0,
              0,
              1,
              -left * viewport.width,
              -top * viewport.height,
            ],
            operationsFilter:
              mode === "filtered"
                ? (i) => {
                    visited++;
                    const keep = filter(i);
                    if (!keep) skipped++;
                    return keep;
                  }
                : undefined,
          }).promise;
          times[mode].push(performance.now() - start);
          const pixels = canvas
            .getContext("2d")
            .getImageData(0, 0, canvas.width, canvas.height).data;
          if (mode === "full") expected = pixels;
          else
            assert.ok(
              pixels.every((v, i) => v === expected![i]),
              "Filtered crop must match every unfiltered pixel",
            );
          canvas.width = 0;
          canvas.height = 0;
        }
      const median = (v: number[]) =>
        v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
      results.push({
        left,
        top,
        skipped,
        visited,
        baselineMs: median(times.full),
        optimizedMs: median(times.filtered),
        pixelParity: true,
      });
      console.log(
        JSON.stringify({ inputHash, stage: "crop", ...results.at(-1) }),
      );
    }
    reports.push({
      inputSha256: inputHash,
      pages: doc.numPages,
      initialMs,
      recordingMs,
      results,
    });
    console.log(JSON.stringify(reports.at(-1)));
  } finally {
    await loading.destroy();
  }
}
fs.writeFileSync(outputPath, JSON.stringify(reports, null, 2));

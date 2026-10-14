// @vitest-environment node
import { expect, test } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PIPE_OPS } from "~/lib/pdf-pipe-extraction";
import { saveDrawingPipeLinework } from "./pipe-linework";

test("upload saves normalized vectors and original hidden-system layer names atomically", async () => {
  const dest = await mkdtemp(path.join(os.tmpdir(), "drawing-systems-"));
  try {
    const page = {
      pageNumber: 3,
      getViewport: () => ({ width: 100, height: 50, convertToViewportPoint: (x: number, y: number) => [x, y] }),
      getTextContent: async () => ({ items: [] }),
      getOperatorList: async () => ({
        fnArray: [PIPE_OPS.beginMarkedContentProps, PIPE_OPS.constructPath, PIPE_OPS.endMarkedContent],
        argsArray: [["OC", { type: "OCG", id: "cold-water" }], [PIPE_OPS.stroke, [Float32Array.from([0, 10, 25, 1, 90, 25])], Float32Array.from([0, 0, 100, 50])], []],
      }),
    } as unknown as PDFPageProxy;
    const document = { getOptionalContentConfig: async () => ({ getGroup: () => ({ name: "M-PLMB-DCWT", visible: false }), isVisible: () => false }) } as unknown as PDFDocumentProxy;
    const linework = await saveDrawingPipeLinework(dest, document, page);
    expect(linework.segments).toHaveLength(1);
    expect(linework.segments[0]).toMatchObject({ layer: "M-PLMB-DCWT", x1: 0.1, y1: 0.5, x2: 0.9, y2: 0.5 });
    expect(JSON.parse(gunzipSync(await readFile(path.join(dest, "pipes-3-v1.json"))).toString())).toEqual({ version: 1, linework });
    expect(await readdir(dest)).toEqual(["pipes-3-v1.json"]);
  } finally { await rm(dest, { recursive: true, force: true }); }
});

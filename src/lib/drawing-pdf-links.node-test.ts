import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument, PDFName, PDFString, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readDrawingPdfLinks, clearDrawingPdfLinks } from "./drawing-pdf-links";
import { renderUploadPdf } from "../server/rooms/upload-render";

for (const [rotation, expected] of [
  [0, [0.1, 0.6, 0.3, 0.8]],
  [90, [0.2, 0.1, 0.4, 0.3]],
  [180, [0.7, 0.2, 0.9, 0.4]],
  [270, [0.6, 0.7, 0.8, 0.9]],
] as const) {
  void test(`upload retains clickable PDF links and aligns cropped page at ${rotation} degrees`, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "drawing-link-upload-"));
    try {
      const fixture = await PDFDocument.create();
      const first = fixture.addPage([230, 140]);
      const second = fixture.addPage([230, 140]);
      first.setCropBox(10, 20, 200, 100);
      first.setRotation(degrees(rotation));
      const external = fixture.context.register(
        fixture.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [30, 40, 70, 60],
          A: { S: "URI", URI: PDFString.of("https://example.com/drawing") },
        }),
      );
      const internal = fixture.context.register(
        fixture.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [30, 40, 70, 60],
          Dest: [second.ref, PDFName.of("Fit")],
        }),
      );
      const named = fixture.context.register(
        fixture.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [30, 40, 70, 60],
          Dest: PDFString.of("detail"),
        }),
      );
      fixture.catalog.set(
        PDFName.of("Names"),
        fixture.context.obj({
          Dests: {
            Names: [PDFString.of("detail"), [second.ref, PDFName.of("Fit")]],
          },
        }),
      );
      first.node.set(
        PDFName.of("Annots"),
        fixture.context.obj([external, internal, named]),
      );
      const bytes = await fixture.save();
      const file = path.join(dir, "plan.pdf");
      await writeFile(file, bytes);
      const sheets = await renderUploadPdf(dir, "job", "upload");
      assert.equal(sheets.length, 2);
      const retained = await readFile(file);
      assert.deepEqual(
        new Uint8Array(retained),
        bytes,
        "The upload renderer must retain original annotations byte for byte",
      );
      const task = getDocument({ data: new Uint8Array(retained) });
      try {
        const document = await task.promise;
        clearDrawingPdfLinks();
        const links = await readDrawingPdfLinks(
          { url: file, page: 1 },
          document,
        );
        assert.equal(links.length, 3);
        assert.equal(links[0]?.url, "https://example.com/drawing");
        assert.equal(links[1]?.page, 2);
        assert.equal(links[2]?.page, 2);
        for (const link of links) {
          const actual = [link.left, link.top, link.right, link.bottom];
          actual.forEach((coordinate, index) =>
            assert.ok(Math.abs(coordinate - expected[index]!) < 1e-8),
          );
        }
      } finally {
        await task.destroy();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

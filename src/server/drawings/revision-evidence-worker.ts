import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import { SERVER_PDF_RENDER_OPTIONS } from "../rooms/pdf-render-options";
import { scaleFromSheetText } from "~/lib/sheet-scale-text";
const [dest, pagesText] = process.argv.slice(2);
if (!dest || !pagesText) throw Error("Missing PDF evidence arguments");
const pages = JSON.parse(pagesText) as number[];
if (
  !Array.isArray(pages) ||
  pages.length > 100 ||
  pages.some((n) => !Number.isInteger(n) || n < 1)
)
  throw Error("Invalid pages");
const bytes = await readFile(path.join(dest, "plan.pdf"));
const task = getDocument({
  ...SERVER_PDF_RENDER_OPTIONS,
  verbosity: VerbosityLevel.ERRORS,
  data: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
});
try {
  const doc = await task.promise;
  for (const number of pages) {
    const page = await doc.getPage(number),
      viewport = page.getViewport({ scale: 1 }),
      text = await page.getTextContent();
    const items = text.items.flatMap((item) => {
      if (!("str" in item)) return [];
      const [x, y] = viewport.convertToViewportPoint(
        Number(item.transform[4] ?? 0),
        Number(item.transform[5] ?? 0),
      ) as [number, number];
      return [
        {
          str: item.str,
          x: x / viewport.width,
          y: y / viewport.height,
          w: item.width / viewport.width,
        },
      ];
    });
    const read = scaleFromSheetText(items, viewport.width);
    await writeFile(
      path.join(dest, `revision-scale-${number}-v1.json`),
      JSON.stringify({
        width: viewport.width,
        height: viewport.height,
        scale: read.ok ? read.scale : null,
        words: text.items.flatMap((item) => {
          if (!("str" in item) || !item.str.trim()) return [];
          const [x, y] = viewport.convertToViewportPoint(
            Number(item.transform[4] ?? 0),
            Number(item.transform[5] ?? 0),
          ) as [number, number];
          const h = Math.hypot(
            Number(item.transform[2] ?? 0),
            Number(item.transform[3] ?? 0),
          );
          return [
            {
              text: item.str,
              left: x / viewport.width,
              top: (y - h) / viewport.height,
              right: (x + item.width) / viewport.width,
              bottom: y / viewport.height,
            },
          ];
        }),
      }),
    );
    page.cleanup();
  }
} finally {
  await task.destroy();
}

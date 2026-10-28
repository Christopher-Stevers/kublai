/** Short-lived renderer: full-sheet PDF/canvas allocations stay outside the web process. */
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";
import { SERVER_PDF_RENDER_OPTIONS } from "../rooms/pdf-render-options";
import { pdfTitleBlockWord } from "~/lib/drawing-title-block";

const [source, directory, pageText] = process.argv.slice(2);
const number = Number(pageText);
if (
  !source ||
  !directory ||
  !Number.isInteger(number) ||
  number < 1 ||
  number > 2000
)
  throw Error("Invalid hyperlink render request");
if ((await stat(source)).size > 160 * 1024 * 1024)
  throw Error("Drawing exceeds reading limit");
sharp.cache(false);
sharp.concurrency(1);
const task = getDocument({
  ...SERVER_PDF_RENDER_OPTIONS,
  verbosity: VerbosityLevel.ERRORS,
  data: new Uint8Array(await readFile(source)),
});
try {
  const pdf = await task.promise;
  const page = await pdf.getPage(number);
  const raw = page.getViewport({ scale: 1 });
  const view = page.getViewport({
    scale: 4200 / Math.max(raw.width, raw.height),
  });
  if (
    ![view.width, view.height].every(
      (n) => Number.isFinite(n) && n > 0 && n <= 4201,
    )
  )
    throw Error("Invalid drawing size");
  const canvas = createCanvas(Math.ceil(view.width), Math.ceil(view.height));
  try {
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport: view,
    }).promise;
    const png = canvas.toBuffer("image/png");
    const regions = [
      { left: 0, top: 0, right: 1, bottom: 1 },
      { left: 0, top: 0, right: 0.53, bottom: 0.53 },
      { left: 0.47, top: 0, right: 1, bottom: 0.53 },
      { left: 0, top: 0.47, right: 0.53, bottom: 1 },
      { left: 0.47, top: 0.47, right: 1, bottom: 1 },
    ];
    const images = [];
    for (const [i, region] of regions.entries()) {
      const left = Math.floor(region.left * canvas.width),
        top = Math.floor(region.top * canvas.height);
      const right = Math.ceil(region.right * canvas.width),
        bottom = Math.ceil(region.bottom * canvas.height);
      const file = `${i}.png`;
      await sharp(png)
        .extract({ left, top, width: right - left, height: bottom - top })
        .resize({
          width: i === 0 ? 1400 : 2200,
          height: i === 0 ? 1400 : 2200,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toFile(path.join(directory, file));
      images.push({
        file,
        left: left / canvas.width,
        top: top / canvas.height,
        right: right / canvas.width,
        bottom: bottom / canvas.height,
      });
    }
    const text = await page.getTextContent();
    const words = text.items
      .flatMap((item) =>
        "str" in item && item.str.trim() ? [pdfTitleBlockWord(item, raw)] : [],
      )
      .slice(0, 20_000);
    await writeFile(
      path.join(directory, "page.json"),
      JSON.stringify({ images, words }),
      { mode: 0o600 },
    );
  } finally {
    canvas.width = canvas.height = 1;
  }
} finally {
  await task.destroy();
}

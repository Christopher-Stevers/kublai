/** Offline source render with explicit page convention and immutable receipt. */
import { readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import { renderPdfPageWithoutText } from "../../../src/server/rooms/hybrid/render-page";

const [pdfPath, number, size, pngPath, ...extra] = process.argv.slice(2);
const pageNumber = Number(number), longSide = Number(size);
if (!pdfPath || !pngPath || extra.length || !Number.isSafeInteger(pageNumber) || pageNumber < 1 ||
    !Number.isSafeInteger(longSide) || longSide < 512 || longSide > 5000) {
  throw new Error("Usage: render-source PDF ONE_BASED_PAGE LONG_SIDE NEW_PNG");
}
for (const p of [pngPath, pngPath + ".receipt.json"]) {
  try { await access(p); throw new Error("Original render output exists"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
}
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const pdf = await readFile(pdfPath);
if (pdf.length > 100 * 1024 * 1024) throw new Error("PDF byte budget");
const page = await renderPdfPageWithoutText(pdf, pageNumber, longSide);
const canvas = createCanvas(page.width, page.height);
canvas.getContext("2d").putImageData(new ImageData(page.rgba, page.width, page.height), 0, 0);
const png = canvas.toBuffer("image/png");
const receipt = { pdfPath, sourcePdfSha256: hash(pdf), pdfPageNumber: pageNumber, pdfPageIndex: pageNumber - 1,
  width: page.width, height: page.height, pngSha256: hash(png), cacheSha256: hash(png),
  derivedFromFreshRender: true, coordinateFrame: "full-page-viewport-isotropic", textSuppressed: true,
  rendererSha256: hash(await readFile(new URL("../../../src/server/rooms/hybrid/render-page.ts", import.meta.url))),
  adapterSha256: hash(await readFile(new URL(import.meta.url))) };
await writeFile(pngPath, png, { flag: "wx" });
await writeFile(pngPath + ".receipt.json", JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(receipt));

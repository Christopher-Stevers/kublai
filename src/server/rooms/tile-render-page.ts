// Renders one drawing page into map-style tiles. Runs as its own short-lived
// process (see tile-worker.ts) so PDF.js/canvas memory never accumulates.
//
// Layout under the upload folder:
//   tiles/<page>/<factor>/<col>_<row>.webp   factor 2 and 4 = sharper than the
//                                            saved floor-<page>.webp (factor 1)
//   tiles/<page>/manifest.json               written last; marks the page ready
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";
import { SERVER_PDF_RENDER_OPTIONS } from "./pdf-render-options";
import { TILE_FACTORS, TILE_SIZE, type TileManifest } from "~/lib/drawing-tiles";

const BASE_LONG_EDGE = 2200; // matches floor-<page>.webp from upload-render-page.ts
const CHUNK = 4096; // rendered at the top factor, then cut into tiles

async function main() {
  const [dest, pageText] = process.argv.slice(2);
  const pageNumber = Number(pageText);
  if (!dest || !Number.isSafeInteger(pageNumber) || pageNumber < 1)
    throw new Error("Tile renderer needs a destination and page number");
  sharp.cache(false);
  sharp.concurrency(2);
  const loadingTask = getDocument({
    ...SERVER_PDF_RENDER_OPTIONS,
    verbosity: VerbosityLevel.ERRORS,
    data: new Uint8Array(await readFile(path.join(dest, "plan.pdf"))),
    maxImageSize: 16_000_000,
    canvasMaxAreaInBytes: 20_000_000,
  });
  const document = await loadingTask.promise;
  try {
    const page = await document.getPage(pageNumber);
    const raw = page.getViewport({ scale: 1 });
    const base = Math.min(2, BASE_LONG_EDGE / Math.max(raw.width, raw.height));
    const top = TILE_FACTORS.at(-1)!;
    const scale = base * top;
    const width = Math.ceil(raw.width * scale);
    const height = Math.ceil(raw.height * scale);
    const root = path.join(dest, "tiles", String(pageNumber));
    for (const factor of TILE_FACTORS)
      await mkdir(path.join(root, String(factor)), { recursive: true });

    for (let cy = 0; cy < height; cy += CHUNK) {
      for (let cx = 0; cx < width; cx += CHUNK) {
        const cw = Math.min(CHUNK, width - cx);
        const ch = Math.min(CHUNK, height - cy);
        const canvas = createCanvas(cw, ch);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, cw, ch);
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: ctx as unknown as CanvasRenderingContext2D,
          viewport: page.getViewport({ scale, offsetX: -cx, offsetY: -cy }),
        }).promise;
        const pixels = Buffer.from(ctx.getImageData(0, 0, cw, ch).data.buffer);
        for (const factor of TILE_FACTORS) {
          // Lower factors come from shrinking the top render (no re-render).
          const shrink = top / factor;
          const level =
            shrink === 1
              ? { data: pixels, info: { width: cw, height: ch, channels: 4 as const } }
              : await sharp(pixels, { raw: { width: cw, height: ch, channels: 4 } })
                  .resize(Math.ceil(cw / shrink), Math.ceil(ch / shrink))
                  .raw()
                  .toBuffer({ resolveWithObject: true });
          const { width: lw, height: lh, channels } = level.info;
          const firstCol = cx / shrink / TILE_SIZE;
          const firstRow = cy / shrink / TILE_SIZE;
          const writes: Promise<void>[] = [];
          for (let row = 0; row * TILE_SIZE < lh; row++) {
            for (let col = 0; col * TILE_SIZE < lw; col++) {
              const tileWidth = Math.min(TILE_SIZE, lw - col * TILE_SIZE);
              const tileHeight = Math.min(TILE_SIZE, lh - row * TILE_SIZE);
              writes.push(
                sharp(level.data, { raw: { width: lw, height: lh, channels: channels as 3 | 4 } })
                  .extract({ left: col * TILE_SIZE, top: row * TILE_SIZE, width: tileWidth, height: tileHeight })
                  .webp({ quality: 80 })
                  .toFile(path.join(root, String(factor), `${firstCol + col}_${firstRow + row}.webp`))
                  .then(() => undefined),
              );
            }
          }
          await Promise.all(writes);
        }
      }
    }

    const manifest: TileManifest = {
      version: 1,
      tileSize: TILE_SIZE,
      levels: TILE_FACTORS.map((factor) => ({
        factor,
        width: Math.ceil(width / (top / factor)),
        height: Math.ceil(height / (top / factor)),
      })),
    };
    const file = path.join(root, "manifest.json");
    await writeFile(`${file}.tmp`, JSON.stringify(manifest));
    await rename(`${file}.tmp`, file);
    process.stdout.write(JSON.stringify({ page: pageNumber, ok: true }));
  } finally {
    await loadingTask.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

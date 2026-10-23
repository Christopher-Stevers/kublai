import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { drawingPdfLocation, equipmentIndex } from "./equipment-index";
import { textInLabelBox, type LabelBox } from "~/lib/super-label";
const execute = promisify(execFile);
export async function readLabelBox(
  sheet: { imageUrl: string; jobId: string },
  box: LabelBox,
) {
  const location = drawingPdfLocation(sheet.imageUrl, sheet.jobId);
  if (!location) throw Error("This drawing has no readable source");
  const index = await equipmentIndex(location.file, "pdf").catch(() => ({pages:[]}));
  const direct = textInLabelBox(
    index.pages.find((p) => p.page === location.page)?.words ?? [],
    box,
  );
  if (direct) return direct;
  const dir = await mkdtemp(path.join(tmpdir(), "foreman-label-"));
  try {
    const raster = path.join(
      path.dirname(location.file),
      `floor-${location.page}.webp`,
    );
    const meta = await sharp(raster, {
      limitInputPixels: 20_000_000,
    }).metadata();
    const left = Math.floor(box.left * meta.width),
      top = Math.floor(box.top * meta.height);
    const width = Math.max(
        1,
        Math.min(
          meta.width - left,
          Math.ceil((box.right - box.left) * meta.width),
        ),
      ),
      height = Math.max(
        1,
        Math.min(
          meta.height - top,
          Math.ceil((box.bottom - box.top) * meta.height),
        ),
      );
    const file = path.join(dir, "crop.png");
    await sharp(raster, { limitInputPixels: 20_000_000 })
      .extract({ left, top, width, height })
      .resize({
        width: 2500,
        height: 2500,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toFile(file);
    const { stdout } = await execute(
      "tesseract",
      [file, "stdout", "--psm", "6"],
      {
        timeout: 15000,
        maxBuffer: 65536,
        env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, OMP_THREAD_LIMIT: "1" },
      },
    );
    return stdout.replace(/\s+/g, " ").trim().slice(0, 255);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

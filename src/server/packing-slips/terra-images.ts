import sharp from "sharp";
import type { FallbackInput, FallbackOutput } from "./terra-fallback";

type Band = { top: number; height: number; outputTop: number };
export type TerraImage = {
  png: Buffer;
  page: number;
  sourceHeight: number;
  imageHeight: number;
  bands: Band[];
};

/** Full-width bands preserve all quantity columns and nearby continuation text. */
export async function prepareTerraImages(
  pages: Buffer[],
  input: FallbackInput,
) {
  const targets = input.targetLineIndexes;
  const crop = Boolean(
    input.linkedOrderId &&
    targets?.length &&
    !input.reasons.some((r) =>
      /coverage|totals|structure|order match/i.test(r),
    ),
  );
  const images: TerraImage[] = [];
  for (const [index, page] of pages.entries()) {
    const pageNumber = index + 1;
    const rows = targets?.map((i) => input.earlierLines[i]);
    // Invalid row references require all pages, rather than silently omitting evidence.
    const validReferences = rows?.every(
      (r) => r && r.page >= 1 && r.page <= pages.length,
    );
    const selected = rows?.filter((r) => r?.page === pageNumber) ?? [];
    if (crop && validReferences && !selected.length) continue;
    const source = await sharp(page)
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer({ resolveWithObject: true });
    const { width, height } = source.info;
    let ranges = [{ top: 0, bottom: height }];
    const header = input.headers?.find(
      (h) => h.page === pageNumber && (h.printedOn ?? h.page) === pageNumber,
    );
    const boxes = [header?.box, ...selected.map((r) => r?.box)];
    if (
      crop &&
      validReferences &&
      boxes.every(
        (b) =>
          b &&
          [b.x, b.y, b.width, b.height].every(Number.isFinite) &&
          b.x >= 0 &&
          b.y >= 0 &&
          b.width > 0 &&
          b.height > 0 &&
          b.x + b.width <= 1.001 &&
          b.y + b.height <= 1.001,
      )
    ) {
      const proposed = boxes
        .map((b) => ({
          top: Math.max(0, Math.floor((b!.y - 0.025) * height)),
          bottom: Math.min(
            height,
            Math.ceil((b!.y + b!.height + 0.025) * height),
          ),
        }))
        .sort((a, b) => a.top - b.top);
      const merged: typeof ranges = [];
      for (const band of proposed) {
        const previous = merged.at(-1);
        if (previous && band.top <= previous.bottom + 12)
          previous.bottom = Math.max(previous.bottom, band.bottom);
        else merged.push({ ...band });
      }
      // Dense pages stay intact; avoid extra complexity for negligible savings.
      if (merged.reduce((n, b) => n + b.bottom - b.top, 0) < height * 0.75)
        ranges = merged;
    }
    let imageHeight = 0;
    const bands = ranges.map((r) => {
      const band = {
        top: r.top,
        height: r.bottom - r.top,
        outputTop: imageHeight,
      };
      imageHeight += band.height;
      return band;
    });
    const png =
      bands.length === 1 && imageHeight === height
        ? source.data
        : await sharp({
            create: {
              width,
              height: imageHeight,
              channels: 3,
              background: "white",
            },
          })
            .composite(
              await Promise.all(
                bands.map(async (b) => ({
                  input: await sharp(source.data)
                    .extract({ left: 0, top: b.top, width, height: b.height })
                    .png()
                    .toBuffer(),
                  top: b.outputTop,
                  left: 0,
                })),
              ),
            )
            .png()
            .toBuffer();
    images.push({
      png,
      page: pageNumber,
      sourceHeight: height,
      imageHeight,
      bands,
    });
  }
  return images;
}

/** Model coordinates refer to the supplied image; only code translates them. */
export function restoreTerraCoordinates(
  output: FallbackOutput,
  images: TerraImage[],
) {
  for (const line of output.lines) {
    const image = images.find((i) => i.page === line.page);
    if (!image) throw Error("Terra returned a page that was not supplied.");
    const top = line.box.y * image.imageHeight;
    const bottom = (line.box.y + line.box.height) * image.imageHeight;
    const band = image.bands.find(
      (b) => top >= b.outputTop - 0.5 && bottom <= b.outputTop + b.height + 0.5,
    );
    if (!band)
      throw Error(
        "Terra row crosses a cropped section boundary. Review manually.",
      );
    line.box.y = (band.top + top - band.outputTop) / image.sourceHeight;
    line.box.height *= image.imageHeight / image.sourceHeight;
  }
  return output;
}

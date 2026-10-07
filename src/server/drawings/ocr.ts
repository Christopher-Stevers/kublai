export const MAX_DRAWING_OCR_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_DRAWING_OCR_PIXELS = 20_000_000;

/** Convert bounded TSV output to the original sheet's normalized coordinates. */
export function drawingOcrWords(
  tsv: string,
  geometry: {
    sheetWidth: number;
    sheetHeight: number;
    left: number;
    top: number;
    cropWidth: number;
    cropHeight: number;
    rasterWidth: number;
    rasterHeight: number;
  },
) {
  const g = geometry;
  const scaleX = g.cropWidth / g.rasterWidth,
    scaleY = g.cropHeight / g.rasterHeight;
  return tsv
    .split("\n")
    .slice(1)
    .flatMap((line) => {
      const cells = line.split("\t");
      const confidence = Number(cells[10]);
      if (
        cells[0] !== "5" ||
        !cells[11]?.trim() ||
        !Number.isFinite(confidence) ||
        confidence < 25
      )
        return [];
      const [x, y, width, height] = [
        cells[6],
        cells[7],
        cells[8],
        cells[9],
      ].map(Number);
      if (
        ![x, y, width, height].every(
          (value) => Number.isFinite(value) && value! >= 0,
        ) ||
        !width ||
        !height
      )
        return [];
      const left = Math.max(
        0,
        Math.min(1, (g.left + x! * scaleX) / g.sheetWidth),
      );
      const top = Math.max(
        0,
        Math.min(1, (g.top + y! * scaleY) / g.sheetHeight),
      );
      const right = Math.max(
        0,
        Math.min(1, (g.left + (x! + width) * scaleX) / g.sheetWidth),
      );
      const bottom = Math.max(
        0,
        Math.min(1, (g.top + (y! + height) * scaleY) / g.sheetHeight),
      );
      if (right <= left || bottom <= top) return [];
      return [
        {
          text: cells.slice(11).join("\t").trim().slice(0, 4000),
          left,
          top,
          right,
          bottom,
        },
      ];
    })
    .slice(0, 10_000);
}

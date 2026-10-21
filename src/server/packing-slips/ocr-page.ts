/** OCR of one page image, shared by the extract worker and the benchmark. */
import sharp from "sharp";
import {
  mergeWords,
  tsvWords,
  wordRows,
  type SlipRow,
  type SlipWord,
} from "./ocr-rows";
import { QUANTITY, readSlipTable, zones } from "./read-table";

export type Tesseract = (args: string[], input: Buffer) => Promise<string>;
type Image = { data: Buffer; info: sharp.OutputInfo };

const SCALE = 2;
const ZERO = /^[[({<c]?[©®@oOØQD0]?[\])}>]?$/;
const CLEAN = /^-?\d{1,6}(?:[.,]\d{1,3})?$/;
const tsv = (psm: string, extra: string[] = []) => [
  "stdin",
  "stdout",
  "-l",
  "eng",
  "--psm",
  psm,
  ...extra,
  "tsv",
];

/** `earlier` holds rows of previous pages, whose table layout carries over. */
export async function ocrPage(
  png: Buffer,
  page: number,
  tesseract: Tesseract,
  earlier: SlipRow[] = [],
): Promise<SlipRow[]> {
  const image = await sharp(png, { limitInputPixels: 24_000_000 })
    .rotate()
    .resize({
      width: 2400,
      height: 3200,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "white" })
    .png()
    .toBuffer({ resolveWithObject: true });
  const read = async (psm: string) =>
    tsvWords(
      await tesseract(tsv(psm), image.data),
      image.info.width,
      image.info.height,
    );
  const block = await read("6");
  const sparse = await read("11");
  const rows = wordRows(mergeWords(block, sparse), page);
  await rereadCells(image, rows, page, tesseract, earlier).catch(
    () => undefined,
  );
  return rows;
}

/** Page OCR drops lone digits in wide table gaps and garbles some (0 as ©).
 * Once the table's columns are known, each empty or unclear quantity cell is
 * cut out, the cuts are stacked into one strip, and the strip is read once
 * with digits only. A cell still empty afterwards really is blank. */
async function rereadCells(
  image: Image,
  rows: SlipRow[],
  page: number,
  tesseract: Tesseract,
  earlier: SlipRow[],
) {
  const { width: W, height: H } = image.info;
  const table = readSlipTable([...earlier, ...rows]);
  const slots: Array<{
    row: SlipRow;
    left: number;
    top: number;
    width: number;
    height: number;
  }> = [];
  for (const line of table.lines) {
    if (line.page !== page) continue;
    const h = Math.max(...line.row.words.map((w) => w.height));
    const y = Math.min(...line.row.words.map((w) => w.y));
    for (const zone of zones(line.layout.columns)) {
      if (!QUANTITY.includes(zone.column.field)) continue;
      const cell = line.cells[zone.column.field] ?? [];
      if (cell.some((w) => CLEAN.test(w.text) && w.confidence >= 75)) continue;
      const left = Math.max(0, zone.left, zone.column.left - 0.08),
        right = Math.min(1, zone.right, zone.column.right + 0.08);
      const top = Math.max(0, y - h * 0.35),
        bottom = Math.min(1, y + h * 1.35);
      const box = {
        left: Math.round(left * W),
        top: Math.round(top * H),
        width: Math.round((right - left) * W),
        height: Math.round((bottom - top) * H),
      };
      if (box.width < 4 || box.height < 4) continue;
      if (box.left + box.width > W) box.width = W - box.left;
      if (box.top + box.height > H) box.height = H - box.top;
      slots.push({ row: line.row, ...box });
    }
  }
  if (!slots.length || slots.length > 300) return;
  const gap = 24,
    stripWidth = Math.max(...slots.map((s) => s.width)) + gap * 2;
  let cursor = gap;
  const placed = slots.map((s) => {
    const at = cursor;
    cursor += s.height + gap;
    return { ...s, at };
  });
  const strip = await sharp({
    create: {
      width: stripWidth,
      height: cursor,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite(
      await Promise.all(
        placed.map(async (s) => ({
          input: await sharp(image.data)
            .extract({
              left: s.left,
              top: s.top,
              width: s.width,
              height: s.height,
            })
            .toBuffer(),
          left: gap,
          top: s.at,
        })),
      ),
    )
    .png()
    .toBuffer();
  // Read twice, digits only and unrestricted; keep a value only when both
  // agree, so a dotted zero forced into "9" or "8" is never taken.
  const big = await sharp(strip)
    .resize({ width: stripWidth * SCALE })
    .png()
    .toBuffer();
  const readStrip = async (extra: string[]) =>
    tsvWords(
      await tesseract(tsv("6", extra), big),
      stripWidth * SCALE,
      cursor * SCALE,
    );
  const digits = await readStrip([
    "-c",
    "tessedit_char_whitelist=0123456789.,-",
  ]);
  const free = await readStrip([]);
  const inSlot = (words: SlipWord[], s: (typeof placed)[number]) =>
    words.filter((w) => {
      const mid = (w.y + w.height / 2) * cursor;
      return mid >= s.at && mid < s.at + s.height;
    });
  for (const s of placed) {
    const a = inSlot(digits, s),
      b = inSlot(free, s);
    if (a.length !== 1 || b.length !== 1) continue;
    const value = a[0]!;
    // A dotted or slashed zero reads as ©, [} or c] without the whitelist.
    const plain = ZERO.test(b[0]!.text)
      ? "0"
      : b[0]!.text.replace(/[©®@oOØQD]/g, "0").replace(/[lI|]/g, "1");
    if (
      !CLEAN.test(value.text) ||
      value.text !== plain ||
      Math.min(value.confidence, b[0]!.confidence) < 50
    )
      continue;
    // Back to page coordinates.
    const word: SlipWord = {
      text: value.text,
      confidence: Math.max(value.confidence, b[0]!.confidence),
      x: (s.left + value.x * stripWidth - gap) / W,
      y: (s.top + value.y * cursor - s.at) / H,
      width: (value.width * stripWidth) / W,
      height: (value.height * cursor) / H,
    };
    // The digits replace whatever unclear marks were read in this cell.
    const inCell = (w: SlipWord) => {
      const mid = (w.x + w.width / 2) * W;
      return (
        mid >= s.left && mid < s.left + s.width && !/[a-z]{2}/i.test(w.text)
      );
    };
    s.row.words = [...s.row.words.filter((w) => !inCell(w)), word].sort(
      (a, b) => a.x - b.x,
    );
    s.row.text = s.row.words
      .map((w) => w.text)
      .join(" ")
      .slice(0, 700);
  }
}

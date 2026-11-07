/** Conservative vertical page dewarping from repeated printed table baselines.
 * OCR provides geometry only: no characters or quantities are replaced. */
import sharp from "sharp";
import type { SlipWord } from "./ocr-rows";
export type WarpAnchor = {
  y: number;
  points: Array<{ x: number; offset: number }>;
};
export type PageWarp = { anchors: WarpAnchor[]; maxOffset: number };
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
export function estimatePageWarp(words: SlipWord[]): PageWarp | null {
  const numbers = words
    .filter(
      (w) =>
        w.confidence >= 80 &&
        /^\d{1,4}[.,]\d{2}$/.test(w.text) &&
        w.height > 0.003 &&
        w.height < 0.025 &&
        w.width < 0.1,
    )
    .sort((a, b) => a.y - b.y);
  const groups: SlipWord[][] = [];
  for (const w of numbers) {
    const group = groups.find(
      (g) =>
        Math.abs(
          median(g.map((v) => v.y + v.height / 2)) - (w.y + w.height / 2),
        ) < Math.min(0.018, median(g.map((v) => v.height)) * 1.8) &&
        g.every((v) => Math.abs(v.x - w.x) > 0.025),
    );
    if (group) group.push(w);
    else groups.push([w]);
  }
  const anchors: WarpAnchor[] = [];
  for (const group of groups) {
    group.sort((a, b) => a.x - b.x);
    if (group.length < 3 || group.at(-1)!.x - group[0]!.x < 0.13) continue;
    const h = median(group.map((w) => w.height));
    if (group.some((w) => w.height < h * 0.65 || w.height > h * 1.5)) continue;
    const baseline = median(group.map((w) => w.y + w.height));
    const code = words
      .filter(
        (w) =>
          w.confidence >= 80 &&
          w.x < group[0]!.x - 0.1 &&
          /[A-Z]/i.test(w.text) &&
          /\d/.test(w.text) &&
          /^[A-Z0-9][A-Z0-9./-]{4,}$/i.test(w.text) &&
          Math.abs(w.y + w.height - baseline) < h * 1.5,
      )
      .sort(
        (a, b) =>
          Math.abs(a.y + a.height - baseline) -
          Math.abs(b.y + b.height - baseline),
      )[0];
    if (code) group.unshift(code);
    const points = group.map((w) => ({
      x: w.x + w.width / 2,
      offset: w.y + w.height - baseline,
    }));
    if (
      points.some(
        (p, i) =>
          Math.abs(p.offset) > 0.018 ||
          (i > 0 &&
            Math.abs(p.offset - points[i - 1]!.offset) /
              (p.x - points[i - 1]!.x) >
              0.18),
      )
    )
      continue;
    anchors.push({ y: baseline, points });
  }
  anchors.sort((a, b) => a.y - b.y);
  if (anchors.length < 3 || anchors.at(-1)!.y - anchors[0]!.y < 0.08)
    return null;
  // Require recurring columns and consistent displacement; an isolated bad OCR
  // box, handwritten number or total must not bend the page.
  const reliable = anchors.filter((a) =>
    anchors.some(
      (b) =>
        a !== b &&
        Math.abs(a.y - b.y) < 0.2 &&
        a.points.filter((p) =>
          b.points.some(
            (q) =>
              Math.abs(p.x - q.x) < 0.025 &&
              Math.abs(p.offset - q.offset) < 0.005,
          ),
        ).length >= 3,
    ),
  );
  if (reliable.length < 3) return null;
  for (let i = 1; i < reliable.length; i++) {
    const a = reliable[i - 1]!,
      b = reliable[i]!;
    if (
      [...a.points, ...b.points].some(
        (p) =>
          Math.abs(lineOffset(a, p.x) - lineOffset(b, p.x)) >
          (b.y - a.y) * 0.25,
      )
    )
      return null;
  }
  const maxOffset = Math.max(
    ...reliable.flatMap((a) => a.points.map((p) => Math.abs(p.offset))),
  );
  if (maxOffset < 0.0015) return null;
  return { anchors: reliable, maxOffset };
}
function lineOffset(anchor: WarpAnchor, x: number) {
  const p = anchor.points;
  if (x <= p[0]!.x) return p[0]!.offset;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1]!,
      b = p[i]!;
    if (x <= b.x)
      return a.offset + ((b.offset - a.offset) * (x - a.x)) / (b.x - a.x);
  }
  return p.at(-1)!.offset;
}
/** Inverse warp: output coordinate to original source coordinate. */
export function sourceY(warp: PageWarp, x: number, y: number) {
  const a = warp.anchors;
  let offset = lineOffset(a[0]!, x);
  if (y >= a.at(-1)!.y) offset = lineOffset(a.at(-1)!, x);
  else
    for (let i = 1; i < a.length; i++) {
      if (y <= a[i]!.y) {
        const p = a[i - 1]!,
          q = a[i]!;
        const t = Math.max(0, (y - p.y) / (q.y - p.y));
        offset = lineOffset(p, x) * (1 - t) + lineOffset(q, x) * t;
        break;
      }
    }
  // Fade at paper edges rather than shifting printed content off the canvas.
  const fade = Math.min(1, Math.max(0, y) / 0.04, Math.max(0, 1 - y) / 0.04);
  return y + offset * fade;
}
export function originalWord(warp: PageWarp, word: SlipWord): SlipWord {
  const xs = [
    word.x,
    word.x + word.width,
    ...warp.anchors
      .flatMap((a) => a.points.map((p) => p.x))
      .filter((x) => x > word.x && x < word.x + word.width),
  ];
  const ys = xs.flatMap((x) => [
    sourceY(warp, x, word.y),
    sourceY(warp, x, word.y + word.height),
  ]);
  const y = Math.max(0, Math.min(...ys));
  return { ...word, y, height: Math.min(1, Math.max(...ys)) - y };
}
/** Prepare one source row at a time, reusing the two adjacent anchor offsets.
 * Memory is O(width), and arithmetic order matches sourceY exactly. */
export function prepareSourceRows(
  warp: PageWarp,
  width: number,
  height: number,
) {
  let previous = -2;
  let lower = new Float64Array(width),
    upper = new Float64Array(width);
  const row = new Float64Array(width);
  const offsets = (index: number) =>
    Float64Array.from({ length: width }, (_, x) =>
      lineOffset(warp.anchors[index]!, x / (width - 1)),
    );
  return (y: number) => {
    const yn = y / (height - 1),
      anchors = warp.anchors;
    let index = anchors.length - 1;
    for (let i = 1; i < anchors.length; i++) {
      if (yn < anchors.at(-1)!.y && yn <= anchors[i]!.y) {
        index = i - 1;
        break;
      }
    }
    const interpolate = yn < anchors.at(-1)!.y && anchors.length > 1;
    if (index !== previous) {
      lower = index === previous + 1 ? upper : offsets(index);
      upper = interpolate ? offsets(index + 1) : lower;
      previous = index;
    }
    const t = interpolate
      ? Math.max(
          0,
          (yn - anchors[index]!.y) /
            (anchors[index + 1]!.y - anchors[index]!.y),
        )
      : 0;
    const fade = Math.min(
      1,
      Math.max(0, yn) / 0.04,
      Math.max(0, 1 - yn) / 0.04,
    );
    for (let x = 0; x < width; x++) {
      const offset = interpolate
        ? lower[x]! * (1 - t) + upper[x]! * t
        : lower[x]!;
      row[x] = yn + offset * fade;
    }
    return row;
  };
}
export async function dewarpPage(png: Buffer, warp: PageWarp): Promise<Buffer> {
  const { data, info } = await sharp(png, { limitInputPixels: 24_000_000 })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const output = Buffer.from(data);
  if (width < 2 || height < 2)
    return sharp(output, { raw: info }).png().toBuffer();
  const sourceRow = prepareSourceRows(warp, width, height);
  // Resample original pixels once using linear interpolation; no generated content.
  for (let y = 0; y < height; y++) {
    const coordinates = sourceRow(y);
    for (let x = 0; x < width; x++) {
      const sy = coordinates[x]! * (height - 1);
      const y0 = Math.floor(sy),
        t = sy - y0;
      if (y0 < 0 || y0 >= height - 1) continue;
      const a = (y0 * width + x) * channels,
        b = a + width * channels,
        o = (y * width + x) * channels;
      for (let c = 0; c < channels; c++)
        output[o + c] = Math.round(data[a + c]! * (1 - t) + data[b + c]! * t);
    }
  }
  return sharp(output, { raw: info }).png().toBuffer();
}

/** Cheap checks on a photographed or scanned page, so the reviewer hears
 * about a blurry or dark picture before trusting what was read from it. */
import sharp from "sharp";

const SHARP_MIN = 1;

export type PageQuality = {
  sharpness: number;
  brightness: number;
  contrast: number;
};

export async function measurePage(png: Buffer): Promise<PageQuality> {
  const { data, info } = await sharp(png, { limitInputPixels: 60_000_000 })
    .rotate()
    .flatten({ background: "white" })
    .greyscale()
    .resize({
      width: 1200,
      height: 1200,
      fit: "inside",
      withoutEnlargement: true,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width,
    h = info.height,
    n = w * h;
  // Paper is the median shade, ink the darkest 1%: most of a slip is blank.
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < n; i++) hist[data[i]!]!++;
  const shade = (q: number) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) if ((seen += hist[v]!) >= q * n) return v;
    return 255;
  };
  const brightness = shade(0.5),
    contrast = brightness - shade(0.01);
  let sum = 0,
    sq = 0;
  for (let i = 0; i < n; i++) {
    sum += data[i]!;
    sq += data[i]! ** 2;
  }
  const spread = Math.sqrt(Math.max(1, sq / n - (sum / n) ** 2));
  // Edge strength where there is ink: the 99th percentile of the Laplacian,
  // relative to the page's spread of shades, so a pale but sharp page is not
  // called blurry. Calibrated on phone scans: sharp pages 2.9–6.1, the same
  // pages blurred by 3 px 0.4–0.8.
  const lap = new Uint32Array(1021);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      lap[
        Math.abs(
          4 * data[i]! -
            data[i - 1]! -
            data[i + 1]! -
            data[i - w]! -
            data[i + w]!,
        )
      ]!++;
    }
  const total = (w - 2) * (h - 2);
  let p99 = 0;
  for (let v = 0, seen = 0; v < lap.length; v++)
    if ((seen += lap[v]!) >= 0.99 * total) {
      p99 = v;
      break;
    }
  return { sharpness: p99 / spread, brightness, contrast };
}

export function qualityWarnings(page: number, q: PageQuality) {
  const out: string[] = [];
  if (q.brightness < 90)
    out.push(
      `Page ${page} looks too dark to read reliably. Check the numbers against the paper slip, or scan it again in better light.`,
    );
  else if (q.contrast < 60)
    out.push(
      `Page ${page} looks faded or washed out. Check the numbers against the paper slip.`,
    );
  if (q.sharpness < SHARP_MIN)
    out.push(
      `Page ${page} looks blurry. Check the numbers against the paper slip, or scan it again holding the phone still.`,
    );
  return out;
}

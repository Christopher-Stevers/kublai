/** Rows of type found from where a page's printed ink lies. The OCR misses
 * table rows on blurry photos, under highlighter and on busy forms, but each
 * row of type still darkens the page in a band, and that band starts where
 * the type does. */
import sharp from "sharp";

type Edges = { top: number; bottom: number; left: number; right: number };
type Span = { left: number; right: number };

export type InkRow = {
  /** Where the row's type starts, as a fraction of the page height. */
  y: number;
  /** Its ink in the quantity columns, as a share of the page's typical
   * row's: about 1 for a line's first row, about half for wrapped text or a
   * note, and 0 with no columns given. */
  quantity: number;
};

const WIDTH = 1000,
  STRIPS = 8,
  /** A row of type rises at least this share of the darkest row above the
   * gaps either side of it. */
  PROMINENCE = 0.05,
  /** A row dark across this share of the width is a ruled line, bent or
   * not, since type has gaps between words and columns; a bin counts as dark
   * at SPREAD of its darkest bins. */
  RULED = 0.8,
  SPREAD = 0.3;

const percentile = (values: number[], p: number) => {
  const v = [...values].sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * p))]! : 0;
};

function smooth(values: number[], sigma: number) {
  const reach = Math.ceil(3 * sigma);
  const weights = Array.from({ length: 2 * reach + 1 }, (_, k) =>
    Math.exp(-((k - reach) ** 2) / (2 * sigma * sigma)),
  );
  return values.map((_, i) => {
    let sum = 0,
      total = 0;
    weights.forEach((w, k) => {
      const v = values[i + k - reach];
      if (v === undefined) return;
      sum += w * v;
      total += w;
    });
    return sum / total;
  });
}

/** Rows of type in `region` of a page, top to bottom. `quantity` is where
 * the quantity columns are. */
export async function inkRows(
  png: Buffer,
  region: Edges,
  quantity: Span[],
): Promise<InkRow[]> {
  const { data, info } = await sharp(png)
    .removeAlpha()
    .resize({ width: WIDTH })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const x0 = Math.max(0, Math.floor(region.left * W)),
    x1 = Math.min(W, Math.ceil(region.right * W)),
    y0 = Math.max(0, Math.floor(region.top * H)),
    y1 = Math.min(H, Math.ceil(region.bottom * H));
  if (x1 - x0 < STRIPS * 4 || y1 - y0 < 8) return [];
  // The brightest channel: highlighter and most coloured pen all but vanish
  // from it, and print stays dark.
  const shade = (x: number, y: number) => {
    const i = (y * W + x) * C;
    let v = data[i]!;
    for (let c = 1; c < C; c++) v = Math.max(v, data[i + c]!);
    return v;
  };
  const strip = (x: number) =>
    Math.min(STRIPS - 1, Math.floor(((x - x0) * STRIPS) / (x1 - x0)));
  // Paper is the bright end of each strip of each pixel row, steadied over
  // the nearby rows: shadows and tints change slowly across a page.
  const bright = Array.from({ length: y1 - y0 }, (_, k) => {
    const strips = Array.from({ length: STRIPS }, () => [] as number[]);
    for (let x = x0; x < x1; x++) strips[strip(x)]!.push(shade(x, y0 + k));
    return strips.map((s) => percentile(s, 0.8));
  });
  const reach = Math.max(2, Math.round(H * 0.009));
  const paper = bright.map((_, k) =>
    Array.from({ length: STRIPS }, (_, s) =>
      percentile(
        bright
          .slice(Math.max(0, k - reach), k + reach + 1)
          .map((row) => row[s]!),
        0.7,
      ),
    ),
  );
  // Darkness in narrow bins across each pixel row. What darkens the whole
  // row alike, a rule, a fold or the edge of a shadow, is taken off: type
  // has gaps between words and columns, so it stands above that floor.
  const BIN = Math.max(2, Math.round(W * 0.005)),
    bins = Math.max(1, Math.floor((x1 - x0) / BIN));
  const inQuantity = Array.from({ length: bins }, (_, b) => {
    const x = (x0 + (b + 0.5) * BIN) / W;
    return quantity.some((q) => x >= q.left && x <= q.right);
  });
  const excess = Array.from({ length: y1 - y0 }, (_, k) => {
    const y = y0 + k,
      v = new Array<number>(bins).fill(0);
    let dark = 0;
    for (let b = 0; b < bins; b++) {
      let sum = 0;
      for (let x = x0 + b * BIN; x < x0 + (b + 1) * BIN; x++) {
        const p = paper[k]![strip(x)]!;
        const ink = Math.max(
          0,
          Math.min(1, (p - shade(x, y)) / Math.max(1, p)),
        );
        sum += ink;
        if (ink > 0.3) dark++;
      }
      v[b] = sum / BIN;
    }
    // A sharp ruled line is no row of type.
    if (dark > (bins * BIN) / 2) return null;
    const floor = percentile(v, 0.25);
    return v.map((x) => Math.max(0, x - floor));
  });
  // How dark each pixel row is, apart from the quantity columns and in them;
  // a ruled line takes the lighter of the rows either side.
  const mean = (row: number[] | null, inColumns: boolean) => {
    if (!row) return NaN;
    let sum = 0,
      n = 0;
    row.forEach((x, b) => {
      if (inQuantity[b] !== inColumns) return;
      sum += x;
      n++;
    });
    return sum / Math.max(1, n);
  };
  const text = excess.map((row) => mean(row, false)),
    counts = excess.map((row) => mean(row, true));
  const filled = (values: number[]) =>
    values.map((v, i) => {
      if (!Number.isNaN(v)) return v;
      let l = i - 1,
        r = i + 1;
      while (l >= 0 && Number.isNaN(values[l]!)) l--;
      while (r < values.length && Number.isNaN(values[r]!)) r++;
      const near = Math.min(values[l] ?? Infinity, values[r] ?? Infinity);
      return Number.isFinite(near) ? near : 0;
    });
  const sigma = Math.max(1, H * 0.0015);
  const d = smooth(filled(text), sigma),
    q = smooth(filled(counts), sigma);
  const darkest = Math.max(...d);
  if (!(darkest > 0)) return [];
  const found: Array<{ y: number; ink: number }> = [];
  const window = Math.round(H * 0.006);
  // How much of the width a row's darkness spans, near its peak.
  const near = Math.max(2, Math.round(H * 0.003));
  const cover = (i: number) => {
    const v = new Array<number>(bins).fill(0);
    for (
      let k = Math.max(0, i - near);
      k <= Math.min(excess.length - 1, i + near);
      k++
    )
      excess[k]?.forEach((x, b) => (v[b] = Math.max(v[b]!, x)));
    const top = percentile(v, 0.9);
    return top > 0 ? v.filter((x) => x >= top * SPREAD).length / bins : 0;
  };
  for (let i = 1; i < d.length - 1; i++) {
    if (!(d[i]! >= d[i - 1]! && d[i]! > d[i + 1]!)) continue;
    let l = i,
      r = i;
    while (l > 0 && d[l - 1]! <= d[l]!) l--;
    while (r < d.length - 1 && d[r + 1]! <= d[r]!) r++;
    if (d[i]! - Math.max(d[l]!, d[r]!) < darkest * PROMINENCE) continue;
    // The type starts where the darkness rises halfway from the gap above.
    const half = (d[l]! + d[i]!) / 2;
    let e = i;
    while (e > l && d[e - 1]! >= half) e--;
    const y = e > l ? e - 1 + (half - d[e - 1]!) / (d[e]! - d[e - 1]!) : e;
    let ink = 0;
    for (let j = Math.max(l, i - window); j <= Math.min(r, i + window); j++)
      ink = Math.max(ink, q[j]!);
    if (cover(i) >= RULED) continue;
    found.push({ y: (y0 + y) / H, ink });
  }
  // Blur and faint ribbon lighten every row alike, so a row's quantity ink
  // is weighed against the page's typical row.
  const typical = percentile(
    found.map((f) => f.ink),
    0.5,
  );
  return found.map((f) => ({
    y: f.y,
    quantity: typical > 0 ? f.ink / typical : 0,
  }));
}

export type SlipWord = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
};
export type SlipRow = { page: number; text: string; words: SlipWord[] };
export function tsvWords(
  tsv: string,
  width: number,
  height: number,
): SlipWord[] {
  return tsv
    .split("\n")
    .slice(1)
    .flatMap((line) => {
      const c = line.split("\t"),
        confidence = Number(c[10]),
        text = c.slice(11).join(" ").trim();
      if (
        c[0] !== "5" ||
        !text ||
        !Number.isFinite(confidence) ||
        confidence < 0
      )
        return [];
      const [x, y, w, h] = c.slice(6, 10).map(Number);
      if (![x, y, w, h].every((n) => Number.isFinite(n) && n! >= 0)) return [];
      return [
        {
          text: text.slice(0, 100),
          x: x! / width,
          y: y! / height,
          width: w! / width,
          height: h! / height,
          confidence,
        },
      ];
    });
}
/** Page slope from neighbouring words on the same line, so rows of a
 * slightly rotated scan are not split in two. */
export function skew(words: SlipWord[]) {
  const slopes: number[] = [];
  for (const w of words) {
    const right = w.x + w.width;
    let best: SlipWord | null = null;
    for (const v of words)
      if (
        v !== w &&
        v.x >= right &&
        v.x - right < 0.08 &&
        Math.abs(v.y + v.height / 2 - (w.y + w.height / 2)) <
          Math.max(w.height, v.height) * 0.8 &&
        (!best || v.x < best.x)
      )
        best = v;
    if (!best) continue;
    const dx = best.x + best.width / 2 - (w.x + w.width / 2);
    if (dx > 0.01) slopes.push((best.y + best.height - (w.y + w.height)) / dx);
  }
  if (slopes.length < 5) return 0;
  slopes.sort((a, b) => a - b);
  const median = slopes[Math.floor(slopes.length / 2)]!;
  return Math.abs(median) < 0.05 ? median : 0;
}
export function wordRows(words: SlipWord[], page: number): SlipRow[] {
  const slope = skew(words);
  const level = (w: SlipWord) =>
    w.y + w.height / 2 - slope * (w.x + w.width / 2);
  const rows: SlipWord[][] = [];
  for (const w of [...words].sort((a, b) => level(a) - level(b) || a.x - b.x)) {
    const row = rows.find(
      (r) =>
        Math.abs(level(r[0]!) - level(w)) <
        Math.max(r[0]!.height, w.height) * 0.55,
    );
    if (row) row.push(w);
    else rows.push([w]);
  }
  // Halves of one line read a little apart (numbers from the sparse pass,
  // a slight curl in the paper) join up when they sit side by side.
  const mid = (r: SlipWord[]) => r.reduce((s, w) => s + level(w), 0) / r.length;
  const tall = (r: SlipWord[]) => Math.max(...r.map((w) => w.height));
  rows.sort((a, b) => mid(a) - mid(b));
  for (let i = 0; i + 1 < rows.length; ) {
    const a = rows[i]!,
      b = rows[i + 1]!;
    const apart = !a.some((w) =>
      b.some((v) => w.x < v.x + v.width && v.x < w.x + w.width),
    );
    if (apart && mid(b) - mid(a) < Math.min(tall(a), tall(b)) * 0.8) {
      a.push(...b);
      rows.splice(i + 1, 1);
    } else i++;
  }
  return rows.map((words) => ({
    page,
    words: words.sort((a, b) => a.x - b.x),
    text: words
      .map((w) => w.text)
      .join(" ")
      .slice(0, 700),
  }));
}
const overlap = (a: SlipWord, b: SlipWord) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.width * a.height, b.width * b.height);
};
const NUMBER = /^-?\d{1,6}(?:[.,]\d{1,3})?$/;
/** Block OCR (psm 6) skips lone digits in wide table gaps and misreads some
 * (0 as ©); a sparse-text pass (psm 11) finds them. Only numbers are taken
 * from it: where the first pass has nothing, or only a non-number. */
export function mergeWords(block: SlipWord[], sparse: SlipWord[]) {
  // Ruled lines and specks come out as short, very unsure "words".
  const out = block.filter((w) => w.confidence >= 45 || w.text.length > 3);
  for (const s of sparse) {
    if (!NUMBER.test(s.text) || s.confidence < 60) continue;
    const hits = out.filter((w) => overlap(w, s) > 0.2);
    if (!hits.length) out.push(s);
    // A short non-number in the same place (©, §, ], 1e) is a misread digit.
    else if (
      hits.length === 1 &&
      hits[0]!.text.length <= 3 &&
      !NUMBER.test(hits[0]!.text)
    )
      out[out.indexOf(hits[0]!)] = s;
  }
  return out;
}

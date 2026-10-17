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
export function wordRows(words: SlipWord[], page: number): SlipRow[] {
  const rows: SlipWord[][] = [];
  for (const w of words.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find(
      (r) =>
        Math.abs(r[0]!.y + r[0]!.height / 2 - (w.y + w.height / 2)) <
        Math.max(r[0]!.height, w.height) * 0.55,
    );
    if (row) row.push(w);
    else rows.push([w]);
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

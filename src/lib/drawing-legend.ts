import { z } from "zod";
import type { TitleBlockWord } from "./drawing-title-block";
export const legendBoxSchema = z
  .object({
    left: z.number().min(0).max(1),
    top: z.number().min(0).max(1),
    right: z.number().min(0).max(1),
    bottom: z.number().min(0).max(1),
  })
  .refine(
    (b) => b.right > b.left && b.bottom > b.top,
    "Choose a nonempty symbol area.",
  );
export type LegendBox = z.infer<typeof legendBoxSchema>;
export const legendItemSchema = z
  .object({
    name: z.string().trim().min(1).max(300),
    abbreviation: z.string().trim().max(80).default(""),
    category: z.string().trim().max(100).default(""),
    symbol: legendBoxSchema,
    row: legendBoxSchema,
  })
  .refine(
    (v) =>
      v.symbol.left >= v.row.left &&
      v.symbol.right <= v.row.right &&
      v.symbol.top >= v.row.top &&
      v.symbol.bottom <= v.row.bottom,
    "Keep the symbol inside its legend row.",
  );
export type LegendItemData = z.infer<typeof legendItemSchema>;
export type LegendLine = { x1: number; y1: number; x2: number; y2: number };
const near = (a: number, b: number) => Math.abs(a - b) < 0.001;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const join = (words: TitleBlockWord[]) =>
  words
    .sort((a, b) =>
      Math.abs(a.top - b.top) <
      Math.min(a.bottom - a.top, b.bottom - b.top) * 0.6
        ? a.left - b.left
        : a.top - b.top,
    )
    .map((w) => clean(w.text))
    .join(" ")
    .slice(0, 300);

/** Propose bordered or aligned legend rows beneath explicit legend headings.
 * Geometry/text are evidence, never confirmation that a detected item is correct.
 */
export function detectLegendItems(
  words: TitleBlockWord[],
  segments: LegendLine[],
) {
  words = words.slice(0, 50_000);
  segments = segments.slice(0, 250_000);
  const headings = words
    .filter(
      (w) =>
        /\b(?:LEGEND|SYMBOLS)\b/i.test(w.text) &&
        !/DRAWING LIST|REFER TO|SEE |NOTES|ABBREVIATIONS/i.test(w.text) &&
        w.text.length < 70,
    )
    .sort((a, b) =>
      Math.abs(a.top - b.top) < 0.01 ? a.left - b.left : a.top - b.top,
    )
    .slice(0, 24);
  const horizontal = segments
    .filter(
      (s) => Math.abs(s.y1 - s.y2) < 0.0001 && Math.abs(s.x1 - s.x2) > 0.025,
    )
    .map((s) => ({
      left: Math.min(s.x1, s.x2),
      right: Math.max(s.x1, s.x2),
      y: (s.y1 + s.y2) / 2,
    }));
  const vertical = segments
    .filter(
      (s) => Math.abs(s.x1 - s.x2) < 0.0001 && Math.abs(s.y1 - s.y2) > 0.005,
    )
    .map((s) => ({
      x: (s.x1 + s.x2) / 2,
      top: Math.min(s.y1, s.y2),
      bottom: Math.max(s.y1, s.y2),
    }));
  const items: LegendItemData[] = [],
    seen = new Set<string>();
  for (const heading of headings) {
    const border = horizontal
      .filter(
        (l) =>
          l.left <= heading.left &&
          l.right >= heading.right &&
          l.y <= heading.top &&
          heading.top - l.y < 0.02,
      )
      .sort((a, b) => b.y - a.y)[0];
    if (!border) continue;
    const nextHeading = headings
      .filter(
        (h) =>
          h.top > heading.bottom &&
          h.left >= border.left &&
          h.right <= border.right,
      )
      .sort((a, b) => a.top - b.top)[0];
    const rows = [
      ...new Set(
        horizontal
          .filter(
            (l) =>
              near(l.left, border.left) &&
              near(l.right, border.right) &&
              l.y > heading.bottom &&
              l.y < (nextHeading?.top ?? 1),
          )
          .map((l) => Math.round(l.y * 100000) / 100000),
      ),
    ].sort((a, b) => a - b);
    for (let i = 0; i < rows.length - 1; i++) {
      const top = rows[i]!,
        bottom = rows[i + 1]!;
      if (bottom - top > 0.06) break; // Never jump out of a legend into unrelated page content.
      if (bottom - top < 0.002) continue;
      const key = [border.left, top, border.right, bottom]
        .map((n) => n.toFixed(4))
        .join(":");
      if (seen.has(key)) continue;
      const divider = vertical
        .filter(
          (v) =>
            v.x > border.left + 0.003 &&
            v.x < border.left + (border.right - border.left) * 0.48 &&
            v.top <= top + 0.001 &&
            v.bottom >= bottom - 0.001,
        )
        .sort((a, b) => a.x - b.x)[0];
      if (!divider) continue;
      const rowWords = words.filter(
        (w) =>
          (w.top + w.bottom) / 2 > top &&
          (w.top + w.bottom) / 2 < bottom &&
          w.left >= border.left - 0.0002 &&
          w.right <= border.right + 0.0002,
      );
      const description = rowWords.filter((w) => w.left >= divider.x - 0.0002);
      const name = join(description);
      if (
        !name ||
        name.length < 3 ||
        /^(?:SYMBOL|DESCRIPTION|EXISTING|DEMOLITION|LEGEND)$/i.test(name)
      )
        continue;
      const symbolWords = rowWords.filter((w) => w.right < divider.x);
      const symbolText = join(symbolWords);
      const abbreviation =
        symbolText.length <= 24 && symbolText.split(" ").length <= 3
          ? symbolText
          : "";
      const inset = Math.min(0.00025, (bottom - top) * 0.03);
      const row = {
        left: Math.max(0, border.left),
        top: Math.max(0, top),
        right: Math.min(1, border.right),
        bottom: Math.min(1, bottom),
      };
      items.push({
        name,
        abbreviation,
        category: clean(heading.text).slice(0, 100),
        row,
        symbol: {
          left: row.left + inset,
          top: row.top + inset,
          right: divider.x - inset,
          bottom: row.bottom - inset,
        },
      });
      seen.add(key);
      if (items.length >= 300) return items;
    }
  }
  // Unbordered tables are common in consultant legends. Require either column
  // headings or a repeated symbol/description gap; do not guess from prose.
  for (const heading of headings) {
    const left = Math.max(0, heading.left - 0.08);
    const nextRight = headings
      .filter(
        (h) => h.left > heading.right && Math.abs(h.top - heading.top) < 0.06,
      )
      .sort((a, b) => a.left - b.left)[0];
    const right = Math.min(1, nextRight?.left ?? heading.right + 0.27);
    const nextBelow = words
      .filter(
        (w) =>
          w.top > heading.bottom &&
          w.left >= left &&
          w.left < right &&
          /\b(?:NOTES|SCHEDULE|LEGEND|ABBREVIATIONS)\b/i.test(w.text),
      )
      .sort((a, b) => a.top - b.top)[0];
    const bottom = Math.min(heading.bottom + 0.45, nextBelow?.top ?? 1);
    const region = words
      .filter(
        (w) =>
          w.top > heading.bottom &&
          w.bottom < bottom &&
          w.left >= left &&
          w.right <= right,
      )
      .sort((a, b) => a.top - b.top || a.left - b.left);
    const descriptionHeader = region.find(
      (w) =>
        /^DESCRIPTION$/i.test(w.text.trim()) && w.top - heading.bottom < 0.08,
    );
    const symbolHeader = region.find(
      (w) => /^SYMBOL$/i.test(w.text.trim()) && w.top - heading.bottom < 0.08,
    );
    const lines: TitleBlockWord[][] = [];
    for (const word of region) {
      const line = lines.find(
        (row) =>
          Math.abs(
            (row[0]!.top + row[0]!.bottom - word.top - word.bottom) / 2,
          ) <
          Math.min(row[0]!.bottom - row[0]!.top, word.bottom - word.top) * 0.55,
      );
      if (line) line.push(word);
      else lines.push([word]);
    }
    const candidates = lines
      .map((line) => {
        line.sort((a, b) => a.left - b.left);
        const gap = descriptionHeader
          ? line.findIndex((w) => w.left >= descriptionHeader.left - 0.003)
          : line.findIndex(
              (w, i) =>
                i > 0 &&
                w.left - line[i - 1]!.right > 0.012 &&
                join(line.slice(0, i)).length <= 24,
            );
        if (gap < 0 || (!descriptionHeader && gap === 0)) return null;
        const descriptions = line.slice(gap),
          name = join(descriptions);
        if (
          name.length < 3 ||
          /^(?:DESCRIPTION|SYMBOL|EXISTING|NEW|DEMOLITION)$/i.test(name)
        )
          return null;
        if (
          descriptionHeader &&
          descriptions[0]!.top <= descriptionHeader.bottom
        )
          return null;
        return {
          line,
          descriptions,
          name,
          symbolWords: line.slice(0, gap),
          x: descriptions[0]!.left,
          top: Math.min(...line.map((w) => w.top)),
          bottom: Math.max(...line.map((w) => w.bottom)),
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    if (candidates.length < 2) continue;
    const aligned = candidates.filter(
      (row) =>
        candidates.filter((other) => Math.abs(other.x - row.x) < 0.006)
          .length >= 2,
    );
    let previous = descriptionHeader?.bottom ?? heading.bottom;
    for (const row of aligned) {
      if (row.top - previous > 0.065) break;
      previous = row.bottom;
      if (
        items.some(
          (item) =>
            row.top >= item.row.top - 0.001 &&
            row.bottom <= item.row.bottom + 0.001 &&
            row.x >= item.row.left &&
            row.x <= item.row.right,
        )
      )
        continue;
      const x0 = Math.max(
          left,
          symbolHeader?.left ?? row.symbolWords[0]?.left ?? row.x - 0.06,
        ),
        x1 = row.x - 0.003;
      if (x1 - x0 < 0.006) continue;
      const h = row.bottom - row.top,
        padding = Math.min(0.004, h * 0.6);
      const bounds = {
        left: x0,
        top: Math.max(0, row.top - padding),
        right: Math.min(
          right,
          Math.max(...row.descriptions.map((w) => w.right)) + 0.003,
        ),
        bottom: Math.min(1, row.bottom + padding),
      };
      items.push({
        name: row.name,
        abbreviation: join(row.symbolWords).slice(0, 80),
        category: clean(heading.text).slice(0, 100),
        row: bounds,
        symbol: { ...bounds, right: x1 },
      });
      if (items.length >= 300) return items;
    }
  }
  return items;
}

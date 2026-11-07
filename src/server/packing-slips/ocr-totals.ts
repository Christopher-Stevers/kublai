import type { SlipLine } from "~/lib/packing-slip-review";
import type { SlipRow } from "./ocr-rows";

/** Only explicit, confidently printed document totals are comparable. No AI. */
export function ocrTotalsWarnings(rows: SlipRow[], lines: SlipLine[]) {
  const counts = new Set<number>();
  const totals = new Set<number>();
  for (const row of rows) {
    if (!row.words.length || row.words.some((w) => w.confidence < 85)) continue;
    const text = row.text.trim();
    const count =
      /^(\d+)\s+lines?\s+total\b/i.exec(text)?.[1] ??
      /\btotal\s+(?:lines|items)\s*[:=]?\s*(\d+)\b/i.exec(text)?.[1];
    const shipped = /\btotal\s+shipped\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*$/i.exec(
      text,
    )?.[1];
    if (count !== undefined) counts.add(Number(count));
    if (shipped !== undefined) totals.add(Number(shipped));
  }
  const warnings: string[] = [];
  if (counts.size === 1 && !counts.has(lines.length))
    warnings.push(
      "OCR line count does not match the printed total. Check for split or missing lines.",
    );
  if (
    totals.size === 1 &&
    lines.every((l) => l.shipped !== null) &&
    Math.abs([...totals][0]! - lines.reduce((sum, l) => sum + l.shipped!, 0)) >
      0.001
  )
    warnings.push(
      "OCR total shipped does not match the printed total. Check the quantity columns and rows.",
    );
  return warnings;
}

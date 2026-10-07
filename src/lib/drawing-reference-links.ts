import type { DrawingText } from "./drawing-text";
import type {
  DrawingEntity,
  DrawingJobSheet,
  DrawingSheetSummary,
} from "./drawing-workspace";
export type DrawingReference = {
  key: string;
  target: DrawingJobSheet;
  word: DrawingText;
  number: string;
};
export function findDrawingReferences(
  words: DrawingText[],
  sheets: DrawingJobSheet[],
  summaries: DrawingSheetSummary[],
  sourceSheetId: string,
  entities: DrawingEntity[],
): DrawingReference[] {
  const results: DrawingReference[] = [];
  for (const sheet of sheets) {
    if (sheet.id === sourceSheetId) continue;
    const explicit = summaries.find((row) => row.sheetId === sheet.id)?.metadata
      .number;
    const number = explicit?.trim()
      ? explicit.trim()
      : /\b[A-Z]{1,3}[-.]?\d{2,4}(?:\.\d{1,3})?[A-Z]?\b/i.exec(sheet.name)?.[0];
    if (!number) continue;
    // Exact sheet identifiers; A201 must never match A2010 or A201A.
    const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expression = new RegExp(
      `(^|[^a-z0-9])${escaped}(?![a-z0-9]|[.-]\\d)`,
      "i",
    );
    for (const word of words) {
      if (
        !expression.test(word.text) ||
        word.right <= word.left ||
        word.bottom <= word.top
      )
        continue;
      if (
        entities.some(
          (entity) =>
            entity.kind === "markup" &&
            entity.visibility !== "archived" &&
            entity.data.type === "link" &&
            entity.data.sourceSheetId === sourceSheetId &&
            entity.data.targetSheetId === sheet.id &&
            Math.abs((entity.data.points[0]?.x ?? -1) - word.left) < 0.002 &&
            Math.abs((entity.data.points[0]?.y ?? -1) - word.top) < 0.002,
        )
      )
        continue;
      results.push({
        key: `${sheet.id}:${word.left}:${word.top}`,
        target: sheet,
        word,
        number,
      });
      if (results.length >= 100) return results;
    }
  }
  return results;
}

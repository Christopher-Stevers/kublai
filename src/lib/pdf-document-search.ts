import type { TitleBlockWord } from "./drawing-title-block";

export type PdfTextSpan = { start: number; end: number; rect: TitleBlockWord };
export type PdfTextIndex = { text: string; spans: PdfTextSpan[] };
export type PdfSearchMatch = {
  page: number;
  offset: number;
  rects: TitleBlockWord[];
};
export const MAX_PDF_SEARCH_MATCHES = 10_000;

export function normalizePdfSearchText(text: string) {
  return text
    .normalize("NFKC")
    .replace(/\u00ad/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Preserve adjacent PDF text fragments so searching "valve" finds "val" + "ve". */
export function indexPdfText(
  words: Array<{ rect: TitleBlockWord; hasEOL?: boolean }>,
): PdfTextIndex {
  let text = "";
  const spans: PdfTextSpan[] = [];
  let previous: (typeof words)[number] | undefined;
  for (const word of words) {
    const value = normalizePdfSearchText(word.rect.text);
    if (!value) continue;
    if (previous) {
      const height = Math.max(0.001, previous.rect.bottom - previous.rect.top);
      const separate =
        previous.hasEOL === true ||
        /\s$/.test(previous.rect.text) ||
        /^\s/.test(word.rect.text) ||
        Math.abs(word.rect.top - previous.rect.top) > height * 0.5 ||
        word.rect.left - previous.rect.right > height * 0.15;
      if (separate) text += " ";
    }
    const start = text.length;
    text += value;
    spans.push({ start, end: text.length, rect: word.rect });
    previous = word;
  }
  return { text, spans };
}

export function findPdfPageMatches(
  index: PdfTextIndex,
  query: string,
  page: number,
  limit = MAX_PDF_SEARCH_MATCHES,
): PdfSearchMatch[] {
  const needle = normalizePdfSearchText(query);
  if (!needle) return [];
  const matches: PdfSearchMatch[] = [];
  let offset = index.text.indexOf(needle);
  while (offset >= 0 && matches.length < limit) {
    const end = offset + needle.length;
    let low = 0,
      high = index.spans.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (index.spans[middle]!.end <= offset) low = middle + 1;
      else high = middle;
    }
    const rects: TitleBlockWord[] = [];
    for (
      let i = low;
      i < index.spans.length && index.spans[i]!.start < end;
      i++
    )
      rects.push(index.spans[i]!.rect);
    matches.push({ page, offset, rects });
    offset = index.text.indexOf(needle, end);
  }
  return matches;
}

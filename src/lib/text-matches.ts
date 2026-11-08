import type { TitleBlockWord } from "./drawing-title-block";

/** Text on the page that contains the query, in reading order. */
export function textMatches(words: TitleBlockWord[], query: string) {
  const text = query.trim().toLocaleLowerCase();
  if (!text) return [];
  return words
    .filter((word) => word.text.toLocaleLowerCase().includes(text))
    .sort((a, b) => a.top - b.top || a.left - b.left);
}

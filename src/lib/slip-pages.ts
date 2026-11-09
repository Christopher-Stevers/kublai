/** Printed page numbers on a packing slip ("Page 1 of 3", "Page.1/3", "Pg1/3"). */
const PAGE =
  /\b(?:page|pg)\s*[.:#]?\s*(?:no\.?)?\s*[.:#]?\s*(\d{1,2})\s*(?:of|\/)\s*(\d{1,2})(?!\d)/gi;

export type SlipPages = { total: number; seen: number[]; missing: number[] };

/** One group per printed page total, so two slips in one scan are checked apart. */
export function slipPageNumbers(text: string): SlipPages[] {
  const groups = new Map<number, Set<number>>();
  for (const match of text.matchAll(PAGE)) {
    const page = Number(match[1]),
      total = Number(match[2]);
    if (page < 1 || page > total || total > 20) continue;
    if (!groups.has(total)) groups.set(total, new Set());
    groups.get(total)!.add(page);
  }
  return [...groups]
    .sort(([a], [b]) => a - b)
    .map(([total, seen]) => ({
      total,
      seen: [...seen].sort((a, b) => a - b),
      missing: Array.from({ length: total }, (_, i) => i + 1).filter(
        (page) => !seen.has(page),
      ),
    }));
}

/** "page 2", "pages 2, 3 and 4". */
export const list = (pages: number[]) =>
  pages.length === 1
    ? `page ${pages[0]}`
    : `pages ${pages.slice(0, -1).join(", ")} and ${pages.at(-1)}`;

/** A review keeps its slip text cut at this length, so later page numbers may be lost. */
export const SAVED_TEXT_LIMIT = 48000;

/** Text a review saved, when it is whole enough to say a page is missing. */
export const wholeSavedText = (text?: string | null) =>
  text && text.length < SAVED_TEXT_LIMIT ? text : null;

/** The review's saved text once the slip has been read, if whole. */
export const readSlipText = (
  review?: { sourceText?: string } | null,
  analysis?: { status: string } | null,
) =>
  analysis?.status === "processing" ? null : wholeSavedText(review?.sourceText);

/**
 * Groups with a numbered page not in the scan. With the scanned page count,
 * a misread number on a page that is there raises nothing.
 */
function missingGroups(text: string, scanned?: number) {
  const groups = slipPageNumbers(text);
  const short = groups.filter((group) => group.missing.length);
  if (
    scanned !== undefined &&
    scanned >= groups.reduce((n, group) => n + group.total, 0)
  )
    return [];
  return short;
}

/** A warning when the printed page numbers show a page that is not in the scan. */
export function missingPagesWarning(
  text: string,
  scanned?: number,
): string | null {
  const short = missingGroups(text, scanned);
  if (!short.length) return null;
  return short
    .map(
      ({ total, missing }) =>
        `The slip is numbered as ${total} pages, but ${list(missing)} ${missing.length === 1 ? "is" : "are"} not in this scan.`,
    )
    .concat("Scan every page so no lines are missed.")
    .join(" ");
}

/** The same, short enough for a list row: "Page 2 of 3 not scanned". */
export function missingPagesNote(text: string, scanned?: number) {
  const short = missingGroups(text, scanned);
  if (!short.length) return null;
  return short
    .map(({ total, missing }) => {
      const pages = list(missing);
      return `${pages[0]!.toUpperCase()}${pages.slice(1)} of ${total} not scanned`;
    })
    .join("; ");
}

/** The short note for a review, for queue rows and the material list. */
export function missingPagesAfterReading(
  review?: { sourceText?: string } | null,
  analysis?: { status: string } | null,
) {
  const text = readSlipText(review, analysis);
  return text ? missingPagesNote(text) : null;
}

/** The printed number of one captured page, when it shows a single one. */
export function capturedPageNumber(text: string) {
  const groups = slipPageNumbers(text);
  return groups.length === 1 && groups[0]!.seen.length === 1
    ? { page: groups[0]!.seen[0]!, total: groups[0]!.total }
    : null;
}

const pageWords = (text: string) =>
  new Set(text.toLowerCase().match(/[a-z0-9][a-z0-9.\/-]{2,}/g) ?? []);
/** Pages this alike in their words are the same page captured twice. */
const SAME_PAGE = 0.85;
const SAME_PAGE_WORDS = 30;

export type ScanCount = {
  /** The printed number of the last captured page. */
  last: { page: number; total: number } | null;
  /** The earlier capture, counted from 1, that the last one repeats. */
  repeats: number | null;
  /** Of the slip being captured, its printed page count and the pages not
   * captured yet. */
  total: number | null;
  missing: number[];
};

/**
 * What the pages captured so far say about the slip, from each page's text
 * (`undefined` while it is still being read, `null` when it could not be).
 */
export function scanCount(texts: Array<string | null | undefined>): ScanCount {
  const numbers = texts.map((t) => (t ? capturedPageNumber(t) : null));
  const last = numbers.at(-1) ?? null;
  // The slip being captured is the one the latest numbered page belongs to.
  const total = last?.total ?? numbers.filter(Boolean).at(-1)?.total ?? null;
  const seen = new Set(
    numbers.filter((n) => n?.total === total).map((n) => n!.page),
  );
  const missing = total
    ? Array.from({ length: total }, (_, i) => i + 1).filter((p) => !seen.has(p))
    : [];
  let repeats: number | null = null;
  const text = texts.at(-1);
  if (text && texts.length > 1) {
    const words = pageWords(text);
    for (let i = texts.length - 2; i >= 0 && repeats === null; i--) {
      const other = texts[i],
        number = numbers[i];
      if (!other) continue;
      if (last && number) {
        if (last.page === number.page && last.total === number.total)
          repeats = i + 1;
        continue;
      }
      const theirs = pageWords(other);
      if (words.size < SAME_PAGE_WORDS || theirs.size < SAME_PAGE_WORDS)
        continue;
      let shared = 0;
      for (const w of words) if (theirs.has(w)) shared++;
      if (shared / (words.size + theirs.size - shared) >= SAME_PAGE)
        repeats = i + 1;
    }
  }
  return { last, repeats, total, missing };
}

/** The scanner's line about the pages so far, or null when it has nothing. */
export function scanCountMessage(count: ScanCount) {
  const { last, repeats, total, missing } = count;
  if (repeats !== null)
    return {
      warn: true,
      text: last
        ? `This is page ${last.page} of ${last.total} again. Retake it if you meant the next page.`
        : `This looks like the same page as page ${repeats} of this scan. Retake it if you meant the next page.`,
    };
  if (!total) return null;
  const at = last ? `Page ${last.page} of ${last.total}. ` : "";
  if (!missing.length)
    return { warn: false, text: `${at}All ${total} pages captured.` };
  const pages = list(missing);
  return {
    warn: false,
    text: `${at}Still to scan: ${pages} of ${total}.`,
  };
}

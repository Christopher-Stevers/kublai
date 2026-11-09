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

const list = (pages: number[]) =>
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

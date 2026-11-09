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

/**
 * A warning when the printed page numbers show a page that is not in the scan.
 * With the scanned page count, a misread number on a page that is there
 * raises nothing.
 */
export function missingPagesWarning(
  text: string,
  scanned?: number,
): string | null {
  const groups = slipPageNumbers(text);
  const short = groups.filter((group) => group.missing.length);
  if (!short.length) return null;
  if (
    scanned !== undefined &&
    scanned >= groups.reduce((n, group) => n + group.total, 0)
  )
    return null;
  return short
    .map(
      ({ total, missing }) =>
        `The slip is numbered as ${total} pages, but ${list(missing)} ${missing.length === 1 ? "is" : "are"} not in this scan.`,
    )
    .concat("Scan every page so no lines are missed.")
    .join(" ");
}

import {
  MATCH_ISSUE,
  convertSlipQuantity,
  type ReceiptOrderItem,
  type SlipAnalysis,
  type SlipLine,
} from "~/lib/packing-slip-review";

/** Slip line index → order item the user chose (null: not on this order). */
export type SlipLinks = Record<number, string | null>;

export const roundQty = (n: number) => Math.round(n * 1e6) / 1e6;

export const linkOf = (analysis: SlipAnalysis, links: SlipLinks, i: number) =>
  i in links ? links[i]! : analysis.lines[i]!.orderItemId;

/** What a slip line adds to the item it is linked to; null when unclear.
 * Mirrors the server's handling of hand-linked lines. */
export function lineAmount(
  line: SlipLine,
  itemId: string,
  item: ReceiptOrderItem | undefined,
) {
  if (itemId === line.orderItemId) return line.proposed;
  if (!item || !line.quantityClear || line.shipped === null) return null;
  const pack = !!item.piecesPerPack && item.piecesPerPack > 1;
  return convertSlipQuantity(
    line.shipped,
    line.unit ?? (pack ? null : item.unit),
    item,
  );
}

/** The slip's figure for each order item it was matched to. */
export function slipAmounts(analysis: SlipAnalysis, links: SlipLinks = {}) {
  const amounts: Record<string, number> = {};
  analysis.lines.forEach((line, i) => {
    const id = linkOf(analysis, links, i);
    if (!id) return;
    const n = lineAmount(
      line,
      id,
      analysis.items.find((x) => x.id === id),
    );
    if (n !== null) amounts[id] = roundQty((amounts[id] ?? 0) + n);
  });
  return amounts;
}

/** Issues still open on a line; a line the user linked has its match settled. */
export const openIssues = (line: SlipLine, linked: boolean) =>
  linked ? line.issues.filter((i) => !MATCH_ISSUE.test(i)) : line.issues;

export type SlipItemState = {
  /** Slip lines linked to this item, with their index on the slip. */
  lines: Array<{ line: SlipLine; index: number }>;
  /** What the slip says arrived; undefined when it could not be read. */
  slip?: number;
  /** Someone should look at the slip line before trusting the figure. */
  check: boolean;
};

/** How each order item stands on the slip, keyed by order item id. */
export function slipItemStates(analysis: SlipAnalysis, links: SlipLinks) {
  const amounts = slipAmounts(analysis, links);
  return Object.fromEntries(
    analysis.items.map((item) => {
      const lines = analysis.lines
        .map((line, index) => ({ line, index }))
        .filter(({ index }) => linkOf(analysis, links, index) === item.id);
      const slip = amounts[item.id];
      const check =
        lines.length > 0 &&
        (slip === undefined ||
          lines.some(
            ({ line, index }) =>
              openIssues(line, index in links).length > 0 ||
              !line.quantityClear ||
              line.handwritten !== undefined ||
              (!(index in links) &&
                !!line.confidence &&
                line.confidence !== "high"),
          ));
      return [item.id, { lines, slip, check } satisfies SlipItemState];
    }),
  ) as Record<string, SlipItemState>;
}

/** Slip lines not linked to any order item. */
export const unmatchedLines = (analysis: SlipAnalysis, links: SlipLinks) =>
  analysis.lines
    .map((line, index) => ({ line, index }))
    .filter(({ index }) => !linkOf(analysis, links, index));

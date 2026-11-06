/** Pairs slip lines the order matcher left unmatched with order lines that
 * no slip line has, when the slip line's likely catalogue part is the part
 * behind that order line. The catalogue knows this supplier's codes and
 * earlier slip names for every part; the order line only knows its own. */
type Line = {
  id: string;
  orderItemId: string | null;
  ignored?: unknown;
  approved?: unknown;
  pairingDismissed?: boolean;
};
type Likely = { id: string; score: number; code: boolean };

/** The same bar as the "Likely" name on the Receive screen. */
const strong = (p: Likely) => p.code || p.score >= 0.45;

export function slipOrderPairs(
  lines: Line[],
  likely: Record<string, Likely[]>,
  itemParts: Record<string, { partId: string } | undefined>,
  /** Order items another slip has already received. */
  received: Iterable<string> = [],
): Record<string, string> {
  const items = Object.keys(itemParts);
  const taken = new Set<string | null>([
    ...received,
    ...lines
      .filter((l) => !l.ignored && l.orderItemId)
      .map((l) => l.orderItemId),
  ]);
  const want = new Map<string, string[]>();
  for (const l of lines) {
    if (
      l.pairingDismissed ||
      l.ignored ||
      l.approved ||
      (l.orderItemId && items.includes(l.orderItemId))
    )
      continue;
    // The first strong likely part that is on the order, on exactly one line.
    for (const p of (likely[l.id] ?? []).filter(strong)) {
      const on = items.filter((i) => itemParts[i]?.partId === p.id);
      if (!on.length) continue;
      if (on.length === 1 && !taken.has(on[0]!))
        want.set(on[0]!, [...(want.get(on[0]!) ?? []), l.id]);
      break;
    }
  }
  // Two slip lines after the same order line are left for the reviewer.
  return Object.fromEntries(
    [...want]
      .filter(([, ids]) => ids.length === 1)
      .map(([item, [line]]) => [line!, item]),
  );
}

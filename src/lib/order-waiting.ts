/** What an order is still waiting for once receiving has begun on it. A
 * delivery can be accepted short; the rest stays here, not on the slip. */
export type WaitingItem = {
  description: string;
  outstanding: number;
  unit: string;
};

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function orderStillWaiting(
  items: ReadonlyArray<{
    description: string;
    ordered: number;
    received: number;
    unit?: string | null;
  }>,
): WaitingItem[] {
  if (!items.some((i) => i.received > 1e-6)) return [];
  return items.flatMap((i) => {
    const outstanding = round(i.ordered - i.received);
    return outstanding > 1e-6
      ? [
          {
            description: i.description,
            outstanding,
            unit: i.unit?.trim() ?? "",
          },
        ]
      : [];
  });
}

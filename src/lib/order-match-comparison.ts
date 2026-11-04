export type OrderMatchComparison = {
  orderId: string;
  orderNumber: string;
  orderDate: string | null;
  slipDate: string | null;
  rows: Array<{
    /** Local product similarity, 0–100; not a calibrated probability. */
    matchScore: number;
    order: {
      description: string;
      quantity: number;
      unit: string;
      piecesPerPack: number | null;
    } | null;
    slip: {
      description: string;
      quantity: number | null;
      unit: string | null;
      /** The slip's figure in the order's unit, where the slip counts differently. */
      inOrderUnit?: number | null;
    } | null;
  }>;
};

/** A date's calendar day, from an ISO date or a timestamp. */
function calendarDay(value: string | null | undefined) {
  if (!value) return null;
  const text = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : new Date(value).toLocaleDateString("en-CA");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const [year, month, date] = match.slice(1).map(Number) as [
    number,
    number,
    number,
  ];
  const utc = Date.UTC(year, month - 1, date);
  if (new Date(utc).toISOString().slice(0, 10) !== text) return null;
  return { label: `${date}/${month}/${year}`, utc };
}

/** Calendar days from the order's date to the slip's, not elapsed hours
 * (which vary at daylight saving); null when either is unknown. */
export function daysBetween(
  orderDate: string | null | undefined,
  slipDate: string | null | undefined,
) {
  const order = calendarDay(orderDate),
    slip = calendarDay(slipDate);
  return order && slip ? Math.round((slip.utc - order.utc) / 86400000) : null;
}

export function comparisonDates(
  orderDate: string | null,
  slipDate: string | null,
) {
  const difference = daysBetween(orderDate, slipDate);
  return {
    order: calendarDay(orderDate)?.label ?? "Not available",
    slip: calendarDay(slipDate)?.label ?? "Not read",
    close: difference !== null && Math.abs(difference) <= 2,
    label:
      difference === null
        ? null
        : difference === 0
          ? "Same day"
          : `${Math.abs(difference)} ${Math.abs(difference) === 1 ? "day" : "days"} ${difference > 0 ? "after" : "before"} order`,
  };
}

export type RankedOrderMatch = {
  orderId: string;
  orderNumber: string;
  supplier: string | null;
  listName: string;
  sentAt: string | null;
  found: number;
  weak: boolean;
  /** Match confidence, 0 to 99: how sure all the slip's evidence makes it
   * that this is the slip's order. Only rivals the evidence cannot rule out
   * lower it, so two orders can never both pass 90. */
  confidence: number;
  /** The evidence that moved the confidence most, strongest first. */
  notes?: string[];
};

/** The one order at 90% match confidence or more, matched without asking. */
export const sureOrder = (rows: RankedOrderMatch[]) => {
  const sure = rows.filter((row) => row.confidence >= 90);
  return sure.length === 1 ? sure[0]!.orderId : null;
};

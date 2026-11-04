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

/** Compare calendar dates, not elapsed hours (which vary at daylight saving). */
export function comparisonDates(
  orderDate: string | null,
  slipDate: string | null,
) {
  const day = (value: string | null) => {
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
  };
  const order = day(orderDate),
    slip = day(slipDate);
  const difference =
    order && slip ? Math.round((slip.utc - order.utc) / 86400000) : null;
  return {
    order: order?.label ?? "Not available",
    slip: slip?.label ?? "Not read",
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
  /** 0 to 100: the chance this is the slip's order, against the others. */
  confidence: number;
};

/** The one order above 90% confidence, which is matched without asking. */
export const sureOrder = (rows: RankedOrderMatch[]) => {
  const sure = rows.filter((row) => row.confidence >= 90);
  return sure.length === 1 ? sure[0]!.orderId : null;
};

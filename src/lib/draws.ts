/**
 * Progress-billing (draw) math, modelled on a schedule of values pay
 * application: each draw records the cumulative amount completed per line
 * item, and every other figure is derived. All arithmetic is in cents.
 */

export type DrawStatus = "draft" | "submitted" | "paid";

export const drawStatuses: readonly DrawStatus[] = [
  "draft",
  "submitted",
  "paid",
];

export type DrawLineInput = {
  id: string;
  scheduledValue: string | number | null;
};

export type DrawInput = {
  id: string;
  drawNumber: number;
  retainagePercent: string | number | null;
  /** Cumulative completed-to-date amount per line id. */
  completedToDate: Record<string, string | number | null | undefined>;
};

export type DrawLineFigures = {
  lineId: string;
  scheduledCents: number;
  previousCents: number;
  thisPeriodCents: number;
  completedToDateCents: number;
  percentComplete: number;
  balanceToFinishCents: number;
};

export type DrawSummary = {
  drawId: string;
  drawNumber: number;
  lines: DrawLineFigures[];
  contractSumCents: number;
  completedToDateCents: number;
  thisPeriodCents: number;
  retainagePercent: number;
  retainageCents: number;
  earnedLessRetainageCents: number;
  previousCertificatesCents: number;
  currentPaymentDueCents: number;
  balanceToFinishCents: number;
  percentComplete: number;
};

export function toCents(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  const num = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100);
}

export function centsToDecimalString(cents: number) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function toPercent(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  const num = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(num) ? num : 0;
}

function ratio(part: number, whole: number) {
  return whole === 0 ? 0 : (part / whole) * 100;
}

/**
 * Computes every draw in order. A line with no recorded amount on a draw
 * carries forward its previous cumulative amount (e.g. a line added after
 * earlier draws were issued).
 */
export function summarizeDraws(
  lines: DrawLineInput[],
  draws: DrawInput[],
): DrawSummary[] {
  const ordered = [...draws].sort((a, b) => a.drawNumber - b.drawNumber);
  const contractSumCents = lines.reduce(
    (sum, line) => sum + toCents(line.scheduledValue),
    0,
  );
  const previousByLine = new Map<string, number>();
  let previousCertificatesCents = 0;
  const summaries: DrawSummary[] = [];

  for (const draw of ordered) {
    const lineFigures = lines.map((line): DrawLineFigures => {
      const scheduledCents = toCents(line.scheduledValue);
      const previousCents = previousByLine.get(line.id) ?? 0;
      const recorded = draw.completedToDate[line.id];
      const completedToDateCents =
        recorded === undefined || recorded === null
          ? previousCents
          : toCents(recorded);
      return {
        lineId: line.id,
        scheduledCents,
        previousCents,
        thisPeriodCents: completedToDateCents - previousCents,
        completedToDateCents,
        percentComplete: ratio(completedToDateCents, scheduledCents),
        balanceToFinishCents: scheduledCents - completedToDateCents,
      };
    });

    const completedToDateCents = lineFigures.reduce(
      (sum, line) => sum + line.completedToDateCents,
      0,
    );
    const thisPeriodCents = lineFigures.reduce(
      (sum, line) => sum + line.thisPeriodCents,
      0,
    );
    const retainagePercent = toPercent(draw.retainagePercent);
    const retainageCents = Math.round(
      (completedToDateCents * retainagePercent) / 100,
    );
    const earnedLessRetainageCents = completedToDateCents - retainageCents;

    summaries.push({
      drawId: draw.id,
      drawNumber: draw.drawNumber,
      lines: lineFigures,
      contractSumCents,
      completedToDateCents,
      thisPeriodCents,
      retainagePercent,
      retainageCents,
      earnedLessRetainageCents,
      previousCertificatesCents,
      currentPaymentDueCents:
        earnedLessRetainageCents - previousCertificatesCents,
      balanceToFinishCents: contractSumCents - completedToDateCents,
      percentComplete: ratio(completedToDateCents, contractSumCents),
    });

    for (const line of lineFigures) {
      previousByLine.set(line.lineId, line.completedToDateCents);
    }
    previousCertificatesCents = earnedLessRetainageCents;
  }

  return summaries;
}

export function formatCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "CAD",
  }).format(cents / 100);
}

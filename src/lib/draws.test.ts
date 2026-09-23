import { describe, expect, it } from "vitest";

import { centsToDecimalString, summarizeDraws, toCents } from "./draws";

const lines = [
  { id: "underground", scheduledValue: "10000.00" },
  { id: "rough", scheduledValue: "30000.00" },
];

describe("summarizeDraws", () => {
  it("derives period, retainage, and payment due across draws", () => {
    const [first, second] = summarizeDraws(lines, [
      {
        id: "d2",
        drawNumber: 2,
        retainagePercent: "10",
        completedToDate: { underground: "10000", rough: "15000" },
      },
      {
        id: "d1",
        drawNumber: 1,
        retainagePercent: "10",
        completedToDate: { underground: "5000", rough: "0" },
      },
    ]);

    expect(first!.drawNumber).toBe(1);
    expect(first!.contractSumCents).toBe(4_000_000);
    expect(first!.completedToDateCents).toBe(500_000);
    expect(first!.retainageCents).toBe(50_000);
    expect(first!.currentPaymentDueCents).toBe(450_000);

    expect(second!.thisPeriodCents).toBe(2_000_000);
    expect(second!.lines[0]!.previousCents).toBe(500_000);
    expect(second!.lines[0]!.thisPeriodCents).toBe(500_000);
    expect(second!.lines[0]!.percentComplete).toBe(100);
    expect(second!.retainageCents).toBe(250_000);
    expect(second!.previousCertificatesCents).toBe(450_000);
    expect(second!.currentPaymentDueCents).toBe(1_800_000);
    expect(second!.balanceToFinishCents).toBe(1_500_000);
    expect(second!.percentComplete).toBe(62.5);
  });

  it("carries forward lines without a recorded amount", () => {
    const [, second] = summarizeDraws(lines, [
      {
        id: "d1",
        drawNumber: 1,
        retainagePercent: 0,
        completedToDate: { underground: "2500" },
      },
      { id: "d2", drawNumber: 2, retainagePercent: 0, completedToDate: {} },
    ]);

    expect(second!.lines[0]!.completedToDateCents).toBe(250_000);
    expect(second!.lines[0]!.thisPeriodCents).toBe(0);
    expect(second!.currentPaymentDueCents).toBe(0);
  });

  it("handles an empty schedule without dividing by zero", () => {
    const [draw] = summarizeDraws([], [
      { id: "d1", drawNumber: 1, retainagePercent: 10, completedToDate: {} },
    ]);
    expect(draw!.percentComplete).toBe(0);
    expect(draw!.currentPaymentDueCents).toBe(0);
  });
});

describe("money helpers", () => {
  it("round-trips decimal strings through cents", () => {
    expect(toCents("1234.56")).toBe(123_456);
    expect(toCents("")).toBe(0);
    expect(centsToDecimalString(123_457)).toBe("1234.57");
    expect(centsToDecimalString(-5)).toBe("-0.05");
  });
});

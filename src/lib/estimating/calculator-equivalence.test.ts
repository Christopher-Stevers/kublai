// @vitest-environment node
import { describe, expect, it } from "vitest";
import { calculateEstimate } from "./calculator";
import { scanCalculateEstimate } from "../../../scripts/benchmarks/scan-calculator";
import { estimateDocumentSchema, newEstimateLine } from "./types";
const options = { now: new Date("2026-10-12T00:00:00Z") };
describe("optimized estimate arithmetic", () => {
  it("preserves every total, allocation and warning across mixed options", () => {
    for (let seed = 0; seed < 40; seed++) {
      const document = estimateDocumentSchema.parse({
        settings: {
          profitMode: seed % 2 ? "margin" : "markup",
          profitPercent: seed % 25,
          laborRate: seed + 30,
          laborBurdenPercent: seed % 20,
          taxPercent: 13,
        },
        alternates: Array.from({ length: 4 }, (_, i) => ({
          id: `alt-${i}`,
          name: `Option ${i}`,
          included: (seed + i) % 2 === 0,
        })),
        lines: Array.from({ length: 60 }, (_, i) =>
          newEstimateLine({
            id: i % 17 === 0 ? "duplicate" : `line-${i}`,
            description: `Pipe ${i % 7}`,
            quantity: ((seed + i) % 15) / 3,
            multiplier: 1.1,
            wastePercent: seed % 10,
            orderMultiple: i % 4 ? 10 : null,
            partDefinitionId: `part-${i % 7}`,
            supplierName: i % 3 ? "QA Supply" : "Other",
            unit: i % 2 ? "ft" : "lf",
            materialUnitCost: i % 6 ? 2.37 : null,
            laborHoursPerUnit: 0.17,
            laborRate: i % 3 ? null : 52.2,
            equipmentUnitCost: 0.03,
            subcontractUnitCost: 0.07,
            otherUnitCost: 0.11,
            reviewStatus:
              i % 8 === 0 ? "excluded" : i % 3 ? "unreviewed" : "approved",
            priceSource: i % 3 ? "simulated" : "imported",
            priceCurrency: i % 19 ? "CAD" : "USD",
            priceUpdatedAt: i % 7 ? "2026-01-01" : "bad-date",
            source: {
              kind: "drawing-measurement",
              sheetId: "sheet",
              markupId: `mark-${i % 23}`,
              confidence: 0.6,
            },
            trade: `Trade ${i % 2}`,
            area: `Level ${i % 3}`,
            costCode: `Cost ${i % 4}`,
            ...(i % 3 ? { alternateId: `alt-${i % 4}` } : {}),
          }),
        ),
      });
      expect(calculateEstimate(document, options)).toEqual(
        scanCalculateEstimate(document, options),
      );
    }
  });
  it("does not reuse stale quantities, prices or settings after in-place changes", () => {
    const document = estimateDocumentSchema.parse({
      lines: [
        newEstimateLine({
          id: "line",
          description: "Pipe",
          quantity: 2,
          materialUnitCost: 3,
        }),
      ],
    });
    calculateEstimate(document, options);
    document.lines[0]!.quantity = 7.75;
    document.lines[0]!.materialUnitCost = 9.25;
    document.settings.laborRate = 85;
    expect(calculateEstimate(document, options)).toEqual(
      scanCalculateEstimate(document, options),
    );
  });
  it("retains independent base totals and duplicate warning arrays", () => {
    const document = estimateDocumentSchema.parse({
      lines: [
        newEstimateLine({ id: "dup", description: "Pipe", quantity: 1 }),
        newEstimateLine({ id: "dup", description: "Pipe", quantity: 1 }),
      ],
    });
    const result = calculateEstimate(document, options);
    expect(result).toEqual(scanCalculateEstimate(document, options));
    expect(result.base.cents).not.toBe(result.selected.cents);
    expect(result.lines[0]!.warnings).not.toBe(result.lines[1]!.warnings);
  });
});

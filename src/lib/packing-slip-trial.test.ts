import { describe, expect, it } from "vitest";
import {
  alignTrialLines,
  confidenceCalibration,
  trialDisagreements,
  trialResultSchema,
  type TrialLine,
  type TrialResult,
} from "./packing-slip-trial";
const score = { value: 0.8, basis: "self_assessed", reason: "Legible source" };
function line(overrides: Partial<TrialLine> = {}): TrialLine {
  return {
    lineId: "one",
    page: 1,
    box: { x: 0, y: 0.3, width: 1, height: 0.03 },
    evidence: "ELBOW 10 EA",
    description: "2 inch elbow",
    sku: "ELB2",
    ordered: 10,
    shipped: 10,
    backordered: 0,
    unit: "EA",
    unitPrice: null,
    orderItemId: "00000000-0000-4000-8000-000000000001",
    confidence: { part: score, quantity: score, match: score, overall: score },
    issues: [],
    ...overrides,
  };
}
function result(
  reader: TrialResult["reader"],
  lines: TrialLine[],
): TrialResult {
  return {
    schemaVersion: 1,
    caseId: "case-001",
    reader,
    model: reader,
    status: "complete",
    sourceSha256: "a".repeat(64),
    lines,
    warnings: [],
  };
}
describe("packing-slip comparison", () => {
  it("keeps OCR and Jev independent even when the readings agree", () => {
    const results = {
      ocr: result("ocr", [line()]),
      jev: result("jev", [line()]),
    };
    const rows = alignTrialLines(results);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!.lines)).toHaveLength(2);
    expect(trialDisagreements(rows[0]!, results)).toEqual([]);
  });
  it("does not align repeated SKUs on distant source rows", () => {
    const first = line(),
      second = line({
        lineId: "two",
        box: { x: 0, y: 0.6, width: 1, height: 0.03 },
      });
    const results = {
      astra: result("astra", [first, second]),
      ocr: result("ocr", [second, first]),
    };
    const rows = alignTrialLines(results);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.lines.ocr!.box!.y).toBe(0.3);
    expect(rows[1]!.lines.ocr!.box!.y).toBe(0.6);
  });
  it("preserves detections missing from the strongest reader", () => {
    const results = {
      astra: result("astra", []),
      ocr: result("ocr", [line()]),
    };
    const rows = alignTrialLines(results);
    expect(rows).toHaveLength(1);
    expect(trialDisagreements(rows[0]!, results)).toContain(
      "Some readers did not detect this line",
    );
  });
  it("flags quantity and unit disagreements without changing predictions", () => {
    const results = {
      astra: result("astra", [line()]),
      terra: result("terra", [line({ shipped: 1, unit: "box" })]),
    };
    const before = JSON.stringify(results);
    expect(trialDisagreements(alignTrialLines(results)[0]!, results)).toEqual([
      "Shipped quantities differ",
      "Units differ",
    ]);
    expect(JSON.stringify(results)).toBe(before);
  });
  it("requires bounded confidence for every line", () => {
    const r = result("astra", [line()]);
    expect(trialResultSchema.safeParse(r).success).toBe(true);
    expect(
      trialResultSchema.safeParse({
        ...r,
        lines: [{ ...r.lines[0], confidence: undefined }],
      }).success,
    ).toBe(false);
    expect(
      trialResultSchema.safeParse({
        ...r,
        lines: [
          line({
            confidence: {
              part: { ...score, value: 90 },
              quantity: score,
              match: score,
              overall: score,
            },
          }),
        ],
      }).success,
    ).toBe(false);
  });
  it("does not treat agreement or unreviewed predictions as calibration labels", () => {
    const bins = confidenceCalibration([
      { confidence: 0.85, correct: true, humanVerified: false },
      { confidence: 0.85, correct: false, humanVerified: true },
      { confidence: 1, correct: true, humanVerified: true },
    ]);
    expect(bins[8]).toMatchObject({ count: 1, accuracy: 0 });
    expect(bins[9]).toMatchObject({ count: 1, accuracy: 1 });
    expect(bins[0]!.accuracy).toBeNull();
  });
});

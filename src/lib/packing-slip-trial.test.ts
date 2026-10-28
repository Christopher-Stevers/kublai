import { describe, expect, it } from "vitest";
import {
  alignTrialLines,
  confidenceCalibration,
  trialDisagreements,
  trialResultSchema,
  trialIndexSchema,
  readersInTrial,
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
  it("retains legacy four-reader manifests and includes Liquid only when registered", () => {
    const statuses = {
      ocr: "complete",
      jev: "complete",
      terra: "complete",
      astra: "complete",
    } as const;
    const index = {
      schemaVersion: 1,
      runId: "trial-legacy-001",
      jobId: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002",
      createdAt: "2026-10-27",
      updatedAt: "2026-10-27",
      cases: [
        {
          caseId: "case-001",
          documentId: "00000000-0000-4000-8000-000000000003",
          versionId: "00000000-0000-4000-8000-000000000004",
          sha256: "a".repeat(64),
          pages: 1,
          name: "Slip",
          readers: statuses,
        },
      ],
    };
    expect(trialIndexSchema.safeParse(index).success).toBe(true);
    expect(readersInTrial(statuses)).toEqual(["ocr", "jev", "terra", "astra"]);
    expect(readersInTrial({ ...statuses, liquid: "pending" })).toHaveLength(5);
  });
  it("retains Liquid-only detections and its own independent confidence", () => {
    const liquid = result("liquid", [line({ shipped: 9, orderItemId: null })]);
    expect(trialResultSchema.safeParse(liquid).success).toBe(true);
    const results = { liquid, astra: result("astra", []) };
    const before = JSON.stringify(results);
    const rows = alignTrialLines(results);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lines.liquid!.shipped).toBe(9);
    expect(trialDisagreements(rows[0]!, results)).toContain(
      "Some readers did not detect this line",
    );
    expect(JSON.stringify(results)).toBe(before);
  });
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

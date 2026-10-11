import { describe, expect, it } from "vitest";
import {
  isNativeRevitPreview,
  nativeRevitReportSchema,
  nativeViewRestriction,
} from "./native-conversion";
import type { BimModel } from "./types";

const model = (native: boolean) =>
  ({
    id: "a",
    format: native ? "rvt" : "ifc",
    ...(native ? { conversionEngine: "native" } : {}),
  }) as BimModel;

describe("native Revit preview policy", () => {
  it("allows inspection while refusing measurement and shared-coordinate assumptions", () => {
    expect(
      nativeViewRestriction([model(true)], {
        modelIds: ["a"],
        measurements: [],
      }),
    ).toBeNull();
    expect(
      nativeViewRestriction([model(true)], {
        modelIds: ["a"],
        measurements: [
          {
            id: "m",
            type: "distance",
            label: "",
            points: [
              [0, 0, 0],
              [1, 0, 0],
            ],
          },
        ],
      }),
    ).toMatch(/Measurements/);
    expect(
      nativeViewRestriction([model(true), model(false)], {
        modelIds: ["a", "b"],
        measurements: [],
      }),
    ).toMatch(/coordinates/);
    expect(
      nativeViewRestriction([model(false)], {
        modelIds: ["a"],
        measurements: [],
      }),
    ).toBeNull();
  });
  it("detects reports even if the engine discriminator is absent", () => {
    expect(isNativeRevitPreview({ nativeConversion: {} } as BimModel)).toBe(
      true,
    );
    expect(isNativeRevitPreview(model(false))).toBe(false);
  });
  it("rejects claims of verified geometry from a child process", () => {
    const report = {
      schemaVersion: 1,
      engine: "foreman-native-revit",
      engineVersion: "0.1.0",
      readerRevision: "a".repeat(40),
      revitVersion: 2025,
      outcome: "preview",
      coordinates: "revit-internal",
      measurementsAllowed: false,
      decodedElements: 1,
      displayedElements: 1,
      omittedBoxElements: 0,
      savedMeshElements: 1,
      levels: 1,
      categories: { IFCWALL: 1 },
      warnings: [],
    };
    expect(nativeRevitReportSchema.safeParse(report).success).toBe(true);
    expect(
      nativeRevitReportSchema.safeParse({
        ...report,
        measurementsAllowed: true,
      }).success,
    ).toBe(false);
    expect(
      nativeRevitReportSchema.safeParse({ ...report, coordinates: "shared" })
        .success,
    ).toBe(false);
  });
});

import { expect, it } from "vitest";
import {
  equipmentCoverage,
  equipmentReportCsv,
  type EquipmentReportLine,
} from "./super-equipment";
it("keeps incomplete searches distinct from missing and evidence from approval", () => {
  expect(equipmentCoverage([], false)).toBe("incomplete");
  expect(equipmentCoverage([], true)).toBe("missing");
  expect(equipmentCoverage([{ confirmed: false }] as never, true)).toBe(
    "review",
  );
  expect(equipmentCoverage([{ confirmed: true }] as never, false)).toBe(
    "matched",
  );
});
it("exports each schedule line with coverage, evidence and formula-safe cells", () => {
  const row = {
    id: "one",
    tag: "P-1",
    schedule: "=malicious()",
    cells: ["Pump, duplex"],
    sheetId: "a",
    sheet: "M-001",
    set: "Mechanical",
    page: 1,
    sourceUrl: "/source",
    status: "missing",
    matches: [],
  } satisfies EquipmentReportLine;
  const csv = equipmentReportCsv(
    [row, { ...row, id: "two" }],
    ["One document unreadable"],
    "2026-10-26",
  );
  expect(csv).toContain("One document unreadable");
  expect(csv).toContain("'=malicious()");
  expect(csv.match(/No submittal found/g)).toHaveLength(2);
});

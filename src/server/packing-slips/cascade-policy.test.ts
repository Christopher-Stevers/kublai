// @vitest-environment node
import { describe, it, expect } from "vitest";
import { escalationPlan, mergeAssistedLines } from "./cascade-policy";
import type { SlipLine } from "~/lib/packing-slip-review";
const line = (values: Partial<SlipLine> = {}): SlipLine => ({
  page: 1,
  evidence: "ABC valve 6 ea",
  description: "Valve",
  sku: "ABC",
  orderItemId: "a",
  shipped: 6,
  backordered: 4,
  unit: "ea",
  proposed: 6,
  issues: [],
  box: { x: 0, y: 0.2, width: 1, height: 0.05 },
  ...values,
});
const reading = (l: SlipLine[], warnings: string[] = []) => ({
  lines: l,
  warnings,
  model: "jev-1.14.0",
});
describe("production escalation policy", () => {
  it("does not pay Terra for clear readings or human-only decisions", () => {
    for (const issues of [
      [],
      ["Repeated slip line; check for duplicate pages before counting."],
      [
        "No unit could be read on the slip. Confirm the printed unit and any pack or length conversion.",
      ],
      ["Negative quantity: confirm this return and its disposition."],
      ["Handwriting on this line may change the quantity. Check the slip."],
    ])
      expect(escalationPlan(reading([line({ issues })])).reasons).toEqual([]);
  });
  it("escalates missing rows, uncertain quantities and order identity", () => {
    expect(escalationPlan(reading([])).reasons).toContain(
      "No readable product rows",
    );
    expect(
      escalationPlan(reading([line({ shipped: null })])).lineIndexes,
    ).toEqual([0]);
    expect(escalationPlan(reading([line()]), true).reasons).toContain(
      "Order match remains uncertain",
    );
    expect(
      escalationPlan(
        reading([line()], ["Jev could not finish the image reading."]),
      ).reasons.length,
    ).toBeGreaterThan(0);
  });
  it("does not invent a model escalation for explicitly blank delivery cells", () => {
    expect(
      escalationPlan(
        reading([
          line({
            shipped: null,
            issues: ["Shipped quantity is blank on the slip."],
          }),
        ]),
      ).reasons,
    ).toEqual([]);
  });
  it("keeps a clear cheap line and flags disagreements without replacing its quantity", () => {
    const result = mergeAssistedLines(
      [line()],
      [line({ shipped: 60, source: "terra" })],
      [],
    );
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      shipped: 6,
      proposed: null,
      quantityClear: false,
    });
    expect(result.lines[0]!.issues.join()).toMatch(/disagrees/);
  });
  it("uses an assisted uncertain row once and preserves prior risk flags", () => {
    const result = mergeAssistedLines(
      [line({ shipped: null, issues: ["Handwriting may change quantity"] })],
      [line({ shipped: 6, source: "terra" })],
      [0],
    );
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      shipped: 6,
      proposed: null,
      quantityClear: false,
      source: "terra",
    });
    expect(result.lines[0]!.issues.join()).toContain("Handwriting");
  });
  it("does not append two ambiguous overlapping copies of one row", () => {
    const result = mergeAssistedLines([line()], [line(), line()], [0]);
    expect(result.lines).toHaveLength(1);
    expect(result.warnings.join()).toMatch(/aligned safely/);
  });
  it("adds missing rows for human verification and retains absent older rows", () => {
    const extra = line({
      sku: "XYZ",
      evidence: "XYZ new part",
      box: { x: 0, y: 0.6, width: 1, height: 0.05 },
    });
    const result = mergeAssistedLines([line()], [extra], [0]);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[1]!.proposed).toBeNull();
    expect(result.lines[0]!.issues.join()).toMatch(/could not resolve/);
  });
});

import { describe, expect, it } from "vitest";
import { defaultDrawingMetadata } from "~/server/drawings/domain";
import {
  compatibleRevisionScale,
  nearRevisionChanges,
  proposeDrawingRevisions,
  revisionChangedRegions,
} from "./drawing-revision-review";
import type { PipeLinework } from "./pipe-system";
const sheet = (id: string, number: string) => ({
  id,
  setId: "set",
  name: number,
  metadata: { ...defaultDrawingMetadata(id), number },
});
const scale = { unitsPerSheetWidth: 100, unit: "m" as const };
const evidence = {
  width: 1000,
  height: 800,
  scale,
  words: [{ text: "100 mm", left: 0.3, top: 0.4, right: 0.35, bottom: 0.42 }],
};
function work(): PipeLinework {
  return {
    aspect: 0.8,
    truncated: false,
    labels: [],
    segments: Array.from({ length: 120 }, (_, i) => ({
      id: String(i),
      pathId: String(i),
      x1: 0.12 + (i % 12) * 0.045,
      y1: 0.12 + Math.floor(i / 12) * 0.055,
      x2: 0.15 + (i % 12) * 0.045,
      y2: 0.12 + Math.floor(i / 12) * 0.055,
      stroke: "#000000",
      width: 0.001,
      dash: [],
    })),
  };
}
describe("conservative drawing revision matching", () => {
  it("matches normalized unique numbers, leaves duplicates and missing identities for manual review", () => {
    const rows = proposeDrawingRevisions(
      [
        sheet("a", "M-101"),
        sheet("b", "A2.01"),
        sheet("c", "Sheet 3"),
        sheet("d", "P100"),
        sheet("e", "P100"),
      ],
      [sheet("old", "M 101"), sheet("x", "A2.01"), sheet("y", "A2.01")],
    );
    expect(rows.map((r) => r.status)).toEqual([
      "matched",
      "uncertain",
      "uncertain",
      "uncertain",
      "uncertain",
    ]);
    expect(rows[0]?.targetId).toBe("old");
    expect(rows.slice(1).every((r) => r.targetId === null)).toBe(true);
  });
  it("does not combine distinct decimal sheet numbers", () =>
    expect(
      proposeDrawingRevisions([sheet("a", "A2.01")], [sheet("b", "A201")])[0]
        ?.status,
    ).toBe("new"));
});
describe("calibration compatibility and possible impacts", () => {
  it("requires matching scale plus distributed drawing geometry, not equal page sizes", () => {
    expect(
      compatibleRevisionScale(scale, evidence, evidence, work(), work())
        .preserve,
    ).toBe(true);
    expect(
      compatibleRevisionScale(
        scale,
        evidence,
        { ...evidence, scale: { ...scale, unitsPerSheetWidth: 50 } },
        work(),
        work(),
      ).preserve,
    ).toBe(false);
    const resized = work();
    resized.segments = resized.segments.map((s) => ({
      ...s,
      x1: s.x1 * 0.9,
      x2: s.x2 * 0.9,
    }));
    expect(
      compatibleRevisionScale(scale, evidence, evidence, work(), resized)
        .preserve,
    ).toBe(false);
    expect(
      compatibleRevisionScale(scale, evidence, evidence, work(), {
        ...work(),
        truncated: true,
      }).preserve,
    ).toBe(false);
    expect(
      compatibleRevisionScale(
        scale,
        evidence,
        evidence,
        { ...work(), segments: work().segments.slice(0, 2) },
        work(),
      ).preserve,
    ).toBe(false);
  });
  it("can retain calibration with a small local revision while locating that possible impact", () => {
    const after = work();
    after.segments[0] = { ...after.segments[0]!, x2: 0.16 };
    expect(
      compatibleRevisionScale(scale, evidence, evidence, work(), after)
        .preserve,
    ).toBe(true);
    const changes = revisionChangedRegions(evidence, evidence, work(), after);
    expect(changes.aligned).toBe(true);
    expect(changes.regions.length).toBe(2);
    expect(nearRevisionChanges([{ x: 0.14, y: 0.12 }], changes.regions)).toBe(
      true,
    );
    expect(nearRevisionChanges([{ x: 0.8, y: 0.8 }], changes.regions)).toBe(
      false,
    );
  });
  it("detects changed annotations in the PDF text even if all vector geometry is unchanged", () => {
    const changes = revisionChangedRegions(
      evidence,
      { ...evidence, words: [{ ...evidence.words[0]!, text: "150 mm" }] },
      work(),
      work(),
    );
    expect(changes.aligned).toBe(true);
    expect(nearRevisionChanges([{ x: 0.32, y: 0.41 }], changes.regions)).toBe(
      true,
    );
  });
  it("does not present an unreliable alignment as precise change regions", () => {
    expect(revisionChangedRegions(null, evidence, work(), work())).toEqual({
      aligned: false,
      regions: [],
    });
  });
});

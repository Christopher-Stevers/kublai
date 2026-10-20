import { describe, expect, it } from "vitest";
import {
  chosenPart,
  defaultPipeSpec,
  lineQuantity,
  partOptions,
  partSize,
  pipeSpecSchema,
  pipeSystemCode,
  stickCount,
  takeoffLines,
  type PipeCataloguePart,
  type PipeTakeoff,
} from "./pipe-spec";

const part = (id: string, displayName: string, extra: Partial<PipeCataloguePart> = {}): PipeCataloguePart => ({ id, displayName, ...extra });
const catalogue = [
  part("pipe4", '4" ABS DWV Pipe', { sizeNominal: "4", sizeUnit: "in", bulkUnit: "length" }),
  part("pipe3", '3" ABS DWV Pipe', { sizeNominal: "3", sizeUnit: "in" }),
  part("ell90", "ABS 1/4 Bend", { sizeLabel: '4"' }),
  part("ell45", "ABS 45 Elbow", { sizeLabel: '4"' }),
  part("tee", "ABS Sanitary Tee", { sizeLabel: '4"' }),
  part("redtee", "ABS Sanitary Tee", { sizeLabel: "4 x 3" }),
  part("ball", '2" Ball Valve'),
  part("gate", '2" Gate Valve'),
  part("coupling4", "ABS Coupling", { sizeNominal: "4", sizeUnit: "in", piecesPerPack: 10 }),
];
const takeoff: PipeTakeoff = {
  system: "SAN",
  runs: [
    { size: { unit: "in", nominal: 4 }, meters: 30 },
    { size: null, meters: 2 },
  ],
  components: [
    { kind: "elbow", name: "90° elbow", size: { unit: "in", nominal: 4 }, count: 3 },
    { kind: "elbow", name: "90° elbow", size: { unit: "in", nominal: 4 }, count: 1 },
    { kind: "tee", name: "Tee", size: { unit: "in", nominal: 4 }, count: 2 },
    { kind: "valve", name: "Ball valve", size: { unit: "mm", nominal: 50 }, count: 1 },
    { kind: "rise", name: "Pipe up", size: null, count: 2 },
  ],
  componentsChecked: true,
  partial: false,
  tagCount: 3,
};

describe("pipe spec", () => {
  it("validates stored specs and normalizes system codes", () => {
    expect(pipeSpecSchema.parse(defaultPipeSpec())).toEqual(defaultPipeSpec());
    expect(() => pipeSpecSchema.parse({ ...defaultPipeSpec(), pipe: { ...defaultPipeSpec().pipe, stickLength: 0 } })).toThrow();
    expect(pipeSystemCode.parse(" san ")).toBe("SAN");
    expect(() => pipeSystemCode.parse("<script>")).toThrow();
  });

  it("turns a takeoff into sized lines, merging repeats and skipping rises and unknown pipe", () => {
    expect(takeoffLines(takeoff).map((line) => [line.key, line.label, line.amount])).toEqual([
      ["pipe|in:4", '4" pipe', 30],
      ["elbow:90° elbow|in:4", '4" 90° elbow', 4],
      ["tee:tee|in:4", '4" tee', 2],
      ["valve:ball valve|mm:50", "50 mm ball valve", 1],
    ]);
  });

  it("reads part sizes from facets, labels or names", () => {
    expect(partSize(catalogue[0]!)).toEqual({ size: { unit: "in", nominal: 4 }, reducing: false });
    expect(partSize(catalogue[5]!)).toEqual({ size: { unit: "in", nominal: 4 }, reducing: true });
    expect(partSize(catalogue[6]!)).toEqual({ size: { unit: "in", nominal: 2 }, reducing: false });
    expect(partSize(part("x", "ABS Cleanout"))).toBeNull();
  });

  it("matches each line to a part of its size and kind", () => {
    const [pipe, elbow, tee, valve] = takeoffLines(takeoff);
    expect(partOptions(pipe!, catalogue).map((p) => p.id)).toEqual(["pipe4"]);
    expect(partOptions(elbow!, catalogue).map((p) => p.id)).toEqual(["ell90", "ell45"]);
    expect(partOptions(tee!, catalogue).map((p) => p.id)).toEqual(["tee"]);
    // 50 mm drawings match 2" catalogue parts.
    expect(partOptions(valve!, catalogue).map((p) => p.id)).toEqual(["ball", "gate"]);
  });

  it("prefers a part chosen for the line", () => {
    const elbow = takeoffLines(takeoff)[1]!;
    const spec = { ...defaultPipeSpec(), parts: { [elbow.key]: "ell45" } };
    expect(chosenPart(elbow, catalogue, spec)?.id).toBe("ell45");
    expect(chosenPart(elbow, catalogue, defaultPipeSpec())?.id).toBe("ell90");
  });

  it("counts pipe as whole sticks with waste and fittings in packs", () => {
    const spec = defaultPipeSpec(); // 10 ft sticks, 10% waste
    const [pipe, elbow] = takeoffLines(takeoff);
    // 30 m × 1.1 = 33 m = 108.3 ft → 11 sticks.
    expect(stickCount(pipe!, spec)).toBe(11);
    expect(lineQuantity(pipe!, catalogue[0]!, spec)).toBe(11);
    expect(lineQuantity(pipe!, part("ft", "Pipe", { bulkUnit: "ft" }), spec)).toBe(110);
    expect(lineQuantity(pipe!, part("len", "Pipe", { individualUnit: "ft", piecesPerPack: 20 }), spec)).toBe(6);
    expect(lineQuantity(elbow!, catalogue[2]!, spec)).toBe(4);
    expect(lineQuantity(elbow!, catalogue[8]!, spec)).toBe(0.4);
  });
});

import { describe, expect, it } from "vitest";
import {
  analyzePipeComponents,
  componentDescription,
  savedLegendTemplates,
} from "./pipe-components";
import {
  selectPipeLayerSystem,
  type PipeLinework,
  type PipeSegment,
} from "./pipe-system";
import type {
  PipeDrawingText,
  PipeSymbolPath,
  PipeSymbolTemplate,
} from "./pipe-components-types";
const line = (
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  layer = "M-PLMB-DCWT",
): PipeSegment => ({
  id,
  pathId: id,
  x1,
  y1,
  x2,
  y2,
  layer,
  stroke: "#000000",
  width: 0.001,
  dash: [],
});
const text = (value: string, x: number, y: number): PipeDrawingText => ({
  text: value,
  left: x - 0.01,
  right: x + 0.01,
  top: y - 0.002,
  bottom: y + 0.002,
});
const bow = (
  id: string,
  x: number,
  y: number,
  layer?: string,
): PipeSymbolPath => ({
  id,
  layer,
  closed: true,
  points: [
    { x: x - 0.002, y: y - 0.002 },
    { x: x + 0.002, y: y + 0.002 },
    { x: x + 0.002, y: y - 0.002 },
    { x: x - 0.002, y: y + 0.002 },
    { x: x - 0.002, y: y - 0.002 },
  ],
});
const model = (extra: Partial<PipeLinework> = {}): PipeLinework => ({
  aspect: 1,
  truncated: false,
  componentDataVersion: 1,
  segments: [line("run", 0.1, 0.5, 0.9, 0.5)],
  labels: [],
  texts: [],
  symbols: [],
  ...extra,
});
const analyze = (data: PipeLinework, templates: PipeSymbolTemplate[] = []) =>
  analyzePipeComponents(data, selectPipeLayerSystem(data, "DCW"), templates);
describe("piping component recognition", () => {
  it("reads explicit names, sizes and materials without inventing valve subtypes", () => {
    expect(componentDescription('2" BRASS BALL VALVE BV-12')).toEqual({
      kind: "valve",
      name: "Ball valve",
      size: '2"',
      material: "BRASS",
      tag: "BV-12",
    });
    expect(componentDescription("BV-1")).toEqual({
      kind: "valve",
      name: "Valve",
      tag: "BV-1",
    });
    expect(componentDescription("DN100 reducer")).toMatchObject({
      kind: "reducer",
      size: "DN100",
    });
    expect(componentDescription("Provide all valves as specified")).toBeNull();
    expect(componentDescription("WEST WALL")).toBeNull();
    expect(componentDescription("90mm ELBOW")).toMatchObject({
      name: "Elbow",
      size: "90mm",
    });
    expect(componentDescription("DN450 ELBOW")).toMatchObject({
      name: "Elbow",
      size: "DN450",
    });
    expect(componentDescription("90 DEG ELBOW")).toMatchObject({
      name: "90° elbow",
    });
  });
  it("prioritizes explicit source component layers over shape guesses and excludes foreign systems", () => {
    const result = analyze(
      model({
        symbols: [
          bow("one", 0.3, 0.5, "M-PLMB-DCWT-BALL-VALVE"),
          bow("foreign", 0.6, 0.5, "M-PLMB-DHWT-VALVE"),
        ],
      }),
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      kind: "valve",
      source: "layer",
      name: "Ball valve",
      system: "DCW",
    });
  });
  it("keeps callouts close to the selected system and leaves missing sizes unknown", () => {
    const result = analyze(
      model({
        segments: [
          line("cold", 0.1, 0.5, 0.9, 0.5),
          line("hot", 0.1, 0.51, 0.9, 0.51, "M-PLMB-DHWT"),
        ],
        texts: [text("CHECK VALVE", 0.3, 0.5), text("BALL VALVE", 0.7, 0.51)],
      }),
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      name: "Check valve",
      source: "tag",
    });
    expect(result.candidates[0]?.size).toBeUndefined();
  });
  it("joins CAD text runs and deduplicates a tag against the same symbol", () => {
    const result = analyze(
      model({
        symbols: [bow("valve", 0.3, 0.5)],
        texts: [
          { ...text("BALL", 0.295, 0.5), left: 0.29, right: 0.299 },
          { ...text("VALVE", 0.307, 0.5), left: 0.3, right: 0.314 },
        ],
      }),
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      name: "Ball valve",
      source: "tag",
    });
  });
  it("matches a taught symbol at rotated instances without counting the reference", () => {
    const exemplar = bow("reference", 0.15, 0.2),
      installed = bow("installed", 0.4, 0.5);
    const rotated = {
      ...bow("rotated", 0.7, 0.5),
      points: bow("r", 0.7, 0.5).points.map((p) => ({
        x: 0.7 - (p.y - 0.5),
        y: 0.5 + (p.x - 0.7),
      })),
    };
    const result = analyze(model({ symbols: [exemplar, installed, rotated] }), [
      {
        id: "taught",
        kind: "valve",
        name: "Isolation valve",
        box: { left: 0.14, right: 0.16, top: 0.19, bottom: 0.21 },
      },
    ]);
    expect(result.candidates).toHaveLength(2);
    expect(
      result.candidates.every(
        (c) => c.source === "legend" && c.name === "Isolation valve",
      ),
    ).toBe(true);
  });
  it("uses the drawing legend and excludes legend and schedule text", () => {
    const result = analyze(
      model({
        symbols: [bow("legend", 0.14, 0.2), bow("installed", 0.65, 0.5)],
        texts: [
          text("SYMBOL LEGEND", 0.2, 0.16),
          text("BALL VALVE", 0.18, 0.2),
          text("VALVE SCHEDULE", 0.8, 0.8),
          text("GATE VALVE", 0.8, 0.81),
        ],
      }),
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      name: "Ball valve",
      source: "legend",
    });
  });
  it("suggests tees and elbows but ignores straight joins and X crossings", () => {
    const data = model({
      segments: [
        line("a", 0.1, 0.2, 0.3, 0.2),
        line("b", 0.3, 0.2, 0.3, 0.4),
        line("c", 0.1, 0.6, 0.9, 0.6),
        line("d", 0.5, 0.6, 0.5, 0.8),
        line("e", 0.1, 0.9, 0.4, 0.9),
        line("f", 0.4, 0.9, 0.9, 0.9),
        line("cross", 0.75, 0.4, 0.75, 0.8),
      ],
    });
    const result = analyze(data);
    expect(result.candidates.map((c) => c.kind).sort()).toEqual([
      "elbow",
      "tee",
    ]);
    expect(result.candidates.every((c) => c.source === "geometry")).toBe(true);
  });
  it("does not infer reducers, caps or couplings from dashes, line ends or width", () => {
    const data = model({
      segments: [
        { ...line("a", 0.1, 0.5, 0.3, 0.5), dash: [0.01, 0.01] },
        { ...line("b", 0.31, 0.5, 0.9, 0.5), width: 0.004 },
      ],
    });
    expect(analyze(data).candidates).toEqual([]);
  });
  it("reports unusable taught regions and partial extractions honestly", () => {
    const result = analyze(
      model({
        truncated: true,
        symbols: [{ id: "bad", points: [], closed: true }],
      }),
      [
        {
          id: "empty",
          kind: "valve",
          name: "Example",
          box: { left: 0.1, right: 0.11, top: 0.1, bottom: 0.11 },
        },
      ],
    );
    expect(result.partial).toBe(true);
    expect(result.warnings.join(" ")).toContain("no usable vector symbol");
    expect(result.candidates).toEqual([]);
    expect(analyze(model({ aspect: Infinity })).candidates).toEqual([]);
  });
  it("keeps fingerprints stable and never changes the selected length", () => {
    const data = model({ symbols: [bow("v", 0.5, 0.5)] });
    const selection = selectPipeLayerSystem(data, "DCW"),
      before = structuredClone(selection);
    expect(analyzePipeComponents(data, selection)).toEqual(
      analyzePipeComponents(data, selection),
    );
    expect(selection).toEqual(before);
  });
});

describe("reviewed drawing-set legends", () => {
  const reference = (
    name: string,
    abbreviation: string,
    aspect = 1,
  ): PipeSymbolTemplate => ({
    id: name,
    kind: "valve",
    name,
    box: { left: 0.1, right: 0.2, top: 0.1, bottom: 0.2 },
    reference: {
      paths: [bow("ref", 0.15, 0.15)],
      aspect,
      abbreviation,
      sourceSheetId: "another-sheet",
      sheetName: "Generic legend",
      legendId: name,
      revision: 3,
    },
  });
  it("uses external-page geometry without masking the same coordinates on the target", () => {
    const data = model({
      segments: [line("run", 0.1, 0.15, 0.9, 0.15)],
      symbols: [bow("target", 0.15, 0.15)],
    });
    expect(
      analyze(data, [reference("Custom regulator", "RZ")]).candidates,
    ).toContainEqual(
      expect.objectContaining({ name: "Custom regulator", source: "legend" }),
    );
  });
  it("resolves identical shapes using the legend's own arbitrary abbreviation", () => {
    const data = model({
      symbols: [bow("target", 0.5, 0.5)],
      texts: [text("ZXQ", 0.51, 0.5)],
    });
    const result = analyze(data, [
      reference("First device", "ABC"),
      reference("Second device", "ZXQ"),
    ]);
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        name: "Second device",
        evidence: expect.stringContaining("nearby tag ZXQ"),
      }),
    );
    expect(result.candidates.some((c) => c.name === "First device")).toBe(
      false,
    );
  });
  it("does not decide ambiguous symbols by reference order or prefix matches", () => {
    const data = model({
      symbols: [bow("target", 0.5, 0.5)],
      texts: [text("ZXQ2", 0.51, 0.5)],
    });
    for (const refs of [
      [reference("Alpha", "ZXQ"), reference("Beta", "ABC")],
      [reference("Beta", "ABC"), reference("Alpha", "ZXQ")],
    ]) {
      expect(analyze(data, refs).candidates).toContainEqual(
        expect.objectContaining({ name: "Ambiguous legend symbol" }),
      );
    }
  });
  it("keeps a tag-only identification distinct from a shape match", () => {
    const result = analyze(model({ texts: [text("RZ", 0.5, 0.5)] }), [
      reference("Custom regulator", "RZ"),
    ]);
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        name: "Custom regulator",
        evidence: expect.stringContaining("geometry not verified"),
      }),
    );
  });
  it("normalizes source aspect and rotation rather than relying on sheet dimensions", () => {
    const ref = reference("Scaled device", "SX", 0.5);
    ref.reference!.paths[0]!.points = ref.reference!.paths[0]!.points.map(
      (p) => ({ x: p.x, y: 0.15 + (p.y - 0.15) * 2 }),
    );
    const installed = bow("target", 0.5, 0.5);
    installed.points = installed.points.map((p) => ({
      x: 0.5 + (p.y - 0.5) * 2,
      y: 0.5 - (p.x - 0.5) * 2,
    }));
    expect(
      analyze(model({ symbols: [installed] }), [ref]).candidates,
    ).toContainEqual(expect.objectContaining({ name: "Scaled device" }));
  });
  it("accepts unfamiliar legend names and preserves separate symbol variants", () => {
    const box = { left: 0.1, top: 0.1, right: 0.3, bottom: 0.2 };
    const refs = savedLegendTemplates(
      {
        id: "custom",
        revision: 2,
        data: {
          name: "Zeta device",
          abbreviation: "ZT",
          category: "Unfamiliar discipline",
          row: box,
          symbol: box,
        },
      },
      { id: "source", name: "X-9" },
      model({ symbols: [bow("a", 0.12, 0.15), bow("b", 0.28, 0.15)] }),
    );
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({
      name: "Zeta device",
      kind: "other",
      reference: { abbreviation: "ZT" },
    });
  });
  it("does not count a matching symbol on another system", () => {
    const data = model({
      segments: [
        line("a", 0.1, 0.5, 0.9, 0.5),
        line("b", 0.1, 0.55, 0.9, 0.55, "M-PLMB-DHWT"),
      ],
      symbols: [bow("target", 0.5, 0.55)],
      texts: [text("RZ", 0.51, 0.55)],
    });
    expect(
      analyze(data, [reference("Custom regulator", "RZ")]).candidates.some(
        (c) => c.name === "Custom regulator",
      ),
    ).toBe(false);
  });
});

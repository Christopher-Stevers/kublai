import { describe, expect, it } from "vitest";
import {
  analyzePipeComponents,
  componentDescription,
  savedLegendTemplates,
  segmentGrid,
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
  it("tells 45° wyes apart from square tees", () => {
    const data = model({
      segments: [
        line("run", 0.1, 0.3, 0.9, 0.3),
        line("tee-branch", 0.3, 0.3, 0.3, 0.1),
        line("wye-branch", 0.6, 0.3, 0.7, 0.2),
        line("wye-back", 0.5, 0.5, 0.8, 0.5),
        line("wye-back-branch", 0.6, 0.5, 0.5, 0.6),
      ],
    });
    const result = analyze(data);
    const found = result.candidates
      .map((c) => [c.kind, c.name, c.point.x, c.point.y, c.marker?.label])
      .sort();
    expect(found).toEqual([
      ["tee", "Possible tee / branch", 0.3, 0.3, "T"],
      ["wye", "Possible wye", 0.6, 0.3, "Y"],
      ["wye", "Possible wye", 0.6, 0.5, "Y"],
    ]);
  });
  it("keeps a real tee beside a valve instead of masking the surrounding area", () => {
    const data = model({
      segments: [
        line("run", 0.1, 0.5, 0.9, 0.5),
        line("branch", 0.5023, 0.5, 0.5023, 0.6),
      ],
      symbols: [bow("valve", 0.5, 0.5)],
    });
    const result = analyze(data);
    expect(result.candidates.filter((c) => c.kind === "valve")).toHaveLength(1);
    expect(result.candidates.filter((c) => c.kind === "tee")).toEqual([
      expect.objectContaining({ point: { x: 0.5023, y: 0.5 } }),
    ]);
  });
  it("does not let a callout or another tee's display box hide a junction", () => {
    const data = model({
      segments: [
        line("run", 0.1, 0.5, 0.9, 0.5),
        line("branch-a", 0.5, 0.5, 0.5, 0.6),
        line("branch-b", 0.5008, 0.5, 0.5008, 0.4),
      ],
      texts: [text("BALL VALVE", 0.505, 0.5)],
    });
    const result = analyze(data);
    expect(result.candidates.filter((c) => c.kind === "tee")).toHaveLength(2);
    expect(
      result.candidates.find((c) => c.kind === "valve")?.locationVerified,
    ).toBe(false);
  });
  it("separates valve ink from pipe topology even inside the valve bounding box", () => {
    // A rotated valve has empty corners in its axis-aligned box. A genuine
    // nearby branch in that corner must survive, without its closed glyph
    // strokes creating extra tees/elbows on the pipe.
    const symbol = bow("valve", 0.5, 0.5);
    symbol.points = symbol.points.map((p) => ({
      x: 0.5 + (p.x - 0.5 - (p.y - 0.5)) / Math.SQRT2,
      y: 0.5 + (p.x - 0.5 + (p.y - 0.5)) / Math.SQRT2,
    }));
    const ink = symbol.points.slice(1).map((p, i) => ({
      ...line(`ink-${i}`, symbol.points[i]!.x, symbol.points[i]!.y, p.x, p.y),
      pathId: symbol.id,
      closed: true,
    }));
    const data = model({
      segments: [
        line("run", 0.1, 0.502, 0.9, 0.502),
        line("branch", 0.502, 0.502, 0.502, 0.6),
        ...ink,
      ],
      symbols: [symbol],
    });
    for (const segments of [data.segments, [...data.segments].reverse()]) {
      const result = analyze({ ...data, segments });
      expect(result.candidates.filter((c) => c.kind === "tee")).toEqual([
        expect.objectContaining({ point: { x: 0.502, y: 0.502 } }),
      ]);
      expect(result.candidates.filter((c) => c.kind === "elbow")).toHaveLength(
        0,
      );
      expect(result.candidates.filter((c) => c.kind === "valve")).toHaveLength(
        1,
      );
    }
  });
  it.each([0, 0.37, Math.PI / 2])(
    "recovers a branch at a dashed gap with no extra elbow (rotation %s)",
    (angle) => {
      const rotate = (s: PipeSegment) => {
        const point = (x: number, y: number) => ({
          x: 0.5 + (x - 0.5) * Math.cos(angle) - (y - 0.5) * Math.sin(angle),
          y: 0.5 + (x - 0.5) * Math.sin(angle) + (y - 0.5) * Math.cos(angle),
        });
        const a = point(s.x1, s.y1),
          b = point(s.x2, s.y2);
        return { ...s, x1: a.x, y1: a.y, x2: b.x, y2: b.y, width: 0.0003 };
      };
      const segments = [
        line("dash-a", 0.48, 0.5, 0.489, 0.5),
        line("dash-b", 0.49, 0.5, 0.491, 0.5),
        line("dash-c", 0.492, 0.5, 0.493, 0.5),
        line("dash-d", 0.494, 0.5, 0.504, 0.5),
        line("branch", 0.48992, 0.45, 0.48992, 0.50003),
      ].map(rotate);
      const data = model({ segments });
      const before = structuredClone(data);
      const result = analyze(data);
      expect(result.candidates.filter((c) => c.kind === "tee")).toHaveLength(1);
      expect(result.candidates.filter((c) => c.kind === "elbow")).toHaveLength(
        0,
      );
      expect(data).toEqual(before);
    },
  );
  it("does not invent a tee across an isolated break or a neighboring pipe", () => {
    const segments = [
      line("left", 0.48, 0.5, 0.489, 0.5),
      line("right", 0.49, 0.5, 0.504, 0.5),
      line("branch", 0.48992, 0.45, 0.48992, 0.50003),
    ].map((s) => ({ ...s, width: 0.0003 }));
    expect(
      analyze(model({ segments })).candidates.some((c) => c.kind === "tee"),
    ).toBe(false);
    const dashes = [0.48, 0.482, 0.484, 0.486, 0.488, 0.49, 0.492, 0.494].map(
      (x, i) => ({
        ...line(`dash-${i}`, x, 0.5, x + 0.001, 0.5),
        width: 0.0003,
      }),
    );
    for (const branch of [
      { ...line("short", 0.4895, 0.45, 0.4895, 0.4995), width: 0.0003 },
      {
        ...line("different-ink", 0.4895, 0.45, 0.4895, 0.5),
        width: 0.0003,
        stroke: "#ff0000",
      },
    ])
      expect(
        analyze(model({ segments: [...dashes, branch] })).candidates.some(
          (c) => c.kind === "tee",
        ),
      ).toBe(false);
  });
  it.each([0, 0.37, Math.PI / 2])(
    "finds stroke-touching tees at the run centerline (rotation %s)",
    (angle) => {
      // M-102: CBV branch above room 157. Its centerline stops 0.000174
      // sheet-widths short of the run, but the 0.0003125-wide strokes touch.
      const aspect = 0.75;
      const rotate = (x: number, y: number) => ({
        x: 0.5 + x * Math.cos(angle) - y * Math.sin(angle),
        y: 0.5 + (x * Math.sin(angle) + y * Math.cos(angle)) / aspect,
      });
      const segment = (
        id: string,
        x1: number,
        y1: number,
        x2: number,
        y2: number,
      ) => {
        const a = rotate(x1, y1),
          b = rotate(x2, y2);
        return { ...line(id, a.x, a.y, b.x, b.y), width: 0.0003125 };
      };
      const segments = [
        segment("run", -0.003, 0, 0.003, 0),
        segment("branch", 0, -0.002, 0, -0.000173611111111),
      ];
      for (const reversed of [false, true]) {
        const data = model({
          aspect,
          segments: reversed
            ? segments
                .map((s) => ({ ...s, x1: s.x2, y1: s.y2, x2: s.x1, y2: s.y1 }))
                .reverse()
            : segments,
        });
        const before = structuredClone(data);
        const result = analyze(data);
        expect(result.candidates.map((c) => c.kind)).toEqual(["tee"]);
        expect(result.candidates[0]!.point.x).toBeCloseTo(0.5, 10);
        expect(result.candidates[0]!.point.y).toBeCloseTo(0.5, 10);
        expect(data).toEqual(before);
      }
    },
  );
  it("does not extend a branch to detached, backward, mismatched or ambiguous runs", () => {
    const run = { ...line("run", 0.49, 0.5, 0.51, 0.5), width: 0.0003125 };
    const branch = {
      ...line("branch", 0.5, 0.498, 0.5, 0.4998),
      width: run.width,
    };
    const cases = [
      [run, { ...branch, y2: 0.4996 }],
      [run, { ...branch, y1: 0.502, y2: 0.5004 }],
      [run, { ...branch, stroke: "#ff0000" }],
      [
        run,
        branch,
        {
          ...run,
          id: "parallel",
          pathId: "parallel",
          y1: 0.50005,
          y2: 0.50005,
        },
      ],
      // This line crosses the run, with its endpoint beyond it.
      [run, { ...branch, y1: 0.498, y2: 0.5002 }],
    ];
    for (const segments of cases) {
      expect(
        analyze(model({ segments })).candidates.filter((c) => c.kind === "tee"),
      ).toEqual([]);
    }
  });
  it("keeps an existing junction when another pipe is just beyond it", () => {
    const segments = [
      line("run", 0.49, 0.5, 0.51, 0.5),
      line("branch", 0.5, 0.498, 0.5, 0.5),
      line("neighbor", 0.49, 0.5002, 0.51, 0.5002),
    ].map((s) => ({ ...s, width: 0.0003125 }));
    expect(analyze(model({ segments })).candidates).toEqual([
      expect.objectContaining({ kind: "tee", point: { x: 0.5, y: 0.5 } }),
    ]);
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
      expect.objectContaining({
        name: "Custom regulator",
        source: "legend",
        marker: expect.objectContaining({
          paths: expect.any(Array) as unknown,
        }) as unknown,
      }),
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
        evidence: expect.stringContaining("nearby tag ZXQ") as unknown,
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
        evidence: expect.stringContaining("location unresolved") as unknown,
        locationVerified: false,
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

it("identifies a 22.5 degree turn and stores its oriented custom symbol", () => {
  const turn = (22.5 * Math.PI) / 180;
  const result = analyze(
    model({
      segments: [
        line("a", 0.1, 0.5, 0.4, 0.5),
        line(
          "b",
          0.4,
          0.5,
          0.4 + 0.2 * Math.cos(turn),
          0.5 - 0.2 * Math.sin(turn),
        ),
      ],
    }),
  );
  const elbow = result.candidates.find((c) => c.kind === "elbow");
  expect(elbow?.name).toBe("Possible 22.5° elbow");
  expect(elbow?.marker?.label).toBe("22.5°");
  expect(elbow?.marker?.paths).toHaveLength(2);
});
it("only names vertical directions with explicit evidence", () => {
  expect(componentDescription("PIPE UP")).toMatchObject({
    kind: "rise",
    name: "Pipe up",
  });
  expect(componentDescription("PIPE DN")).toMatchObject({
    kind: "drop",
    name: "Pipe down",
  });
  expect(componentDescription("22.5 DEG ELBOW")).toMatchObject({
    kind: "elbow",
    name: "22.5° elbow",
  });
  expect(
    analyze(model()).candidates.some(
      (c) => c.kind === "rise" || c.kind === "drop",
    ),
  ).toBe(false);
});

const arbitraryReference = (
  name: string,
  abbreviation: string,
): PipeSymbolTemplate => ({
  id: name,
  kind: "valve",
  name,
  box: { left: 0.1, right: 0.2, top: 0.1, bottom: 0.2 },
  reference: {
    paths: [bow("reference", 0.15, 0.15)],
    aspect: 1,
    abbreviation,
    sourceSheetId: "legend",
    sheetName: "Legend",
    legendId: name,
    revision: 1,
  },
});
it("matches rotated valves on the pipe, including two near each other with different tags", () => {
  const rotate = (p: PipeSymbolPath, x: number, y: number) => ({
    ...p,
    points: p.points.map((q) => ({
      x: x + (q.x - x) * Math.cos(0.23) - (q.y - y) * Math.sin(0.23),
      y: y + (q.x - x) * Math.sin(0.23) + (q.y - y) * Math.cos(0.23),
    })),
  });
  const data = model({
    symbols: [
      rotate(bow("one", 0.4, 0.5), 0.4, 0.5),
      rotate(bow("two", 0.408, 0.5), 0.408, 0.5),
    ],
    texts: [
      { text: "AX", left: 0.398, right: 0.401, top: 0.505, bottom: 0.507 },
      { text: "BY", left: 0.407, right: 0.41, top: 0.505, bottom: 0.507 },
    ],
  });
  const candidates = analyze(data, [
    arbitraryReference("First valve", "AX"),
    arbitraryReference("Second valve", "BY"),
  ]).candidates;
  expect(candidates.filter((c) => c.source === "legend")).toHaveLength(2);
  expect(candidates.find((c) => c.name === "First valve")?.point).toEqual({
    x: 0.4,
    y: 0.5,
  });
  expect(
    candidates.find((c) => c.name === "Second valve")?.point.x,
  ).toBeCloseTo(0.408);
  expect(
    candidates.every((c) => c.point.y === 0.5 && c.locationVerified !== false),
  ).toBe(true);
});
it("does not merge two closed valve symbols through their connecting pipe stroke", () => {
  const data = model({
    symbols: [
      bow("one", 0.4, 0.5),
      bow("two", 0.41, 0.5),
      {
        id: "pipe",
        closed: false,
        points: [
          { x: 0.39, y: 0.5 },
          { x: 0.42, y: 0.5 },
        ],
      },
    ],
  });
  const result = analyze(data, [arbitraryReference("Valve", "AX")]);
  expect(result.candidates.filter((c) => c.name === "Valve")).toHaveLength(2);
});
it("recovers whole valve ink from measurement paths when the symbol cache dropped it", () => {
  const missing = bow("missing", 0.42, 0.5);
  const segments = missing.points.slice(1).map((p, i) => ({
    ...line(
      "seg" + i,
      missing.points[i]!.x,
      missing.points[i]!.y,
      p.x,
      p.y,
      "arbitrary-symbol-layer",
    ),
    pathId: "missing",
    closed: true,
  }));
  const data = model({
    componentDataPartial: true,
    segments: [...model().segments, ...segments],
    symbols: [],
    texts: [text("AX", 0.43, 0.5)],
  });
  const result = analyze(data, [arbitraryReference("Valve", "AX")]);
  expect(result.candidates.find((c) => c.name === "Valve")).toMatchObject({
    point: { x: 0.42, y: 0.5 },
    marker: { legendId: "Valve" },
  });
});
it("keeps distinct tiny neighboring symbols rather than deduplicating by a fixed distance", () => {
  const tiny = (id: string, x: number) => {
    const p = bow(id, x, 0.5);
    return {
      ...p,
      points: p.points.map((q) => ({
        x: x + (q.x - x) * 0.05,
        y: 0.5 + (q.y - 0.5) * 0.05,
      })),
    };
  };
  const result = analyze(
    model({ symbols: [tiny("a", 0.5), tiny("b", 0.5004)] }),
    [arbitraryReference("Valve", "AX")],
  );
  expect(result.candidates.filter((c) => c.name === "Valve")).toHaveLength(2);
});

it("keeps the search budget available when dense strokes are outside the query area", () => {
  const nearby = line("target", 0.5, 0.49, 0.5, 0.51);
  const unrelated = Array.from({ length: 1000 }, (_, i) =>
    line(`far-${i}`, 0.535, 0.535, 0.536, 0.536),
  );
  let limited = false;
  const query = segmentGrid([...unrelated, nearby], 1, () => {
    limited = true;
  });
  for (let i = 0; i < 2200; i++)
    expect(query({ x: 0.5, y: 0.5 }, 0.0005).map((v) => v.segment.id)).toEqual([
      "target",
    ]);
  expect(limited).toBe(false);
});

it.each([0.75, 1, 20])(
  "finds segments across cell boundaries on aspect %s sheets",
  (aspect) => {
    const segments = [
      line("diagonal", 0.01, 0.01, 0.97, 0.97),
      line("horizontal", 0.01, 0.213, 0.99, 0.213),
      line("vertical", 0.432, 0.01, 0.432, 0.99),
    ];
    const query = segmentGrid(segments, aspect, () => undefined);
    for (const segment of segments)
      for (let i = 0; i <= 75; i++) {
        const t = i / 75;
        const p = {
          x: segment.x1 + (segment.x2 - segment.x1) * t,
          y: segment.y1 + (segment.y2 - segment.y1) * t,
        };
        expect(query(p, 1e-7).some((v) => v.segment.id === segment.id)).toBe(
          true,
        );
      }
  },
);

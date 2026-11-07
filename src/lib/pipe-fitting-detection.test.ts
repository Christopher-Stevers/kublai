import { describe, expect, it } from "vitest";
import { analyzePipeComponents, componentDescription } from "./pipe-components";
import {
  customComponentMarker,
  pipeComponentMarkerSchema,
} from "./pipe-component-marker";
import type {
  PipeSymbolPath,
  PipeSymbolTemplate,
} from "./pipe-components-types";
import {
  selectPipeLayerSystem,
  type PipeLinework,
  type PipeSegment,
} from "./pipe-system";

const line = (
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): PipeSegment => ({
  id,
  pathId: id,
  x1,
  y1,
  x2,
  y2,
  width: 0.0001,
  stroke: "#000000",
  dash: [],
  layer: "M-PLMB-DCWT",
});
const arc = (id: string, start: number, end: number): PipeSymbolPath => ({
  id,
  closed: end - start >= Math.PI * 2 - 1e-6,
  points: Array.from({ length: 73 }, (_, i) => ({
    x: 0.5 + 0.002 * Math.cos(start + ((end - start) * i) / 72),
    y: 0.5 + 0.002 * Math.sin(start + ((end - start) * i) / 72),
  })),
});
const up = [arc("up", 0, Math.PI * 2)];
const down = [arc("down", Math.PI / 4, (Math.PI * 7) / 4)];
const teeDown = [
  arc("dn-a", Math.PI / 4, (Math.PI * 3) / 4),
  arc("dn-b", (Math.PI * 5) / 4, (Math.PI * 7) / 4),
];
const cap: PipeSymbolPath[] = [
  {
    id: "cap",
    closed: false,
    points: [
      { x: 0.501, y: 0.498 },
      { x: 0.499, y: 0.498 },
      { x: 0.499, y: 0.502 },
      { x: 0.501, y: 0.502 },
    ],
  },
];
const ref = (name: string, paths: PipeSymbolPath[]): PipeSymbolTemplate => ({
  id: name,
  kind: componentDescription(name)?.kind ?? "other",
  name,
  box: { left: 0.49, right: 0.51, top: 0.49, bottom: 0.51 },
  reference: {
    paths,
    aspect: 1,
    abbreviation: "",
    sheetName: "Generic legend",
    sourceSheetId: "legend",
    legendId: name,
    revision: 1,
  },
});
const references = [
  ref("ELBOW TURNING UP / TEE OUTLET TURNING UP", up),
  ref("ELBOW TURNING DN / TEE OUTLET TURNING DN", down),
  ref("TEE OUTLET DOWN", teeDown),
  ref("PIPE END CAPPED", cap),
];
function analyze(
  symbols: PipeSymbolPath[],
  segments: PipeSegment[],
  templates = references,
  aspect = 1,
  partial = false,
) {
  const data: PipeLinework = {
    symbols,
    segments,
    labels: [],
    texts: [],
    aspect,
    truncated: false,
    componentDataVersion: 2,
    componentDataPartial: partial,
  };
  return analyzePipeComponents(
    data,
    selectPipeLayerSystem(data, "DCW"),
    templates,
  );
}
describe("legend-based vertical and terminal fittings", () => {
  it.each([
    ["ELBOW TURNED UP", "elbow", "90° elbow up"],
    ["45° ELBOW UP", "elbow", "45° elbow up"],
    ["ELBOW TURNING DN.", "elbow", "90° elbow down"],
    ["TEE OUTLET - UP", "tee", "Tee outlet up"],
    ["BOTTOM PIPE CONNECTION", "tee", "Tee outlet down"],
    ["PIPE END CAPPED", "cap", "Pipe end cap"],
    ["CAP OR PLUG", "cap", "Cap / plug"],
    ["DROP OR RISE", "other", "Pipe rise / drop (review)"],
  ])("preserves the meaning of %s", (label, kind, name) =>
    expect(componentDescription(label)).toMatchObject({ kind, name }),
  );
  it.each([
    "DIRECTION OF PIPE PITCH UP OR DN",
    "ROUND DUCT ELBOW UP",
    "RISER TAG",
    "SUPPLY AIR UP",
  ])("does not turn %s into a vertical pipe fitting", (text) => {
    const value = componentDescription(text);
    expect(value?.name ?? "").not.toMatch(
      /elbow up|Tee outlet|Pipe up|Pipe down/i,
    );
  });
  it.each([
    ["end up", up, [line("pipe", 0.502, 0.5, 0.7, 0.5)], "90° elbow up"],
    ["end down", down, [line("pipe", 0.5, 0.5, 0.7, 0.5)], "90° elbow down"],
    ["tee up", up, [line("pipe", 0.3, 0.5, 0.7, 0.5)], "Tee outlet up"],
    [
      "tee down",
      teeDown,
      [line("pipe", 0.3, 0.5, 0.7, 0.5)],
      "Tee outlet down",
    ],
    ["cap", cap, [line("pipe", 0.5, 0.5, 0.7, 0.5)], "Pipe end cap"],
  ] as const)(
    "finds %s by shape and pipe connection",
    (_label, paths, segments, name) => {
      const result = analyze([...paths], [...segments]);
      expect(
        result.candidates
          .filter((c) => c.source === "legend")
          .map((c) => c.name),
      ).toEqual([name]);
    },
  );
  it("matches a vertical tee drawn with two overlapping closed loops", () => {
    const doubleLoop = [
      up[0]!,
      {
        ...up[0]!,
        id: "small-loop",
        points: up[0]!.points.map((p) => ({
          x: 0.5 + (p.x - 0.5) * 0.6,
          y: 0.5 + (p.y - 0.5) * 0.6,
        })),
      },
    ];
    const result = analyze(
      doubleLoop,
      [line("through", 0.3, 0.5, 0.7, 0.5)],
      [ref("TEE OUTLET UP", doubleLoop)],
    );
    expect(
      result.candidates.filter((c) => c.source === "legend").map((c) => c.name),
    ).toEqual(["Tee outlet up"]);
  });
  it("does not reinterpret a vertical fitting outline as planar junctions", () => {
    const glyph = up[0]!;
    const strokes = glyph.points
      .slice(1)
      .map((p, i) => ({
        ...line(
          `circle-${i}`,
          glyph.points[i]!.x,
          glyph.points[i]!.y,
          p.x,
          p.y,
        ),
        pathId: glyph.id,
        closed: true,
      }));
    const result = analyze(up, [
      ...strokes,
      line("stem", 0.502, 0.5, 0.7, 0.5),
    ]);
    expect(result.candidates.map((c) => c.name)).toEqual(["90° elbow up"]);
  });
  it("ignores arbitrary stem length and works rotated on a non-square sheet", () => {
    const a = 0.37,
      aspect = 0.75;
    const project = (p: { x: number; y: number }) => ({
      x: 0.5 + (p.x - 0.5) * Math.cos(a) - (p.y - 0.5) * Math.sin(a),
      y: 0.5 + ((p.x - 0.5) * Math.sin(a) + (p.y - 0.5) * Math.cos(a)) / aspect,
    });
    const paths = down.map((p) => ({ ...p, points: p.points.map(project) }));
    const start = project({ x: 0.5, y: 0.5 }),
      end = project({ x: 0.8, y: 0.5 });
    const stem: PipeSymbolPath = {
      id: "reference-stem",
      closed: false,
      points: [
        { x: 0.5, y: 0.5 },
        { x: 0.509, y: 0.5 },
      ],
    };
    const result = analyze(
      paths,
      [line("pipe", start.x, start.y, end.x, end.y)],
      [ref("ELBOW TURNED DOWN", [...down, stem])],
      aspect,
    );
    expect(
      result.candidates.filter((c) => c.source === "legend").map((c) => c.name),
    ).toEqual(["90° elbow down"]);
  });
  it("recovers an open cap from the measurement cache without closing it", () => {
    const segments = cap[0]!.points.slice(1).map((p, i) => ({
      ...line(`cap-${i}`, cap[0]!.points[i]!.x, cap[0]!.points[i]!.y, p.x, p.y),
      pathId: "cap",
      closed: false,
    }));
    const result = analyze(
      [],
      [line("pipe", 0.5, 0.5, 0.7, 0.5), ...segments],
      references,
      1,
      true,
    );
    expect(result.candidates.some((c) => c.name === "Pipe end cap")).toBe(true);
  });
  it("does not infer caps from bare endpoints or vertical fittings from unconnected circles", () => {
    expect(analyze([], [line("pipe", 0.3, 0.5, 0.7, 0.5)]).candidates).toEqual(
      [],
    );
    expect(
      analyze(up, [line("nearby", 0.3, 0.503, 0.7, 0.503)]).candidates.filter(
        (c) => c.source === "legend",
      ),
    ).toEqual([]);
  });
  it("keeps conflicting reviewed direction meanings ambiguous", () => {
    const result = analyze(
      up,
      [line("pipe", 0.502, 0.5, 0.7, 0.5)],
      [ref("ELBOW UP", up), ref("ELBOW DOWN", up)],
    );
    expect(result.candidates.map((c) => c.name)).toEqual([
      "Ambiguous legend symbol",
    ]);
  });
  it("keeps an explicitly ambiguous rise/drop ambiguous", () => {
    const result = analyze(
      down,
      [line("pipe", 0.5, 0.5, 0.7, 0.5)],
      [ref("DROP OR RISE", down)],
    );
    expect(result.candidates.map((c) => c.name)).toEqual([
      "Pipe rise / drop (review)",
    ]);
  });
  it.each([
    ["elbow", "90° elbow up", "90° UP"],
    ["elbow", "45° elbow up", "45° UP"],
    ["elbow", "90° elbow down", "90° DN"],
    ["tee", "Tee outlet up", "T UP"],
    ["tee", "Tee outlet down", "T DN"],
  ] as const)("renders %s %s distinctly", (kind, name, label) => {
    const marker = customComponentMarker(kind, name);
    expect(marker.label).toBe(label);
    expect(pipeComponentMarkerSchema.safeParse(marker).success).toBe(true);
  });
});

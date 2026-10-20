import { describe, expect, it } from "vitest";
import { pipeTagLeaderPaths } from "./pipe-tag-leaders";
import { analyzePipeComponents } from "./pipe-components";
import {
  buildPipeSystemIndex,
  selectPipeLayerSystem,
  selectPipeSystem,
  type PipeLinework,
  type PipeSegment,
} from "./pipe-system";

function fixture(angle = 0, aspect = 1): PipeLinework {
  const point = (x: number, y: number) => ({
    x: 0.5 + x * Math.cos(angle) - y * Math.sin(angle),
    y: 0.5 + (x * Math.sin(angle) + y * Math.cos(angle)) / aspect,
  });
  const path = (
    id: string,
    coordinates: number[][],
    extra: Partial<PipeSegment> = {},
  ) =>
    coordinates.slice(1).map((p, i) => {
      const a = point(coordinates[i]![0]!, coordinates[i]![1]!),
        b = point(p[0]!, p[1]!);
      return {
        id: `${id}-${i}`,
        pathId: id,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        stroke: "#000000",
        width: 0.00025,
        dash: [],
        layer: "M-PLMB-SANI",
        ...extra,
      };
    });
  const corners = [
    [0.012, -0.012],
    [0.02, -0.012],
    [0.02, -0.008],
    [0.012, -0.008],
  ].map((p) => point(p[0]!, p[1]!));
  const segments = [
    ...path(
      "arrow",
      [
        [-0.0005, -0.003],
        [0, 0],
        [0.0005, -0.003],
        [-0.0005, -0.003],
      ],
      { closed: true, width: 0 },
    ),
    ...path("shaft", [
      [0, -0.003],
      [0, -0.01],
      [0.01, -0.01],
    ]),
    ...path(
      "tag-border",
      [
        [0.012, -0.012],
        [0.01, -0.01],
        [0.012, -0.008],
      ],
      { layer: "M-NOTE" },
    ),
    // A genuine pipe elbow touches the arrow tip. Never follow onto it.
    ...path("pipe", [
      [-0.01, 0],
      [0, 0],
      [0, 0.01],
    ]),
  ];
  return {
    aspect,
    segments,
    labels: [],
    truncated: false,
    componentDataVersion: 3,
    texts: [
      {
        text: "PD-53",
        left: Math.min(...corners.map((p) => p.x)),
        right: Math.max(...corners.map((p) => p.x)),
        top: Math.min(...corners.map((p) => p.y)),
        bottom: Math.max(...corners.map((p) => p.y)),
      },
    ],
    symbols: ["arrow", "shaft"].map((id) => {
      const parts = segments.filter((s) => s.pathId === id);
      return {
        id,
        closed: id === "arrow",
        layer: "M-PLMB-SANI",
        points: [
          { x: parts[0]!.x1, y: parts[0]!.y1 },
          ...parts.map((s) => ({ x: s.x2, y: s.y2 })),
        ],
      };
    }),
  };
}

describe("tag leader exclusion", () => {
  it.each([
    [0, 1],
    [0.37, 0.75],
    [Math.PI / 2, 0.75],
    [Math.PI, 1],
  ])(
    "recognizes tagged arrows at rotation %s and aspect %s",
    (angle, aspect) => {
      const data = fixture(angle, aspect),
        before = structuredClone(data);
      expect([...pipeTagLeaderPaths(data)].sort()).toEqual(["arrow", "shaft"]);
      const selected = selectPipeLayerSystem(data, "SAN");
      expect(selected.segments.map((s) => s.pathId)).toEqual(["pipe", "pipe"]);
      expect(selected.lengthInSheetWidths).toBeCloseTo(0.02, 8);
      expect(data).toEqual(before);
    },
  );
  it("excludes leaders from taps and symbol recovery while retaining the touched elbow", () => {
    for (const componentDataPartial of [false, true]) {
      const data = { ...fixture(), componentDataPartial };
      const index = buildPipeSystemIndex(data);
      const selected = selectPipeSystem(index, { x: 0.495, y: 0.5 }, 0.00001);
      expect(selected.segments.map((s) => s.pathId)).toEqual(["pipe", "pipe"]);
      expect(
        selectPipeSystem(index, { x: 0.5, y: 0.495 }, 0.00001).segments,
      ).toEqual([]);
      const result = analyzePipeComponents(data, selected);
      expect(result.candidates).toEqual([
        expect.objectContaining({ kind: "elbow", point: { x: 0.5, y: 0.5 } }),
      ]);
    }
  });
  it("also excludes leaders from unclassified connected traces", () => {
    const data = fixture();
    data.segments = data.segments.map((s) =>
      s.layer === "M-NOTE" ? s : { ...s, layer: "M-PLMB-MISC" },
    );
    const selected = selectPipeSystem(
      buildPipeSystemIndex(data),
      { x: 0.495, y: 0.5 },
      0.00001,
    );
    expect(selected.segments.map((s) => s.pathId)).toEqual(["pipe", "pipe"]);
    expect(selected.excludedAnnotationPathIds?.sort()).toEqual([
      "arrow",
      "shaft",
    ]);
  });
  it("keeps shafts without both tag text and annotation border evidence", () => {
    const data = fixture();
    for (const changed of [
      { ...data, texts: [] },
      { ...data, texts: data.texts!.map((t) => ({ ...t, text: '2"' })) },
      {
        ...data,
        segments: data.segments.filter((s) => s.pathId !== "tag-border"),
      },
      { ...data, segments: data.segments.filter((s) => s.pathId !== "arrow") },
    ])
      expect(pipeTagLeaderPaths(changed).size).toBe(0);
  });
  it("keeps fitting triangles, mismatched shafts, and shafts pointing into the arrow", () => {
    const data = fixture();
    for (const segments of [
      data.segments.map((s) =>
        s.pathId === "arrow" ? { ...s, width: 0.00025 } : s,
      ),
      data.segments.map((s) =>
        s.pathId === "shaft" ? { ...s, layer: "M-PLMB-VENT" } : s,
      ),
      data.segments.map((s) =>
        s.pathId === "shaft" ? { ...s, stroke: "#ff0000" } : s,
      ),
      data.segments.map((s) =>
        s.pathId === "shaft" ? { ...s, dash: [0.001] } : s,
      ),
      data.segments.map((s) =>
        s.pathId === "shaft" ? { ...s, y1: 0.994 - s.y1, y2: 0.994 - s.y2 } : s,
      ),
    ])
      expect(pipeTagLeaderPaths({ ...data, segments }).size).toBe(0);
  });
  it("retains ambiguous shafts and handles reversed source paths", () => {
    const data = fixture();
    const duplicate = data.segments
      .filter((s) => s.pathId === "shaft")
      .map((s) => ({ ...s, id: `${s.id}-copy`, pathId: "another-shaft" }));
    expect(
      pipeTagLeaderPaths({
        ...data,
        segments: [...data.segments, ...duplicate],
      }).size,
    ).toBe(0);
    expect(
      [
        ...pipeTagLeaderPaths({
          ...data,
          segments: data.segments
            .map((s) => ({ ...s, x1: s.x2, y1: s.y2, x2: s.x1, y2: s.y1 }))
            .reverse(),
        }),
      ].sort(),
    ).toEqual(["arrow", "shaft"]);
  });
});

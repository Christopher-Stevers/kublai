import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  customComponentMarker,
  vectorComponentMarker,
  pipeComponentColor,
  pipeComponentMarkerSchema,
  componentMarkerPath,
} from "./pipe-component-marker";
import { drawingMarkupSchema } from "./drawing-workspace";
import { DrawingAnnotationSvg } from "~/components/jobs/DrawingAnnotationSvg";
import { drawingMarkupBounds } from "./drawing-annotation-geometry";
import { PipeComponentSymbol } from "~/components/jobs/PipeComponentSymbol";

describe("component symbol rendering", () => {
  it("keeps actual vector geometry, proportions and source identity through storage", () => {
    const marker = vectorComponentMarker(
      [
        {
          id: "symbol",
          closed: true,
          points: [
            { x: 0.2, y: 0.4 },
            { x: 0.21, y: 0.42 },
            { x: 0.2, y: 0.42 },
            { x: 0.21, y: 0.4 },
          ],
        },
      ],
      2,
      "legend-123",
    )!;
    expect(marker.legendId).toBe("legend-123");
    expect(marker.span).toBeCloseTo(0.04);
    expect(marker.paths[0]!.points[0]!.x).toBeCloseTo(-0.25);
    expect(marker.paths[0]!.points[0]!.y).toBeCloseTo(-1);
    const data = drawingMarkupSchema.parse({
      sourceSheetId: "031060be-2d10-4c21-bda2-dd1619a1e280",
      type: "count",
      points: [{ x: 0.5, y: 0.5 }],
      stroke: "#a855f7",
      pipeComponent: {
        candidateId: "one",
        fingerprint: "one",
        sourceKey: "source",
        kind: "valve",
        name: "Valve",
        system: "DCW",
        evidence: "Saved legend",
        source: "legend",
        marker,
      },
    });
    expect(data.pipeComponent!.marker).toEqual(marker);
    const svg = renderToStaticMarkup(
      <DrawingAnnotationSvg data={data} aspect={2} />,
    );
    expect(svg).toContain(componentMarkerPath(marker, 500, 1000));
    expect(svg).toContain("#a855f7");
    expect(svg).not.toContain("1 count");
    expect(svg).not.toContain("<circle");
    const bounds=drawingMarkupBounds(data,2);
    expect(bounds.left).toBeCloseTo(.48);
    expect(bounds.right).toBeCloseTo(.52);
    expect(bounds.top).toBeCloseTo(.49);
    expect(bounds.bottom).toBeCloseTo(.51);
  });
  it("draws distinct generic elbow angles, tees, and vertical directions", () => {
    const symbols = [
      customComponentMarker("elbow", "90° elbow"),
      customComponentMarker("elbow", "45° elbow"),
      customComponentMarker("elbow", "22.5° elbow"),
      customComponentMarker("tee", "Tee"),
      customComponentMarker("rise", "Pipe up"),
      customComponentMarker("drop", "Pipe down"),
    ];
    expect(new Set(symbols.map((s) => componentMarkerPath(s, 0, 0))).size).toBe(
      6,
    );
    expect(symbols.map((s) => s.label)).toEqual([
      "90°",
      "45°",
      "22.5°",
      "T",
      "UP",
      "DN",
    ]);
    for (const marker of symbols)
      expect(pipeComponentMarkerSchema.safeParse(marker).success).toBe(true);
    expect(customComponentMarker("elbow", "22° elbow").label).toBe("22.5°");
  });
  it("uses the actual pipe directions without rotating every fitting to the same pose", () => {
    const marker = customComponentMarker("elbow", "90° elbow", [
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ]);
    expect(marker.paths.map((p) => p.points[1])).toEqual([
      { x: 0, y: 0.85 },
      { x: 0.85, y: 0 },
    ]);
  });
  it("distinguishes pending from confirmed markers and escapes arbitrary names", () => {
    const props = {
      marker: customComponentMarker("drop", "Pipe down"),
      x: 10,
      y: 20,
      color: "#fbbf24",
      name: "<script>bad</script>",
    };
    const pending = renderToStaticMarkup(
      <PipeComponentSymbol {...props} pending />,
    );
    expect(pending).toContain("stroke-dasharray");
    expect(pending).not.toContain("<script>");
    expect(
      renderToStaticMarkup(<PipeComponentSymbol {...props} />),
    ).not.toContain("stroke-dasharray");
  });
  it("chooses a different color from every common pipe color", () => {
    for (const color of [
      "#fbbf24",
      "#a855f7",
      "#06b6d4",
      "#ffffff",
      "#000000",
      "#3b82f6",
      "#22c55e",
      "#ef4444",
    ])
      expect(pipeComponentColor(color)).not.toBe(color);
  });
  it("bounds vector storage and rejects nonfinite coordinates", () => {
    expect(
      vectorComponentMarker(
        [
          {
            id: "x",
            closed: false,
            points: [
              { x: NaN, y: 0 },
              { x: 1, y: 1 },
            ],
          },
        ],
        1,
      ),
    ).toBeUndefined();
    expect(
      vectorComponentMarker(
        Array.from({ length: 101 }, (_, i) => ({
          id: String(i),
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 0.01, y: 0.01 },
          ],
        })),
        1,
      ),
    ).toBeUndefined();
    const marker = customComponentMarker("tee", "Tee");
    expect(
      pipeComponentMarkerSchema.safeParse({ ...marker, span: Infinity })
        .success,
    ).toBe(false);
    expect(
      pipeComponentMarkerSchema.safeParse({
        ...marker,
        paths: Array.from({ length: 100 }, () => ({
          points: Array.from({ length: 30 }, () => ({ x: 0, y: 0 })),
          closed: false,
        })),
      }).success,
    ).toBe(false);
  });
});

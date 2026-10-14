import { describe, expect, it } from "vitest";
import {
  drawingAngle,
  drawingArea,
  drawingCloudPath,
  drawingFontSize,
  drawingMarkupBounds,
  layoutDrawingText,
  wrapDrawingText,
  drawingMeasurement,
  drawingLinePath,
  resizeDrawingMarkup,
  simplifyDrawingStroke,
  translateDrawingPoints,
  type DrawingResizeHandle,
} from "./drawing-annotation-geometry";
import { drawingMarkupSchema, type DrawingMarkup } from "./drawing-workspace";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { DrawingAnnotationSvg } from "~/components/jobs/DrawingAnnotationSvg";

const rectangle: DrawingMarkup = {
  sourceSheetId: "0391aed4-7773-47ec-9141-09df373ec008",
  type: "rect",
  points: [
    { x: 0.2, y: 0.3 },
    { x: 0.6, y: 0.7 },
  ],
  stroke: "#ff0000",
  width: 2,
};
const expectPointsOnPage = (data: DrawingMarkup) => {
  for (const point of data.points) {
    expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.x).toBeLessThanOrEqual(1);
    expect(point.y).toBeGreaterThanOrEqual(0);
    expect(point.y).toBeLessThanOrEqual(1);
  }
};

describe("drawing annotation geometry", () => {
  it("measures area and angles in physical sheet coordinates, including non-square pages", () => {
    const triangle = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(drawingArea(triangle, 0.5, 100)).toBe(2500);
    expect(
      drawingAngle(
        [
          { x: 1, y: 0 },
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        0.5,
      ),
    ).toBeCloseTo(26.565, 3);
    expect(
      drawingAngle(
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        0.5,
      ),
    ).toBeNull();
  });
  it("uses a saved measurement scale or shared calibration, never a guessed length", () => {
    const data: DrawingMarkup = {
      sourceSheetId: "sheet",
      type: "dimension",
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
      ],
      stroke: "#ff0000",
      width: 2,
    };
    expect(drawingMeasurement(data, 0.5)).toBe("Set scale");
    expect(
      drawingMeasurement(data, 0.5, { unit: "ft", unitsPerSheetWidth: 100 }),
    ).toBe("50'-0\"");
    expect(
      drawingMeasurement({ ...data, scale: 20, unit: "m" }, 0.5, {
        unit: "ft",
        unitsPerSheetWidth: 100,
      }),
    ).toBe("10 m");
  });
  it("preserves a branched measurement through schema parsing, SVG and resizing", () => {
    const data = drawingMarkupSchema.parse({
      ...rectangle,
      type: "dimension",
      unit: "ft",
      scale: 100,
      points: [
        { x: 0.2, y: 0.5 },
        { x: 0.8, y: 0.5 },
        { x: 0.5, y: 0.5 },
        { x: 0.5, y: 0.2 },
      ],
      parents: [null, 2, 0, 2],
    });
    expect(drawingMeasurement(data, 0.5)).toBe("75'-0\"");
    expect(drawingLinePath(data, 0.5)).toBe(
      "M 500 250 L 800 250 M 200 250 L 500 250 M 500 250 L 500 100",
    );
    const svg = renderToStaticMarkup(
      createElement(DrawingAnnotationSvg, { data, aspect: 0.5 }),
    );
    expect(svg).toContain(drawingLinePath(data, 0.5));
    expect(svg).toContain("75&#x27;-0&quot;");
    expect(svg).toContain('data-measurement-segment="3"');
    const resized = resizeDrawingMarkup(data, "se", { x: 0.9, y: 0.7 }, 0.5);
    expect(resized.parents).toEqual(data.parents);
    expect(drawingMarkupSchema.safeParse(resized).success).toBe(true);
  });

  it("rejects invalid measurement graphs without rejecting forward references from split branches", () => {
    const data = {
      ...rectangle,
      type: "dimension",
      points: [
        { x: 0.1, y: 0.2 },
        { x: 0.5, y: 0.2 },
        { x: 0.3, y: 0.2 },
      ],
    };
    for (const parents of [
      [null, 0],
      [null, 5, 0],
      [null, 1, 0],
      [1, 2, 0],
      [null, null, null],
    ]) {
      expect(drawingMarkupSchema.safeParse({ ...data, parents }).success).toBe(
        false,
      );
    }
    expect(
      drawingMarkupSchema.safeParse({ ...data, parents: [null, 2, 0] }).success,
    ).toBe(true);
    expect(
      drawingMarkupSchema.safeParse({
        ...data,
        type: "polyline",
        parents: [null, 2, 0],
      }).success,
    ).toBe(false);
  });
  it("moves a whole shape without deforming it or crossing the page edge", () => {
    expect(
      translateDrawingPoints(
        [
          { x: 0.2, y: 0.3 },
          { x: 0.8, y: 0.6 },
        ],
        { x: 0.5, y: -0.5 },
      ),
    ).toEqual([
      { x: 0.39999999999999997, y: 0 },
      { x: 1, y: 0.3 },
    ]);
  });
  it("simplifies redundant pen samples but keeps corners and renders actual cloud polygons", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.1, y: 0 },
      { x: 0.2, y: 0 },
      { x: 0.2, y: 0.2 },
    ];
    expect(simplifyDrawingStroke(points, 0.001, 0.5)).toEqual([
      points[0],
      points[2],
      points[3],
    ]);
    const cloud = drawingCloudPath(
      [
        { x: 0, y: 0 },
        { x: 0.2, y: 0 },
        { x: 0.1, y: 0.2 },
      ],
      0.5,
    );
    expect(cloud).toMatch(/^M 0 0 Q /);
    expect(cloud).toContain("100 100");
    expect(cloud).toMatch(/ Z$/);
  });
  it.each<{
    handle: DrawingResizeHandle;
    point: { x: number; y: number };
    expected: { left: number; top: number; right: number; bottom: number };
  }>([
    {
      handle: "nw",
      point: { x: 0.1, y: 0.2 },
      expected: { left: 0.1, top: 0.2, right: 0.6, bottom: 0.7 },
    },
    {
      handle: "ne",
      point: { x: 0.8, y: 0.2 },
      expected: { left: 0.2, top: 0.2, right: 0.8, bottom: 0.7 },
    },
    {
      handle: "sw",
      point: { x: 0.1, y: 0.9 },
      expected: { left: 0.1, top: 0.3, right: 0.6, bottom: 0.9 },
    },
    {
      handle: "se",
      point: { x: 0.8, y: 0.9 },
      expected: { left: 0.2, top: 0.3, right: 0.8, bottom: 0.9 },
    },
  ])(
    "resizes from $handle while anchoring the opposite corner",
    ({ handle, point, expected }) => {
      const resized = resizeDrawingMarkup(rectangle, handle, point, 0.5);
      const bounds = drawingMarkupBounds(resized, 0.5);
      for (const side of ["left", "top", "right", "bottom"] as const)
        expect(bounds[side]).toBeCloseTo(expected[side]);
      expectPointsOnPage(resized);
      expect(rectangle.points).toEqual([
        { x: 0.2, y: 0.3 },
        { x: 0.6, y: 0.7 },
      ]);
    },
  );
  it("scales every point of long pen strokes and retains metadata and calibration", () => {
    const data: DrawingMarkup = {
      ...rectangle,
      type: "freehand",
      fill: "#ffffff",
      opacity: 0.4,
      scale: 100,
      unit: "ft",
      text: "Retain this",
      href: "https://example.com/spec",
      points: Array.from({ length: 200 }, (_, index) => ({
        x: 0.2 + (index / 199) * 0.4,
        y: 0.3 + (index / 199) * 0.4,
      })),
    };
    const resized = resizeDrawingMarkup(data, "se", { x: 1, y: 0.9 }, 0.5);
    expect(resized.points).toHaveLength(200);
    expect(resized.points[0]).toEqual(data.points[0]);
    expect(resized.points[199]!.x).toBeCloseTo(1);
    expect(resized.points[199]!.y).toBeCloseTo(0.9);
    expect(resized.points[73]!.x).toBeCloseTo(0.2 + (73 / 199) * 0.8);
    expect(resized.points[73]!.y).toBeCloseTo(0.3 + (73 / 199) * 0.6);
    expect({ ...resized, points: data.points }).toEqual(data);
  });
  it("clamps page edges and avoids inverted geometry when a handle crosses the anchor", () => {
    const resized = resizeDrawingMarkup(rectangle, "nw", { x: -10, y: -5 }, 2);
    expect(resized.points).toEqual([
      { x: 0, y: 0 },
      { x: 0.6, y: 0.7 },
    ]);
    const crossed = resizeDrawingMarkup(rectangle, "se", { x: -1, y: -1 }, 2);
    expect(crossed.points[1]!.x).toBeGreaterThan(crossed.points[0]!.x);
    expect(crossed.points[1]!.y).toBeGreaterThan(crossed.points[0]!.y);
    expectPointsOnPage(crossed);
    expect(resizeDrawingMarkup(rectangle, "se", { x: NaN, y: 0.5 }, 2)).toBe(
      rectangle,
    );
  });
  it("keeps flat strokes and single count points finite on non-square pages", () => {
    for (const data of [
      {
        ...rectangle,
        type: "line" as const,
        points: [
          { x: 0.2, y: 0.5 },
          { x: 0.6, y: 0.5 },
        ],
      },
      {
        ...rectangle,
        type: "line" as const,
        points: [
          { x: 1, y: 0.2 },
          { x: 1, y: 0.8 },
        ],
      },
      { ...rectangle, type: "count" as const, points: [{ x: 0, y: 0 }] },
    ]) {
      const bounds = drawingMarkupBounds(data, 0.25);
      expect(bounds.right).toBeGreaterThan(bounds.left);
      expect(bounds.bottom).toBeGreaterThan(bounds.top);
      const resized = resizeDrawingMarkup(data, "se", { x: 0.9, y: 0.9 }, 0.25);
      expect(resized.points).toHaveLength(data.points.length);
      expectPointsOnPage(resized);
    }
  });
  it("resizes a text box both ways, keeps its size, and anchors the opposite corner", () => {
    const data: DrawingMarkup = {
      ...rectangle,
      type: "text",
      text: "abcd",
      fontSize: 40,
      points: [{ x: 0.2, y: 0.5 }],
    };
    const bounds = drawingMarkupBounds(data, 0.5);
    expect(bounds.top).toBeCloseTo(0.436);
    expect(bounds.bottom).toBeCloseTo(0.516);
    const wider = resizeDrawingMarkup(
      data,
      "se",
      { x: bounds.left + 0.3, y: bounds.top + 0.2 },
      0.5,
    );
    expect(wider.fontSize).toBe(40);
    expect(wider.textBox!.width).toBeCloseTo(300);
    expect(wider.textBox!.height).toBeCloseTo(100);
    expect(wider.points[0]!.x).toBeCloseTo(0.2);
    const widerBounds = drawingMarkupBounds(wider, 0.5);
    expect(widerBounds.right).toBeCloseTo(bounds.left + 0.3);
    expect(widerBounds.bottom).toBeCloseTo(bounds.top + 0.2);
    const fromCorner = resizeDrawingMarkup(
      wider,
      "nw",
      { x: widerBounds.left + 0.1, y: widerBounds.top + 0.05 },
      0.5,
    );
    const cornerBounds = drawingMarkupBounds(fromCorner, 0.5);
    expect(cornerBounds.right).toBeCloseTo(widerBounds.right);
    expect(cornerBounds.bottom).toBeCloseTo(widerBounds.bottom);
  });
  it("wraps words to the box width and shrinks text only when the box is full", () => {
    const measure = (line: string, size: number) => line.length * size * 0.5;
    expect(wrapDrawingText("one two three", 10, 40, measure)).toEqual([
      "one two",
      "three",
    ]);
    expect(wrapDrawingText("abcdefghijkl", 10, 30, measure)).toEqual([
      "abcdef",
      "ghijkl",
    ]);
    const roomy = layoutDrawingText(
      {
        text: "one two three",
        fontSize: 10,
        width: 2,
        textBox: { width: 40, height: 100 },
      },
      measure,
    );
    expect(roomy).toEqual({ lines: ["one two", "three"], fontSize: 10 });
    const tight = layoutDrawingText(
      {
        text: "one two three",
        fontSize: 10,
        width: 2,
        textBox: { width: 40, height: 12 },
      },
      measure,
    );
    expect(tight.fontSize).toBeLessThan(10);
    expect(tight.lines.length * tight.fontSize * 1.25).toBeLessThanOrEqual(
      12 + tight.fontSize * 0.25,
    );
  });
  it("keeps resized text boxes inside the page", () => {
    const data: DrawingMarkup = {
      ...rectangle,
      type: "text",
      text: "abcd",
      fontSize: 40,
      points: [{ x: 0.2, y: 0.5 }],
    };
    const large = resizeDrawingMarkup(data, "se", { x: 5, y: 5 }, 0.5);
    const bounds = drawingMarkupBounds(large, 0.5);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(1);
    expect(bounds.bottom).toBeLessThanOrEqual(1);
    const overflow: DrawingMarkup = {
      ...data,
      text: "An overflowing note",
      points: [{ x: 0.99, y: 0 }],
    };
    const visible = drawingMarkupBounds(overflow, 0.5);
    expect(visible.top).toBe(0);
    expect(visible.right).toBe(1);
    const fixed = resizeDrawingMarkup(overflow, "nw", { x: 0.5, y: 0.1 }, 0.5);
    const fixedBounds = drawingMarkupBounds(fixed, 0.5);
    expect(fixedBounds.left).toBeGreaterThanOrEqual(0);
    expect(fixedBounds.top).toBeGreaterThanOrEqual(0);
    expect(fixedBounds.right).toBeLessThanOrEqual(1);
    expect(fixedBounds.bottom).toBeLessThanOrEqual(1);
    expectPointsOnPage(fixed);
  });
  it("preserves legacy font size and persists the optional size used by SVG labels", () => {
    expect(drawingFontSize(rectangle)).toBe(18);
    expect(drawingFontSize({ width: 10 })).toBe(34);
    const text = drawingMarkupSchema.parse({
      ...rectangle,
      type: "text",
      fontSize: 48,
      text: "First\nSecond",
      points: [{ x: 0.2, y: 0.5 }],
    });
    expect(text.fontSize).toBe(48);
    expect(
      drawingMarkupSchema.safeParse({ ...text, fontSize: 301 }).success,
    ).toBe(false);
    expect(
      drawingMarkupSchema.safeParse({ ...text, fontSize: 5 }).success,
    ).toBe(false);
    const svg = renderToStaticMarkup(
      createElement(DrawingAnnotationSvg, { data: text, aspect: 0.5 }),
    );
    expect(svg).toContain('font-size="48"');
    expect(svg).toContain('dy="60"');
    expect(svg).toContain("First");
    expect(svg).toContain("Second");
  });
  it("keeps cropped text handles reachable and returns schema-valid resizes at every page corner", () => {
    const handles: DrawingResizeHandle[] = ["nw", "ne", "sw", "se"];
    for (const anchor of [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]) {
      for (const aspect of [0.25, 1, 2]) {
        for (const text of ["Boundary", "W".repeat(4000), "\n".repeat(4000)]) {
          const data = drawingMarkupSchema.parse({
            ...rectangle,
            type: "text",
            fontSize: 300,
            text,
            points: [anchor],
          });
          const bounds = drawingMarkupBounds(data, aspect);
          expect(bounds.right).toBeGreaterThan(bounds.left);
          expect(bounds.bottom).toBeGreaterThan(bounds.top);
          for (const value of Object.values(bounds)) {
            expect(Number.isFinite(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
          }
          for (const handle of handles) {
            const resized = resizeDrawingMarkup(
              data,
              handle,
              { x: 0.5, y: 0.5 },
              aspect,
            );
            expect(drawingMarkupSchema.safeParse(resized).success).toBe(true);
            expectPointsOnPage(resized);
            expect(resized.fontSize).toBeGreaterThanOrEqual(6);
            expect(resized.fontSize).toBeLessThanOrEqual(300);
            expect(resized.text).toBe(text);
          }
        }
      }
    }
  });
});

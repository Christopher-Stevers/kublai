import { describe, expect, it } from "vitest";
import {
  drawingAngle,
  drawingArea,
  drawingCloudPath,
  drawingFontSize,
  drawingMarkupBounds,
  drawingMeasurement,
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
  it("resizes text uniformly, moves its baseline, and preserves the opposite glyph corner", () => {
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
    const doubled = resizeDrawingMarkup(
      data,
      "se",
      {
        x: bounds.left + 2 * (bounds.right - bounds.left),
        y: bounds.top + 2 * (bounds.bottom - bounds.top),
      },
      0.5,
    );
    expect(doubled.fontSize).toBeCloseTo(80);
    expect(doubled.points[0]!.x).toBeCloseTo(0.2);
    expect(doubled.points[0]!.y).toBeCloseTo(0.564);
    const smaller = resizeDrawingMarkup(
      data,
      "nw",
      {
        x: (bounds.left + bounds.right) / 2,
        y: (bounds.top + bounds.bottom) / 2,
      },
      0.5,
    );
    expect(smaller.fontSize).toBeCloseTo(20);
    const smallerBounds = drawingMarkupBounds(smaller, 0.5);
    expect(smallerBounds.right).toBeCloseTo(bounds.right);
    expect(smallerBounds.bottom).toBeCloseTo(bounds.bottom);
  });
  it("bounds resized text size and fits ordinary notes inside the page", () => {
    const data: DrawingMarkup = {
      ...rectangle,
      type: "text",
      text: "abcd",
      fontSize: 40,
      points: [{ x: 0.2, y: 0.5 }],
    };
    const large = resizeDrawingMarkup(data, "se", { x: 5, y: 5 }, 0.5);
    const bounds = drawingMarkupBounds(large, 0.5);
    expect(large.fontSize).toBeLessThanOrEqual(300);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(1);
    expect(bounds.bottom).toBeLessThanOrEqual(1);
    const small = resizeDrawingMarkup(data, "se", { x: -1, y: -1 }, 0.5);
    expect(small.fontSize).toBe(6);
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
});

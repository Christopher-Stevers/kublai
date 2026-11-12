// Authored source-only during calibration. No test/import/render execution yet.
import { describe, expect, it } from "vitest";
import { getScaleForStroking, rescaleAndStroke, setStrokeStyle } from "./stroke-style";
import type { StrokeTransform } from "./stroke-style";
const matrix = (a = 1, b = 0, c = 0, d = 1): StrokeTransform => ({ a, b, c, d, e: 3, f: 5 });

describe("installed pdf.js 6.2.108 stroke compensation equations", () => {
  it.each([
    [matrix(), 0, [1, 1]], [matrix(), 0.25, [4, 4]], [matrix(), 2, [1, 1]],
    [matrix(2, 0, 0, 2), 0, [0.5, 0.5]], [matrix(2, 0, 0, 2), 0.25, [2, 2]],
    [matrix(0.25, 0, 0, 0.25), 0, [4, 4]], [matrix(0.25, 0, 0, 0.25), 0.5, [8, 8]],
    [matrix(-2, 0, 0, 2), 0, [0.5, 0.5]],
    [matrix(0, 2, -2, 0), 0, [0.5, 0.5]], [matrix(0, 2, -2, 0), 0.25, [2, 2]],
    [matrix(2, 0, 0, 0.5), 0, [0.5, 2]], [matrix(2, 0, 0, 0.5), 0.5, [1, 4]],
    [matrix(2, 0, 0, 0.5), 1, [1, 2]], [matrix(2, 0, 0, 0.5), 2, [1, 1]],
    [matrix(1, 0, 1, 1), 0, [Math.SQRT2, 1]], [matrix(1, 0, 1, 1), 0.5, [2 * Math.SQRT2, 2]],
    [matrix(1, 0, 1, 1), 2, [1, 1]],
  ] as Array<[StrokeTransform, number, [number, number]]>)("uses the reference scales for %j at logical width %s", (ctm, width, expected) => {
    const actual = getScaleForStroking(width, ctm);
    expect(actual[0]).toBeCloseTo(expected[0], 12);
    expect(actual[1]).toBeCloseTo(expected[1], 12);
  });
  it.each([
    [-1, matrix(), "invalid-stroke-width"], [NaN, matrix(), "invalid-stroke-width"],
    [Infinity, matrix(), "invalid-stroke-width"],
    [0, matrix(1, 2, 2, 4), "unsupported-singular-stroke-transform"],
    [0, matrix(0, 0, 0, 1), "unsupported-singular-stroke-transform"],
    [1, { ...matrix(), e: NaN }, "invalid-stroke-transform"],
    [0, matrix(1e308, 0, 0, 1e308), "unsupported-stroke-compensation-range"],
    [0, matrix(1e-310, 0, 0, 1e308), "unsupported-stroke-compensation-range"],
  ] as Array<[number, StrokeTransform, string]>)("explicitly rejects unsupported width/transform %s %j", (width, ctm, reason) => {
    expect(() => getScaleForStroking(width, ctm)).toThrow(reason);
  });
});

function context(ctm: StrokeTransform) {
  let current = { ctm: { ...ctm }, width: 7, dash: [4, 2], phase: 3 };
  const saved: typeof current[] = [];
  const strokes: typeof current[] = [];
  const copy = () => ({ ...current, ctm: { ...current.ctm }, dash: [...current.dash] });
  return {
    strokes,
    get depth() { return saved.length; },
    get lineWidth() { return current.width; },
    set lineWidth(value: number) { if (value > 0 && Number.isFinite(value)) current.width = value; },
    get lineDashOffset() { return current.phase; }, set lineDashOffset(value: number) { current.phase = value; },
    getTransform: () => ({ ...current.ctm }), getLineDash: () => [...current.dash],
    setLineDash: (value: number[]) => { current.dash = [...value]; },
    save: () => { saved.push(copy()); }, restore: () => { current = saved.pop()!; },
    scale: (x: number, y: number) => { current.ctm = { ...current.ctm,
      a: current.ctm.a * x, b: current.ctm.b * x, c: current.ctm.c * y, d: current.ctm.d * y }; },
    stroke: () => { strokes.push(copy()); },
    lineCap: "butt", lineJoin: "miter", miterLimit: 10,
  };
}

it("keeps uniform dash lengths/phase unchanged and sets scalar minimum width without rebuilding", () => {
  const ctx = context(matrix(0.25, 0, 0, 0.25));
  let rebuilt = false;
  rescaleAndStroke(ctx, 0, () => { rebuilt = true; });
  expect(rebuilt).toBe(false);
  expect(ctx.strokes[0]).toMatchObject({ width: 4, dash: [4, 2], phase: 3 });
  expect(ctx.depth).toBe(0);
});
it("matches inverse-path affine geometry and anisotropic dash compensation, then restores canvas state", () => {
  const initial = matrix(1, 0, 1, 1), ctx = context(initial);
  const point = [6, 8];
  let rebuiltPoint: number[] | undefined;
  rescaleAndStroke(ctx, 0, (x, y) => { rebuiltPoint = [point[0]! * x, point[1]! * y]; });
  const painted = ctx.strokes[0]!;
  const project = (m: StrokeTransform, p: number[]) => [m.a * p[0]! + m.c * p[1]! + m.e, m.b * p[0]! + m.d * p[1]! + m.f];
  const actual = project(painted.ctm, rebuiltPoint!), expected = project(initial, point);
  expect(actual[0]).toBeCloseTo(expected[0], 12);
  expect(actual[1]).toBeCloseTo(expected[1], 12);
  expect(painted.width).toBe(1);
  expect(painted.dash[0]).toBeCloseTo(4 / Math.SQRT2, 12);
  expect(painted.dash[1]).toBeCloseTo(2 / Math.SQRT2, 12);
  expect(painted.phase).toBeCloseTo(3 / Math.SQRT2, 12);
  expect(ctx.getTransform()).toEqual(initial);
  expect(ctx.getLineDash()).toEqual([4, 2]);
  expect(ctx.lineDashOffset).toBe(3);
  expect(ctx.lineWidth).toBe(7);
  expect(ctx.depth).toBe(0);
});
it("restores a compensated context when path reconstruction refuses", () => {
  const initial = matrix(2, 0, 0, 0.5), ctx = context(initial);
  expect(() => rescaleAndStroke(ctx, 0, () => { throw Error("fixture refused path"); })).toThrow("fixture refused path");
  expect(ctx.getTransform()).toEqual(initial);
  expect(ctx.getLineDash()).toEqual([4, 2]);
  expect(ctx.depth).toBe(0);
});
it("preserves logical zero despite Canvas ignoring zero width and validates ordinary/GState styles identically", () => {
  const ctx = context(matrix());
  expect(setStrokeStyle(ctx, "LW", 0, 1)).toBe(0);
  expect(ctx.lineWidth).toBe(7);
  setStrokeStyle(ctx, "LC", 2, 0); setStrokeStyle(ctx, "LJ", 1, 0);
  setStrokeStyle(ctx, "ML", 5, 0); setStrokeStyle(ctx, "D", [[3, 2], -4], 0);
  expect(ctx.lineCap).toBe("square"); expect(ctx.lineJoin).toBe("round");
  expect(ctx.miterLimit).toBe(5); expect(ctx.getLineDash()).toEqual([3, 2]);
  expect(ctx.lineDashOffset).toBe(-4);
});
it.each([
  ["LW", -1], ["LC", 3], ["LJ", -1], ["ML", 0],
  ["D", [[0, 0], 0]], ["D", [[-1, 2], 0]], ["D", [[1, 2], Infinity]],
] as Array<["LW" | "LC" | "LJ" | "ML" | "D", unknown]>)("refuses invalid style %s without silently accepting it", (key, value) => {
  expect(() => setStrokeStyle(context(matrix()), key, value, 1)).toThrow();
});

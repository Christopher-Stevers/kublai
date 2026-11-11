import { describe, it, expect } from "vitest";
import { classify, countPackedPaths, replayPaths } from "./operators";
import { createCanvas } from "@napi-rs/canvas";
describe("drawing spike operator front end", () => {
  it("counts packed pdf.js paths without treating control points as line segments", () => {
    expect(
      countPackedPaths([
        20,
        [new Float32Array([0, 0, 0, 1, 10, 10, 2, 10, 10, 20, 20, 30, 30, 4])],
      ]),
    ).toEqual({ segments: 3, subpaths: 1, curves: 1 });
  });
  it("records permanent unsupported feature categories and compresses operator-only payload", () => {
    const r = classify(
      {
        fnArray: [1, 2, 3],
        argsArray: [
          [],
          [],
          [
            [
              ["SMask", true],
              ["BM", "multiply"],
            ],
          ],
        ],
      },
      { 1: "shadingFill", 2: "setFillColorN", 3: "setGState" },
    );
    expect(r.unsupported.sort()).toEqual([
      "blend-mode",
      "gradient-or-shading",
      "pattern-color",
      "soft-mask",
    ]);
    expect(r.operatorOnlyBrotliBytes).toBeGreaterThan(0);
  });
  it("renders a supported filled path under the supplied viewport transform", () => {
    const canvas = createCanvas(20, 20),
      ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 20, 20);
    replayPaths(
      ctx,
      {
        fnArray: [1],
        argsArray: [
          [2, [new Float32Array([0, 2, 2, 1, 10, 2, 1, 10, 10, 1, 2, 10, 4])]],
        ],
      },
      { 1: "constructPath", 2: "fill" },
      [1, 0, 0, 1, 0, 0],
    );
    expect(Array.from(ctx.getImageData(5, 5, 1, 1).data)).toEqual([
      0, 0, 0, 255,
    ]);
    expect(Array.from(ctx.getImageData(15, 15, 1, 1).data)).toEqual([
      255, 255, 255, 255,
    ]);
  });
});

import { quantize13, encodeSpatialPaths } from "./encoding";
it("bounds 13 bit coordinate error and stores cross-tile paths in the root tile", () => {
  const value = 37.3,
    q = quantize13(value, 0, 100);
  expect(Math.abs((q / 8191) * 100 - value)).toBeLessThanOrEqual(100 / 16382);
  const r = encodeSpatialPaths(
    {
      fnArray: [1, 1],
      argsArray: [
        [2, [[0, 0, 0, 1, 100, 100]]],
        [2, [[0, 0, 0, 1, 100, 100]]],
      ],
    },
    { 1: "constructPath" },
    100,
    100,
  );
  expect(r.pathCount).toBe(2);
  expect(r.uniqueMeshes).toBe(1);
  expect(r.geometryBrotliBytes).toBeGreaterThan(0);
});

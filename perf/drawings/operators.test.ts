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

import { collectImageResources } from "./image-resources";
import { writeFileSync, mkdirSync } from "node:fs";
describe("bounded decoded image replay", () => {
  const names = {
    1: "paintImageXObject",
    2: "transform",
    3: "save",
    4: "restore",
    5: "paintInlineImageXObject",
    6: "paintImageMaskXObject",
    7: "paintImageXObjectRepeat",
    8: "setGState",
    9: "paintInlineImageXObjectGroup",
  };
  const image = {
    width: 2,
    height: 2,
    kind: 2,
    data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]),
  };
  it("deduplicates repeated IDs, owns pixels and preserves PDF orientation/affine placement", () => {
    const list = {
      fnArray: [3, 2, 1, 4, 3, 2, 1, 4],
      argsArray: [
        [],
        [20, 0, 0, 20, 0, 0],
        ["a"],
        [],
        [],
        [20, 0, 0, 20, 24, 0],
        ["a"],
        [],
      ],
    };
    const images = collectImageResources(list, names, () => image);
    expect(images.stats).toMatchObject({
      placements: 2,
      uniqueResources: 1,
      ownedRgbaBytes: 16,
      imageReplayEligible: true,
      completeEncoding: false,
    });
    const canvas = createCanvas(44, 20),
      ctx = canvas.getContext("2d");
    replayPaths(ctx, list, names, [1, 0, 0, -1, 0, 20], { images });
    const pixel = (x: number, y: number) =>
      Array.from(ctx.getImageData(x, y, 1, 1).data);
    expect(pixel(3, 3)).toEqual([255, 0, 0, 255]);
    expect(pixel(13, 3)).toEqual([0, 255, 0, 255]);
    expect(pixel(3, 13)).toEqual([0, 0, 255, 255]);
    expect(pixel(27, 13)).toEqual([0, 0, 255, 255]);
    mkdirSync("/tmp/foremanhq-drawing-image-fixture", { recursive: true });
    writeFileSync(
      "/tmp/foremanhq-drawing-image-fixture/orientation.png",
      canvas.toBuffer("image/png"),
    );
  });
  it("supports inline RGBA and preserves alpha", () => {
    const inline = {
      width: 1,
      height: 1,
      kind: 3,
      data: new Uint8ClampedArray([40, 80, 120, 128]),
    };
    const list = { fnArray: [2, 5], argsArray: [[8, 0, 0, 8, 0, 0], [inline]] };
    const images = collectImageResources(list, names, () => {
      throw Error("unused");
    });
    const canvas = createCanvas(8, 8);
    replayPaths(canvas.getContext("2d"), list, names, [1, 0, 0, -1, 0, 8], {
      images,
    });
    expect(
      Array.from(canvas.getContext("2d").getImageData(4, 4, 1, 1).data),
    ).toEqual([40, 80, 120, 128]);
  });
  it.each([
    [{ ...image, data: new Uint8Array(1) }, "invalid-pixel-data"],
    [{ ...image, width: 0 }, "invalid-image-bounds"],
    [{ ...image, width: 5000, height: 5000 }, "invalid-image-bounds"],
    [{ ...image, kind: 1 }, "unsupported-pixel-kind"],
    [{ ...image, bitmap: {} }, "unsupported-pixel-kind"],
  ])(
    "fails eligibility on invalid or unsupported resources",
    (invalid, reason) => {
      const images = collectImageResources(
        { fnArray: [1], argsArray: [["a"]] },
        names,
        () => invalid,
      );
      expect(images.stats.imageReplayEligible).toBe(false);
      expect(images.stats.failures).toContain(reason);
      expect(images.stats.uniqueResources).toBe(0);
    },
  );
  it("fails missing resources and explicitly rejects masks, repeat, groups and blends", () => {
    const missing = collectImageResources(
      { fnArray: [1], argsArray: [["absent"]] },
      names,
      () => {
        throw Error("missing");
      },
    );
    expect(missing.stats.failures).toEqual(["missing-resource"]);
    const blocked = collectImageResources(
      {
        fnArray: [1, 6, 7, 9, 8],
        argsArray: [["a"], [], [], [], [[["BM", "multiply"]]]],
      },
      names,
      () => image,
    );
    expect(blocked.stats.imageReplayEligible).toBe(false);
    expect(blocked.stats.uniqueResources).toBe(0);
    expect(blocked.stats.failures).toEqual([
      "unsupported:graphics-BM",
      "unsupported:paintImageMaskXObject",
      "unsupported:paintImageXObjectRepeat",
      "unsupported:paintInlineImageXObjectGroup",
    ]);
  });
});
it("rotates image placement using the existing graphics-state affine transform", () => {
  const list = { fnArray: [1, 2], argsArray: [[0, 20, -20, 0, 20, 0], ["a"]] };
  const names = { 1: "transform", 2: "paintImageXObject" };
  const image = {
    width: 2,
    height: 2,
    kind: 2,
    data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]),
  };
  const images = collectImageResources(list, names, () => image),
    canvas = createCanvas(20, 20),
    ctx = canvas.getContext("2d");
  replayPaths(ctx, list, names, [1, 0, 0, -1, 0, 20], { images });
  expect(Array.from(ctx.getImageData(5, 15, 1, 1).data)).toEqual([
    255, 0, 0, 255,
  ]);
  expect(Array.from(ctx.getImageData(5, 5, 1, 1).data)).toEqual([
    0, 255, 0, 255,
  ]);
});

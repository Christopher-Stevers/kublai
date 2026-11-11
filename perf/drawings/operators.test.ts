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

describe("combined replay preparation (synthetic operators only)", () => {
  const names = {
    1: "paintFormXObjectBegin",
    2: "paintFormXObjectEnd",
    3: "constructPath",
    4: "fill",
    5: "save",
    6: "restore",
  };
  it("clips nested transformed forms and restores the parent transform and clip", () => {
    const canvas = createCanvas(30, 30),
      ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 30, 30);
    const rect = [4, [[0, 0, 0, 1, 20, 0, 1, 20, 20, 1, 0, 20, 4]]];
    const result = replayPaths(
      ctx,
      {
        fnArray: [1, 1, 3, 2, 2, 3],
        argsArray: [
          [
            [1, 0, 0, 1, 5, 5],
            [0, 0, 8, 8],
          ],
          [
            [1, 0, 0, 1, 2, 2],
            [0, 0, 4, 4],
          ],
          rect,
          [],
          [],
          [4, [[0, 20, 20, 1, 25, 20, 1, 25, 25, 1, 20, 25, 4]]],
        ],
      },
      names,
      [1, 0, 0, 1, 0, 0],
      { forms: true },
    );
    expect(result).toMatchObject({ failures: [], formsPainted: 2 });
    const pixel = (x: number, y: number) =>
      Array.from(ctx.getImageData(x, y, 1, 1).data);
    expect(pixel(8, 8)).toEqual([0, 0, 0, 255]);
    expect(pixel(12, 12)).toEqual([255, 255, 255, 255]);
    expect(pixel(22, 22)).toEqual([0, 0, 0, 255]);
  });
  it("does not let ordinary restore cross a form boundary or pop the caller root", () => {
    const ctx = createCanvas(20, 20).getContext("2d");
    ctx.translate(3, 4);
    const before = ctx.getTransform();
    const result = replayPaths(
      ctx,
      {
        fnArray: [6, 1, 6, 2, 2, 5],
        argsArray: [[], [null, null], [], [], [], []],
      },
      names,
      [1, 0, 0, 1, 0, 0],
      { forms: true },
    );
    expect(result.failures).toEqual(
      expect.arrayContaining([
        "unbalanced-save",
        "unbalanced-form",
        "unbalanced-save-or-form",
      ]),
    );
    expect(ctx.getTransform()).toEqual(before);
  });
  it("restores caller canvas even when nested depth is rejected", () => {
    const ctx = createCanvas(20, 20).getContext("2d");
    ctx.translate(3, 4);
    const before = ctx.getTransform();
    expect(() =>
      replayPaths(
        ctx,
        { fnArray: Array(65).fill(1), argsArray: Array(65).fill([null, null]) },
        names,
        [1, 0, 0, 1, 0, 0],
        { forms: true },
      ),
    ).toThrow(/depth/);
    expect(ctx.getTransform()).toEqual(before);
  });
  it("reports missing fonts and unsupported Type3/vertical modes instead of claiming glyph support", () => {
    const ctx = createCanvas(20, 20).getContext("2d");
    const textNames = { 1: "setFont", 2: "showText" };
    for (const [font, expected] of [
      [null, "missing-font-resource"],
      [{ isType3Font: true }, "unsupported-type3-font"],
      [{ vertical: true }, "unsupported-vertical-font"],
    ] as const) {
      const result = replayPaths(
        ctx,
        { fnArray: [1, 2], argsArray: [["f", 12], [[]]] },
        textNames,
        [1, 0, 0, 1, 0, 0],
        { font: () => font },
      );
      expect(result.failures).toContain(expected);
      expect(result.glyphsPainted).toBe(0);
    }
  });
  it("records glyph path failure and non-fill text modes explicitly", () => {
    const ctx = createCanvas(20, 20).getContext("2d");
    const result = replayPaths(
      ctx,
      {
        fnArray: [1, 2, 3],
        argsArray: [["f", 12], [4], [[{ width: 100, fontChar: "x" }]]],
      },
      { 1: "setFont", 2: "setTextRenderingMode", 3: "showText" },
      [1, 0, 0, 1, 0, 0],
      {
        font: () => ({
          getPathGenerator() {
            throw Error("missing");
          },
        }),
      },
    );
    expect(result.failures).toEqual(
      expect.arrayContaining([
        "unsupported-text-rendering-mode",
        "missing-glyph-path",
      ]),
    );
    expect(result.glyphsPainted).toBe(0);
  });
});
it("keeps glyph spacing, multiline position and text state across nested forms", () => {
  const translations: number[][] = [];
  const ctx: any = new Proxy(
    {},
    {
      get: (_target, key) =>
        key === "translate"
          ? (...args: number[]) => translations.push(args)
          : () => undefined,
      set: () => true,
    },
  );
  const font = {
    fontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    getPathGenerator: () => ({}),
  };
  const glyph = { fontChar: "x", width: 1000 };
  const result = replayPaths(
    ctx,
    {
      fnArray: [1, 2, 3, 4, 5, 6, 7, 8, 4, 9, 4, 10, 11, 4],
      argsArray: [
        ["f", 2],
        [1],
        [50],
        [[glyph]],
        [null, null],
        [30, 40],
        [[1, 0, 0, 1, 0, 0]],
        [],
        [[glyph]],
        [],
        [[glyph]],
        [4],
        [],
        [[glyph]],
      ],
    },
    {
      1: "setFont",
      2: "setCharSpacing",
      3: "setHScale",
      4: "showText",
      5: "paintFormXObjectBegin",
      6: "moveText",
      7: "setTextMatrix",
      8: "beginText",
      9: "paintFormXObjectEnd",
      10: "setLeading",
      11: "nextLine",
    },
    [1, 0, 0, 1, 0, 0],
    { font: () => font, forms: true },
  );
  expect(result.failures).toEqual([]);
  expect(result.glyphsPainted).toBe(4);
  // The third show is after restoring the form: first glyph advanced 1.5.
  expect(translations[4]).toEqual([1.5, 0]);
  expect(translations[6]).toEqual([0, -4]);
});

describe("deferred packed-path clipping", () => {
  const names = {
    1: "clip",
    2: "eoClip",
    3: "constructPath",
    4: "endPath",
    5: "fill",
    6: "save",
    7: "restore",
  };
  const rect = (mode: number, x: number, y: number, w: number, h: number) => [
    mode,
    [[0, x, y, 1, x + w, y, 1, x + w, y + h, 1, x, y + h, 4]],
  ];
  it("clips the following endPath geometry instead of the previous or empty path", () => {
    const canvas = createCanvas(20, 20),
      ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 20, 20);
    const result = replayPaths(
      ctx,
      {
        fnArray: [1, 3, 3],
        argsArray: [[], rect(4, 4, 4, 8, 8), rect(5, 0, 0, 20, 20)],
      },
      names,
      [1, 0, 0, 1, 0, 0],
    );
    expect(result.failures).toEqual([]);
    expect(Array.from(ctx.getImageData(6, 6, 1, 1).data)).toEqual([
      0, 0, 0, 255,
    ]);
    expect(Array.from(ctx.getImageData(2, 2, 1, 1).data)).toEqual([
      255, 255, 255, 255,
    ]);
  });
  it("uses even-odd clipping holes and restores the previous canvas clip", () => {
    const canvas = createCanvas(20, 20),
      ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 20, 20);
    const outer = rect(4, 2, 2, 14, 14) as [number, number[][]];
    const hole = rect(4, 6, 6, 4, 4) as [number, number[][]];
    const clipPath = [4, [outer[1][0]!.concat(hole[1][0]!)]];
    replayPaths(
      ctx,
      {
        fnArray: [6, 2, 3, 3, 7, 3],
        argsArray: [
          [],
          [],
          clipPath,
          rect(5, 0, 0, 20, 20),
          [],
          rect(5, 17, 17, 2, 2),
        ],
      },
      names,
      [1, 0, 0, 1, 0, 0],
    );
    const pixel = (x: number, y: number) =>
      Array.from(ctx.getImageData(x, y, 1, 1).data);
    expect(pixel(4, 4)).toEqual([0, 0, 0, 255]);
    expect(pixel(8, 8)).toEqual([255, 255, 255, 255]);
    expect(pixel(18, 18)).toEqual([0, 0, 0, 255]);
  });
  it("paints before applying the pending clip, and drops an unconsumed clip on restore", () => {
    const calls: string[] = [];
    const ctx: any = new Proxy(
      {},
      {
        get:
          (_target, key) =>
          (..._args: unknown[]) =>
            calls.push(String(key)),
        set: () => true,
      },
    );
    replayPaths(
      ctx,
      {
        fnArray: [1, 3, 6, 2, 7, 3],
        argsArray: [
          [],
          rect(5, 0, 0, 10, 10),
          [],
          [],
          [],
          rect(5, 0, 0, 20, 20),
        ],
      },
      names,
      [1, 0, 0, 1, 0, 0],
    );
    expect(calls.indexOf("fill")).toBeLessThan(calls.indexOf("clip"));
    expect(calls.filter((x) => x === "clip")).toHaveLength(1);
  });
});

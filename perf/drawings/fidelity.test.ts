// Authored during calibration quiet; validation execution is deferred.
import { describe, expect, it } from "vitest";
import {
  compareOpaqueRgba, decideHostPrototypeFidelity, FIDELITY_TILE_SIZE,
  MAX_INK_COVERAGE_DIFFERENCE, MAX_WORST_TILES, MIN_TILE_SSIM,
  type FidelityComparison, type HostFidelityCheck,
} from "./fidelity";

function rgba(width: number, height: number, gray = 255) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = pixels[i + 1] = pixels[i + 2] = gray;
    pixels[i + 3] = 255;
  }
  return pixels;
}
function valid(width: number, height = 2) {
  const pixels = rgba(width, height);
  return compareOpaqueRgba(pixels, pixels, width, height);
}
function checks(): HostFidelityCheck[] {
  return [512, 1024].map(viewportWidth => ({ viewportWidth, comparison: valid(viewportWidth) }));
}
const decide = (values = checks(), supportSucceeded = true, resourcesSucceeded = true) =>
  decideHostPrototypeFidelity({ checks: values, supportSucceeded, resourcesSucceeded });

describe("opaque host fidelity comparison", () => {
  it("preserves the declared tile size and inclusive thresholds", () => {
    expect([FIDELITY_TILE_SIZE, MIN_TILE_SSIM, MAX_INK_COVERAGE_DIFFERENCE]).toEqual([64, 0.98, 0.005]);
  });
  it("compares identical nonuniform RGB including partial edge tiles without mutation", () => {
    const pixels = rgba(65, 3);
    pixels[0] = 20; pixels[1] = 80; pixels[2] = 140;
    const before = pixels.slice();
    expect(compareOpaqueRgba(pixels, pixels, 65, 3)).toMatchObject({
      valid: true, passes: true, tileCount: 2, minTileSsim: 1,
      meanTileSsim: 1, inkCoverageDifference: 0, failedTileCount: 0,
    });
    expect(pixels).toEqual(before);
  });
  it("matches the analytic constant-image SSIM and ink difference", () => {
    const result = compareOpaqueRgba(rgba(64, 64), rgba(64, 64, 0), 64, 64);
    expect(result.valid).toBe(true);
    expect(result.minTileSsim).toBeCloseTo(6.5025 / (255 * 255 + 6.5025), 10);
    expect(result).toMatchObject({ passes: false, inkCoverageDifference: 1,
      failureCounts: { invalidInput: 0, ssimTiles: 1, inkCoverage: 1 } });
  });
  it("uses an unweighted tile mean, including a one-pixel edge tile", () => {
    const prototype = rgba(65, 1);
    prototype[256] = prototype[257] = prototype[258] = 0;
    const result = compareOpaqueRgba(rgba(65, 1), prototype, 65, 1);
    const bad = 6.5025 / (255 * 255 + 6.5025);
    expect(result.meanTileSsim).toBeCloseTo((1 + bad) / 2, 10);
    expect(result.inkCoverageDifference).toBe(1 / 65);
    expect(result.worstTiles[0]).toMatchObject({ index: 1, x: 64, y: 0, width: 1, height: 1 });
  });
  it("keeps the original SSIM threshold without compensating for low ink difference", () => {
    expect(compareOpaqueRgba(rgba(1, 1, 200), rgba(1, 1, 164), 1, 1).passes).toBe(true);
    expect(compareOpaqueRgba(rgba(1, 1, 200), rgba(1, 1, 163), 1, 1)).toMatchObject({
      passes: false, inkCoverageDifference: 0, failedTileCount: 1,
    });
  });
  it("accepts exactly .005 ink difference and rejects values above it", () => {
    for (const width of [199, 200, 201]) {
      const reference = rgba(width, 1, 246);
      reference[0] = reference[1] = reference[2] = 244;
      const result = compareOpaqueRgba(reference, rgba(width, 1, 246), width, 1);
      expect(result.minTileSsim).toBeGreaterThan(0.98);
      expect(result.inkCoverageDifference).toBe(1 / width);
      expect(result.passes).toBe(width >= 200);
    }
  });
  it("bounds worst-tile numeric metadata while preserving total failures", () => {
    const result = compareOpaqueRgba(rgba(640, 1), rgba(640, 1, 0), 640, 1);
    expect(result.failedTileCount).toBe(10);
    expect(result.worstTiles).toHaveLength(MAX_WORST_TILES);
    expect(result.worstTiles.map(tile => tile.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(result.worstTilesTruncated).toBe(true);
    expect(Object.keys(result.worstTiles[0]!).sort()).toEqual(["height", "index", "ssim", "width", "x", "y"]);
  });
  it("rejects malformed dimensions and buffer sizes without passing partial metrics", () => {
    for (const width of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER]) {
      expect(compareOpaqueRgba([], [], width, 1)).toMatchObject({ valid: false,
        passes: false, reason: "invalid-dimensions", minTileSsim: null });
    }
    for (const buffer of [[], [0, 0, 0], [0, 0, 0, 255, 0]]) {
      expect(compareOpaqueRgba(buffer, rgba(1, 1), 1, 1).reason).toBe("invalid-buffer-length");
    }
  });
  it("rejects nonfinite, fractional and out-of-range channels", () => {
    for (const channel of [NaN, Infinity, -Infinity]) {
      expect(compareOpaqueRgba([channel, 0, 0, 255], rgba(1, 1), 1, 1).reason).toBe("nonfinite-channel");
    }
    for (const channel of [-1, 256, 0.5]) {
      expect(compareOpaqueRgba([channel, 0, 0, 255], rgba(1, 1), 1, 1).reason).toBe("invalid-rgba8-channel");
    }
    expect(compareOpaqueRgba(new Array<number>(4), rgba(1, 1), 1, 1).reason).toBe("nonfinite-channel");
  });
  it("rejects transparency in either image instead of ignoring alpha", () => {
    for (const alpha of [0, 254]) {
      const transparent = [255, 255, 255, alpha];
      expect(compareOpaqueRgba(transparent, rgba(1, 1), 1, 1).reason).toBe("nonopaque-input");
      expect(compareOpaqueRgba(rgba(1, 1), transparent, 1, 1).reason).toBe("nonopaque-input");
    }
  });
  it("does not leak unreadable input exception content", () => {
    const unreadable = { length: 4, get 0(): number { throw new Error("private content"); } };
    const result = compareOpaqueRgba(unreadable, rgba(1, 1), 1, 1);
    expect(result.reason).toBe("unreadable-buffer");
    expect(JSON.stringify(result)).not.toContain("private content");
  });
});

describe("host-only two-width decision", () => {
  it("requires both widths and explicit support and resource success", () => {
    expect(decide()).toMatchObject({ hostPrototypePass: true, productionEligible: false,
      completeEncoding: false, scope: "host-prototype-only", reasons: [] });
    expect(decide(checks(), false).hostPrototypePass).toBe(false);
    expect(decide(checks(), true, false).hostPrototypePass).toBe(false);
    expect(decide(checks(), undefined as unknown as boolean).hostPrototypePass).toBe(false);
    for (const values of [[], checks().slice(0, 1), [checks()[0]!, checks()[0]!], [...checks(), checks()[0]!]]) {
      expect(decide(values).reasons).toContain("missing-or-duplicate-zoom-checks");
    }
  });
  it("rejects mislabeled actual width and invalid comparisons", () => {
    const values = checks();
    values[0] = { viewportWidth: 512, comparison: valid(513) };
    expect(decide(values).reasons).toContain("invalid-fidelity-check");
    values[0] = { viewportWidth: 512, comparison: compareOpaqueRgba([], [], 512, 1) };
    expect(decide(values).hostPrototypePass).toBe(false);
  });
  it("rechecks numeric thresholds even when a comparison claims it passes", () => {
    const initial = valid(512);
    if (!initial.valid) throw new Error("synthetic fixture invalid");
    const make = (patch: Partial<typeof initial>) => decide([
      { viewportWidth: 512, comparison: { ...initial, ...patch } as FidelityComparison }, checks()[1]!,
    ]);
    // Policy boundary fixtures, not captured measurements.
    expect(make({ minTileSsim: 0.98, inkCoverageDifference: 0.005 }).hostPrototypePass).toBe(true);
    for (const patch of [{ minTileSsim: 0.979999 }, { inkCoverageDifference: 0.005001 },
      { minTileSsim: NaN }, { failedTileCount: 1 }]) {
      expect(make(patch).hostPrototypePass).toBe(false);
      expect(make(patch).productionEligible).toBe(false);
    }
  });
});

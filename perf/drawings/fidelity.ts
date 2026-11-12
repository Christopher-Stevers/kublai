/** Host prototype comparison only. No PDF/canvas/I/O, production eligibility,
 * transport-size or complete-encoding claim. Final inputs must be opaque RGBA8.
 * Transparent inputs are rejected, never silently composited or RGB-compared.
 */
export const FIDELITY_ALGORITHM = "opaque-rgba8-luminance-ssim64-v1" as const;
export const FIDELITY_TILE_SIZE = 64;
export const MIN_TILE_SSIM = 0.98;
export const MAX_INK_COVERAGE_DIFFERENCE = 0.005;
export const MAX_WORST_TILES = 8;

export type FidelityInputFailure =
  | "invalid-dimensions"
  | "invalid-buffer-length"
  | "nonfinite-channel"
  | "invalid-rgba8-channel"
  | "nonopaque-input"
  | "unreadable-buffer"
  | "nonfinite-metric";
export type FidelityTile = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  ssim: number;
};
type FailureCounts = { invalidInput: number; ssimTiles: number; inkCoverage: number };
export type FidelityComparison =
  | {
      algorithm: typeof FIDELITY_ALGORITHM;
      valid: true;
      reason: null;
      width: number;
      height: number;
      tileCount: number;
      failedTileCount: number;
      minTileSsim: number;
      meanTileSsim: number;
      inkCoverageDifference: number;
      passes: boolean;
      worstTiles: FidelityTile[];
      worstTilesTruncated: boolean;
      failureCounts: FailureCounts;
    }
  | {
      algorithm: typeof FIDELITY_ALGORITHM;
      valid: false;
      reason: FidelityInputFailure;
      width: null;
      height: null;
      tileCount: null;
      failedTileCount: null;
      minTileSsim: null;
      meanTileSsim: null;
      inkCoverageDifference: null;
      passes: false;
      worstTiles: [];
      worstTilesTruncated: false;
      failureCounts: FailureCounts;
    };
function invalid(reason: FidelityInputFailure): FidelityComparison {
  return {
    algorithm: FIDELITY_ALGORITHM,
    valid: false,
    reason,
    width: null,
    height: null,
    tileCount: null,
    failedTileCount: null,
    minTileSsim: null,
    meanTileSsim: null,
    inkCoverageDifference: null,
    passes: false,
    worstTiles: [],
    worstTilesTruncated: false,
    failureCounts: { invalidInput: 1, ssimTiles: 0, inkCoverage: 0 },
  };
}

/** Preserves run.ts's 64px tiles, coefficients, population variance/covariance,
 * constants, unweighted tile mean, strict ink cutoff and inclusive thresholds.
 * Validation and bounded defect metadata are additional; pixels are never emitted.
 */
export function compareOpaqueRgba(
  reference: ArrayLike<number>,
  prototype: ArrayLike<number>,
  width: number,
  height: number,
): FidelityComparison {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width <= 0 || height <= 0 || !Number.isSafeInteger(width * height * 4)) {
    return invalid("invalid-dimensions");
  }
  const expected = width * height * 4;
  try {
    if (reference == null || prototype == null ||
        reference.length !== expected || prototype.length !== expected) {
      return invalid("invalid-buffer-length");
    }
    // Check all channels before computing any apparently passing partial result.
    for (let i = 0; i < expected; i++) {
      const a = reference[i], b = prototype[i];
      if (!Number.isFinite(a) || !Number.isFinite(b)) return invalid("nonfinite-channel");
      if (!Number.isInteger(a) || !Number.isInteger(b) ||
          a! < 0 || a! > 255 || b! < 0 || b! > 255) return invalid("invalid-rgba8-channel");
      if (i % 4 === 3 && (a !== 255 || b !== 255)) return invalid("nonopaque-input");
    }
    let inkA = 0, inkB = 0, min = 1, total = 0, tiles = 0, failed = 0;
    const worstTiles: FidelityTile[] = [];
    const lum = (pixels: ArrayLike<number>, i: number) =>
      0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!;
    for (let y = 0; y < height; y += 64)
      for (let x = 0; x < width; x += 64) {
        let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
        for (let yy = y; yy < Math.min(height, y + 64); yy++)
          for (let xx = x; xx < Math.min(width, x + 64); xx++) {
            const i = (yy * width + xx) * 4, u = lum(reference, i), v = lum(prototype, i);
            n++;
            sa += u;
            sb += v;
            saa += u * u;
            sbb += v * v;
            sab += u * v;
            if (u < 245) inkA++;
            if (v < 245) inkB++;
          }
        const ma = sa / n, mb = sb / n,
          va = saa / n - ma * ma, vb = sbb / n - mb * mb, cov = sab / n - ma * mb;
        const ssim = ((2 * ma * mb + 6.5025) * (2 * cov + 58.5225)) /
          ((ma * ma + mb * mb + 6.5025) * (va + vb + 58.5225));
        if (!Number.isFinite(ssim)) return invalid("nonfinite-metric");
        min = Math.min(min, ssim);
        total += ssim;
        if (ssim < MIN_TILE_SSIM) failed++;
        worstTiles.push({ index: tiles, x, y, width: Math.min(64, width - x), height: Math.min(64, height - y), ssim });
        worstTiles.sort((a, b) => a.ssim - b.ssim || a.index - b.index);
        if (worstTiles.length > MAX_WORST_TILES) worstTiles.pop();
        tiles++;
      }
    const inkCoverageDifference = Math.abs(inkA - inkB) / (width * height);
    const meanTileSsim = total / tiles;
    if (![min, meanTileSsim, inkCoverageDifference].every(Number.isFinite)) return invalid("nonfinite-metric");
    const inkFails = inkCoverageDifference > MAX_INK_COVERAGE_DIFFERENCE;
    return {
      algorithm: FIDELITY_ALGORITHM,
      valid: true,
      reason: null,
      width,
      height,
      tileCount: tiles,
      failedTileCount: failed,
      minTileSsim: min,
      meanTileSsim,
      inkCoverageDifference,
      passes: min >= MIN_TILE_SSIM && !inkFails,
      worstTiles,
      worstTilesTruncated: tiles > MAX_WORST_TILES,
      failureCounts: { invalidInput: 0, ssimTiles: failed, inkCoverage: inkFails ? 1 : 0 },
    };
  } catch {
    return invalid("unreadable-buffer");
  }
}

export type HostFidelityCheck = { viewportWidth: number; comparison: FidelityComparison };
export type HostFidelityReason =
  | "support-not-confirmed"
  | "resources-not-confirmed"
  | "missing-or-duplicate-zoom-checks"
  | "invalid-fidelity-check"
  | "fidelity-threshold-failed";
export type HostFidelityDecision = {
  scope: "host-prototype-only";
  hostPrototypePass: boolean;
  productionEligible: false;
  completeEncoding: false;
  requiredWidths: readonly [512, 1024];
  reasons: HostFidelityReason[];
};

/** The caller supplies same-sheet provenance and complete support/resource checks.
 * Passing this decision is only a host prototype comparison, never spike go/rollout.
 */
export function decideHostPrototypeFidelity({ checks, supportSucceeded, resourcesSucceeded }: {
  checks: readonly HostFidelityCheck[];
  supportSucceeded: boolean;
  resourcesSucceeded: boolean;
}): HostFidelityDecision {
  const reasons = new Set<HostFidelityReason>();
  if (supportSucceeded !== true) reasons.add("support-not-confirmed");
  if (resourcesSucceeded !== true) reasons.add("resources-not-confirmed");
  if (!Array.isArray(checks) || checks.length !== 2 ||
      !checks.some(c => c?.viewportWidth === 512) || !checks.some(c => c?.viewportWidth === 1024)) {
    reasons.add("missing-or-duplicate-zoom-checks");
  } else {
    for (const check of checks) {
      const r = check?.comparison;
      if (!r || r.algorithm !== FIDELITY_ALGORITHM || r.valid !== true ||
          r.width !== check.viewportWidth || !Number.isSafeInteger(r.height) || r.height <= 0 ||
          !Number.isSafeInteger(r.tileCount) || r.tileCount !== Math.ceil(r.width / 64) * Math.ceil(r.height / 64) ||
          ![r.minTileSsim, r.meanTileSsim, r.inkCoverageDifference].every(Number.isFinite) ||
          r.inkCoverageDifference < 0 || r.inkCoverageDifference > 1 ||
          !Number.isSafeInteger(r.failedTileCount) || r.failedTileCount < 0 || r.failedTileCount > r.tileCount) {
        reasons.add("invalid-fidelity-check");
      } else if (r.passes !== true || r.minTileSsim < MIN_TILE_SSIM ||
                 r.inkCoverageDifference > MAX_INK_COVERAGE_DIFFERENCE || r.failedTileCount !== 0) {
        reasons.add("fidelity-threshold-failed");
      }
    }
  }
  return {
    scope: "host-prototype-only",
    hostPrototypePass: reasons.size === 0,
    productionEligible: false,
    completeEncoding: false,
    requiredWidths: [512, 1024],
    reasons: [...reasons],
  };
}

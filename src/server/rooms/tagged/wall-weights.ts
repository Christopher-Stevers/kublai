import {
  createMask,
  freeComponents,
  inkMask,
  sealAxisGaps,
  union,
  type Mask,
} from "../raster-rooms";
import { closeOpenSteps, rasterMorphology } from "../raster-native";

/**
 * Open space (courtyards, site, parking) inside the footprint. With every
 * opening up to storefront width closed, a region far larger than the
 * typical labelled room is outdoors, not a room. Relative to the drawing's
 * own rooms, so large halls are kept while courtyards are not.
 */
export async function openSpaceMask(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  seeds: Array<{ x: number; y: number }>,
  factor = 12,
) {
  const long = Math.max(width, height);
  const ink = inkMask(rgba, width, height, 200);
  const walls = await rasterMorphology(
    ink,
    closeOpenSteps(Math.max(2, Math.round(long / 1700)), 1),
  );
  const door = 0.0095 * long;
  const wideGap = Math.round(door * 2.2);
  const minRun = Math.max(4, Math.round(door * 0.4));
  const sealed = union(
    sealAxisGaps(walls, wideGap, minRun, true),
    sealAxisGaps(walls, wideGap, minRun, false),
  );
  const comps = freeComponents(sealed);
  const seeded = new Set<number>();
  for (const s of seeds) {
    const x = Math.min(width - 1, Math.max(0, Math.floor(s.x * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(s.y * height)));
    const l = comps.labels[y * width + x]!;
    if (l) seeded.add(l);
  }
  const areas = [...seeded].map((l) => comps.sizes[l]!).sort((a, b) => a - b);
  const median = areas.length
    ? areas[Math.floor(areas.length / 2)]!
    : width * height;
  const limit = Math.max(median * factor, width * height * 0.01);
  const out = createMask(width, height);
  let regions = 0;
  const big = new Set<number>();
  for (let l = 1; l < comps.sizes.length; l++)
    if (comps.sizes[l]! > limit) {
      big.add(l);
      regions++;
    }
  for (let i = 0; i < out.data.length; i++)
    if (big.has(comps.labels[i]!)) out.data[i] = 1;
  return { mask: out, regions, medianRoomPx: median, limitPx: limit };
}

/** Paints the given mask as wall ink. */
export function paintMask(rgba: Uint8ClampedArray, mask: Mask) {
  for (let i = 0; i < mask.data.length; i++) {
    if (!mask.data[i]) continue;
    const p = i * 4;
    rgba[p] = rgba[p + 1] = rgba[p + 2] = 0;
  }
}

/**
 * Walls as drawn on construction plans: double lines (with or without poché)
 * or solid bands. Single thin strokes (door swings, fixtures, furniture,
 * leaders, hatching) are dropped. Repaints the page with walls only.
 */
export async function keepDoubleLineWalls(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const long = Math.max(width, height);
  const ink = inkMask(rgba, width, height, 128);
  const pairGap = Math.max(2, Math.round(long / 1700));
  const thin = Math.max(1, Math.round(long / 2500));
  const walls = await rasterMorphology(ink, closeOpenSteps(pairGap, thin));
  for (let i = 0; i < walls.data.length; i++) {
    const p = i * 4;
    const v = walls.data[i] ? 0 : 255;
    rgba[p] = rgba[p + 1] = rgba[p + 2] = v;
  }
}

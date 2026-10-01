import { close, createMask, freeComponents, inkMask, open, sealAxisGaps, union, type Mask } from "../raster-rooms";

/**
 * Open space (courtyards, site, parking) inside the footprint. With every
 * opening up to storefront width closed, a region far larger than the
 * typical labelled room is outdoors, not a room. Relative to the drawing's
 * own rooms, so large halls are kept while courtyards are not.
 */
export function openSpaceMask(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  seeds: Array<{ x: number; y: number }>,
  factor = 12,
) {
  const long = Math.max(width, height);
  const ink = inkMask(rgba, width, height, 200);
  const walls = open(close(ink, Math.max(2, Math.round(long / 1700))), 1);
  const door = 0.0095 * long;
  const wideGap = Math.round(door * 2.2);
  const minRun = Math.max(4, Math.round(door * 0.4));
  const sealed = union(sealAxisGaps(walls, wideGap, minRun, true), sealAxisGaps(walls, wideGap, minRun, false));
  const comps = freeComponents(sealed);
  const seeded = new Set<number>();
  for (const s of seeds) {
    const x = Math.min(width - 1, Math.max(0, Math.floor(s.x * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(s.y * height)));
    const l = comps.labels[y * width + x]!;
    if (l) seeded.add(l);
  }
  const areas = [...seeded].map((l) => comps.sizes[l]!).sort((a, b) => a - b);
  const median = areas.length ? areas[Math.floor(areas.length / 2)]! : width * height;
  const limit = Math.max(median * factor, width * height * 0.01);
  const out = createMask(width, height);
  let regions = 0;
  const big = new Set<number>();
  for (let l = 1; l < comps.sizes.length; l++) if (comps.sizes[l]! > limit) { big.add(l); regions++; }
  for (let i = 0; i < out.data.length; i++) if (big.has(comps.labels[i]!)) out.data[i] = 1;
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
 * Thickness histogram of wall-like strokes: runs of ink across a line that
 * continue for at least `along`× their thickness along it. Index = thickness px,
 * value = pixel count. Used to find this drawing's own wall weights.
 */
export function strokeThicknessHistogram(rgba: Uint8ClampedArray, width: number, height: number, max = 40, along = 6) {
  const ink = inkMask(rgba, width, height, 128);
  const hist = new Float64Array(max + 1);
  const d = ink.data;
  const scan = (horizontal: boolean) => {
    const lines = horizontal ? height : width, len = horizontal ? width : height;
    const at = (line: number, i: number) => (horizontal ? line * width + i : i * width + line);
    for (let line = 2; line < lines - 2; line += 2) {
      let start = -1;
      for (let i = 0; i <= len; i++) {
        const on = i < len && d[at(line, i)] === 1;
        if (on && start < 0) start = i;
        if (!on && start >= 0) {
          const t = i - start;
          if (t <= max) {
            const mid = start + (t >> 1);
            // continuity across: count ink along the perpendicular through the run centre
            let run = 1;
            for (let k = 1; k < t * along && line + k < lines && d[at(line + k, mid)]; k++) run++;
            for (let k = 1; k < t * along && line - k >= 0 && d[at(line - k, mid)]; k++) run++;
            if (run >= t * along) hist[t]! += t;
          }
          start = -1;
        }
      }
    }
  };
  scan(true);
  scan(false);
  return hist;
}

/**
 * This drawing's heavy-wall weight: the thickest stroke thickness that still
 * carries a substantial share of wall-like ink (rated demising/corridor walls).
 * Returns the minimum thickness to keep for unit-level rooms (≈70% of it).
 */
export function heavyWallThreshold(hist: Float64Array, minShare = 0.06) {
  const total = hist.reduce((a, b) => a + b, 0) || 1;
  let heavy = 0;
  for (let t = 3; t < hist.length - 1; t++) {
    const share = (hist[t - 1]! + hist[t]! + hist[t + 1]!) / total;
    if (share >= minShare) heavy = t;
  }
  return heavy ? Math.max(3, Math.floor(heavy * 0.7)) : 0;
}

/** Keeps ink bands at least `px` thick (unit-boundary walls), repaints in place. */
export function keepWallsThickerThan(rgba: Uint8ClampedArray, width: number, height: number, px: number) {
  const r = Math.max(1, Math.floor((px - 1) / 2));
  const ink = inkMask(rgba, width, height, 200);
  const thick = open(ink, r);
  for (let i = 0; i < ink.data.length; i++) {
    const p = i * 4;
    const v = thick.data[i] ? 0 : 255;
    rgba[p] = rgba[p + 1] = rgba[p + 2] = v;
  }
  return r;
}

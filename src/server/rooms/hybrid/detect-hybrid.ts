/**
 * Density-guided hybrid room detector (Astra's frozen "hybrid-density-geodesic"
 * candidate from codex/room-detection-bench), packaged for the app. Same
 * steps and settings as scripts/rooms/bench/detect.ts, minus file I/O:
 * long ink bands become walls, openings are sealed, each label claims its
 * wall-bounded component and grows through doorways, and components holding
 * several labels are split by a density-weighted geodesic partition.
 */
import {
  axisWallBands,
  circulationComponents,
  componentCentroids,
  doorwayContacts,
  freeComponents,
  growByDistance,
  inkMask,
  sealAxisGaps,
  union,
} from "../raster-rooms";
import { densityBarrier, type DensitySource } from "./density";
import { summarizePartitions } from "./partition-diagnostics";
import { partitionRegion } from "./seeded-partition";

export type HybridConfig = {
  threshold: number;
  openRadius: number;
  join: number;
  bandLengthFraction: number;
  doorFraction: number;
  gapFactor: number;
  windowFactor: number;
  envelope: boolean;
  grow: boolean;
  maxRoomFactor: number;
  maxUnlabelledFraction: number;
  nudgeFraction: number;
  partition: "none" | "geodesic" | "watershed";
  densitySource: DensitySource;
  densityRadiusFraction: number;
  densityPenalty: number;
  /**
   * App guard (not in the benchmark config): a label whose wall-bounded space
   * is larger than this multiple of the median labelled space is treated as
   * outside. Real sheets have a title-block frame, so open ground around the
   * building is not reached from the page edge and would otherwise be split
   * among whichever labels leak into it.
   */
  maxSeedComponentFactor: number;
  /** App guard: envelope spaces larger than this share of the page are outdoors. */
  outdoorFraction: number;
};

/** scripts/rooms/bench/configs/hybrid.json as selected before the holdout. */
export const HYBRID_CONFIG: HybridConfig = {
  threshold: 245,
  openRadius: 1,
  join: 3,
  bandLengthFraction: 0.008,
  doorFraction: 0.0095,
  gapFactor: 1.15,
  windowFactor: 3.5,
  envelope: true,
  grow: true,
  maxRoomFactor: 4,
  maxUnlabelledFraction: 0.01,
  nudgeFraction: 0.004,
  partition: "geodesic",
  densitySource: "combined",
  densityRadiusFraction: 0.025,
  densityPenalty: 20,
  maxSeedComponentFactor: 8,
  outdoorFraction: 0.08,
};

export type HybridSeed = { x: number; y: number };

export type HybridResult = {
  /** Per pixel: 1-based seed index that owns it, 0 = no room. */
  labels: Int32Array;
  width: number;
  height: number;
  rejectedSeeds: Array<{ seedIndex: number; reason: "on-wall" | "outside" }>;
  /** Seeds that shared a wall-bounded component and were split by partitioning. */
  sharedSeeds: number;
  partitionedComponents: number;
  unassignedAnnexComponents: number;
  review: ReturnType<typeof summarizePartitions>;
};

export function detectHybridRooms(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  seeds: HybridSeed[],
  c: HybridConfig = HYBRID_CONFIG,
): HybridResult {
  const W = width;
  const H = height;
  const ink = inkMask(rgba, W, H, c.threshold);
  const length = Math.max(1, Math.round(W * c.bandLengthFraction));
  const walls = union(
    axisWallBands(ink, true, c.join, c.openRadius, length),
    axisWallBands(ink, false, c.join, c.openRadius, length),
  );
  const door = c.doorFraction * Math.max(W, H);
  const thickness = Math.max(3, Math.round(door / 5));
  const minRun = thickness * 2;
  const working = { width: W, height: H, data: new Uint8Array(walls.data) };
  if (c.envelope) {
    const wideGap = Math.round(door * c.windowFactor);
    const outside = freeComponents(
      union(
        sealAxisGaps(walls, wideGap, minRun, true),
        sealAxisGaps(walls, wideGap, minRun, false),
      ),
    );
    // App guard: sheets have a title-block frame, so open ground may never
    // touch the page edge. Very large spaces count as outdoors as well.
    const outdoorPx = W * H * c.outdoorFraction;
    for (let i = 0; i < W * H; i++) {
      const component = outside.labels[i]!;
      if (component && (outside.touchesBorder[component] || outside.sizes[component]! > outdoorPx)) {
        working.data[i] = 1;
      }
    }
  }
  const gap = Math.round(door * c.gapFactor);
  const sealedH = sealAxisGaps(working, gap, minRun, true);
  const sealedV = sealAxisGaps(working, gap, minRun, false);
  const comps = freeComponents(union(sealedH, sealedV));

  const owner = new Map<number, number>();
  const located: Array<{
    seedIndex: number;
    index: number;
    label: number;
    component: number;
    nudgeDistance: number;
  }> = [];
  const rejectedSeeds: HybridResult["rejectedSeeds"] = [];
  let shared = 0;
  const nudge = (s: HybridSeed) => {
    const cx = Math.round(s.x * (W - 1));
    const cy = Math.round(s.y * (H - 1));
    const reach = Math.round(W * c.nudgeFraction);
    for (let d = 0; d <= reach; d++) {
      for (let dy = -d; dy <= d; dy++) {
        for (const dx of [-d + Math.abs(dy), d - Math.abs(dy)]) {
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && y >= 0 && x < W && y < H && comps.labels[y * W + x]) {
            return y * W + x;
          }
        }
      }
    }
    return -1;
  };
  const seedComponents = seeds.map((s) => {
    const index = nudge(s);
    return { index, id: index < 0 ? 0 : comps.labels[index]! };
  });
  const seededSizes = [...new Set(seedComponents.map((s) => s.id).filter((id) => id && !comps.touchesBorder[id]))]
    .map((id) => comps.sizes[id]!)
    .sort((a, b) => a - b);
  const medianSeeded = seededSizes[Math.floor(seededSizes.length / 2)] ?? 0;
  const tooLarge = (id: number) =>
    medianSeeded > 0 && comps.sizes[id]! > medianSeeded * c.maxSeedComponentFactor;
  for (const [seedIndex, s] of seeds.entries()) {
    const { index, id } = seedComponents[seedIndex]!;
    if (!id) {
      rejectedSeeds.push({ seedIndex, reason: "on-wall" });
      continue;
    }
    if (comps.touchesBorder[id] || tooLarge(id)) {
      rejectedSeeds.push({ seedIndex, reason: "outside" });
      continue;
    }
    const label = seedIndex + 1;
    const nudgeDistance =
      Math.abs((index % W) - Math.round(s.x * (W - 1))) +
      Math.abs(Math.floor(index / W) - Math.round(s.y * (H - 1)));
    located.push({ seedIndex, index, label, component: id, nudgeDistance });
    if (owner.has(id)) {
      shared++;
      continue;
    }
    owner.set(id, label);
  }

  let grown = new Int32Array(comps.sizes.length);
  if (c.grow) {
    const contacts = new Map<string, number>();
    for (const [mask, horizontal] of [
      [sealedH, true],
      [sealedV, false],
    ] as const) {
      for (const [key, n] of doorwayContacts(comps.labels, working, mask, horizontal, thickness * 3)) {
        contacts.set(key, (contacts.get(key) ?? 0) + n);
      }
    }
    const coreSizes = [...owner.keys()].map((k) => comps.sizes[k]!).sort((a, b) => a - b);
    const median = coreSizes[Math.floor(coreSizes.length / 2)] ?? 0;
    const circulation = circulationComponents(
      comps.labels,
      W,
      comps.sizes.length - 1,
      owner,
      contacts,
      thickness * 2,
    );
    grown = growByDistance(
      comps.sizes,
      componentCentroids(comps.labels, W, comps.sizes.length - 1),
      owner,
      contacts,
      (id) =>
        !!comps.touchesBorder[id] ||
        tooLarge(id) ||
        comps.sizes[id]! > W * H * c.maxUnlabelledFraction ||
        circulation.has(id),
      thickness * 2,
      median * c.maxRoomFactor,
    );
  } else {
    for (const [component, room] of owner) grown[component] = room;
  }

  const labels = new Int32Array(W * H);
  for (let i = 0; i < labels.length; i++) labels[i] = Math.max(0, grown[comps.labels[i]!] ?? 0);
  let partitionedComponents = 0;
  let unassignedAnnexComponents = 0;
  let cost: Float32Array = new Float32Array(W * H);
  if (c.partition !== "none" && shared) {
    const counts = new Map<number, number>();
    for (const seed of located) counts.set(seed.component, (counts.get(seed.component) ?? 0) + 1);
    const sharedIds = new Set([...counts].filter(([, n]) => n > 1).map(([id]) => id));
    partitionedComponents = sharedIds.size;
    // Annexes grown from a contested core stay unassigned for review rather
    // than going silently to whichever label claimed the core first.
    const contestedOwners = new Set([...sharedIds].map((id) => owner.get(id)!));
    const annexes = new Set<number>();
    for (let id = 1; id < grown.length; id++) {
      if (contestedOwners.has(grown[id]!) && !owner.has(id)) annexes.add(id);
    }
    unassignedAnnexComponents = annexes.size;
    for (let i = 0; i < labels.length; i++) if (annexes.has(comps.labels[i]!)) labels[i] = 0;
    const regions = new Int32Array(W * H);
    for (let i = 0; i < regions.length; i++) {
      if (sharedIds.has(comps.labels[i]!)) regions[i] = comps.labels[i]!;
    }
    cost = densityBarrier(
      rgba,
      walls,
      Math.max(1, Math.round(Math.max(W, H) * c.densityRadiusFraction)),
      c.densitySource,
    );
    const partition = partitionRegion({
      width: W,
      height: H,
      regions,
      cost,
      seeds: located.filter((s) => sharedIds.has(s.component)),
      mode: c.partition,
      penalty: c.densityPenalty,
    });
    for (let i = 0; i < labels.length; i++) if (partition[i]) labels[i] = partition[i]!;
  }
  const review = summarizePartitions({
    width: W,
    height: H,
    labels,
    regions: comps.labels,
    cost,
    seeds: located,
  });
  return {
    labels,
    width: W,
    height: H,
    rejectedSeeds,
    sharedSeeds: shared,
    partitionedComponents,
    unassignedAnnexComponents,
    review,
  };
}

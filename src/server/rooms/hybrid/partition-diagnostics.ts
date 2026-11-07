/**
 * Image-only review diagnostics for inferred partitions. Density values are
 * heuristic evidence, never calibrated confidence or proof of a physical wall.
 */
export const LOW_BOUNDARY_EVIDENCE = 0.03;

export type DiagnosticSeed = {
  seedIndex: number;
  index: number;
  label: number;
  component: number;
  nudgeDistance?: number;
};

export type PartitionDiagnosticOptions = {
  width: number;
  height: number;
  labels: Int32Array;
  /** Original free-space components: zero is a wall or excluded space. */
  regions: Int32Array;
  cost: Float32Array;
  seeds: readonly DiagnosticSeed[];
};

export type PartitionDiagnostics = {
  boundaries: {
    labels: [number, number];
    /** Number of four-neighbour pixel edges, counted once each. */
    length: number;
    meanBarrier: number;
    /** Fraction of edges whose mean endpoint cost is below 0.03. */
    lowEvidenceFraction: number;
    /** Every split within an original component is inferred and needs review. */
    needsReview: true;
  }[];
  rooms: {
    label: number;
    seedIndex: number;
    area: number;
    component: number;
    nudgeDistance: number;
    seedRetained: boolean;
    collidingSeedPixel: boolean;
  }[];
  duplicateSeedPixels: {
    index: number;
    seedIndices: number[];
    labels: number[];
  }[];
};

/**
 * O(pixels + seeds), apart from small deterministic output sorts. Counts final
 * room area including grown attachments. Only contacts between distinct labels
 * inside the same original region are inferred boundaries; contacts across
 * regions, along image edges, or against zero labels are excluded. No mutation,
 * file access, annotations, or ground-truth polygons are involved.
 */
export function summarizePartitions({
  width, height, labels, regions, cost, seeds,
}: PartitionDiagnosticOptions): PartitionDiagnostics {
  const count = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || !Number.isSafeInteger(count) || count > 0x7fffffff
    || labels.length !== count || regions.length !== count || cost.length !== count) {
    throw new Error('Diagnostic dimensions must be positive integers matching all input arrays');
  }
  const areas = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    if (labels[i]! < 0 || regions[i]! < 0) throw new Error('Diagnostic labels and regions must be nonnegative');
    if (!Number.isFinite(cost[i]) || cost[i]! < 0 || cost[i]! > 1) {
      throw new Error('Diagnostic costs must be finite values in [0, 1]');
    }
    const label = labels[i]!;
    if (label > 0) areas.set(label, (areas.get(label) ?? 0) + 1);
  }

  const seedIndices = new Set<number>();
  const seedsByPixel = new Map<number, DiagnosticSeed[]>();
  for (const seed of seeds) {
    if (!Number.isInteger(seed.seedIndex) || seed.seedIndex < 0 || seedIndices.has(seed.seedIndex)) {
      throw new Error('Diagnostic seed indices must be distinct nonnegative integers');
    }
    if (!Number.isInteger(seed.index) || seed.index < 0 || seed.index >= count
      || !Number.isInteger(seed.component) || seed.component < 1
      || regions[seed.index] !== seed.component) {
      throw new Error('Each diagnostic seed must lie inside its stated positive component');
    }
    if (!Number.isInteger(seed.label) || seed.label < 1 || seed.label > 0x7fffffff) {
      throw new Error('Diagnostic seed labels must be positive signed 32-bit integers');
    }
    if (seed.nudgeDistance !== undefined && (!Number.isFinite(seed.nudgeDistance) || seed.nudgeDistance < 0)) {
      throw new Error('Diagnostic nudge distances must be finite and nonnegative');
    }
    seedIndices.add(seed.seedIndex);
    const prior = seedsByPixel.get(seed.index);
    if (prior) prior.push(seed);
    else seedsByPixel.set(seed.index, [seed]);
  }

  const pairs = new Map<string, { labels: [number, number]; length: number; sum: number; low: number }>();
  const edge = (a: number, b: number) => {
    const first = labels[a]!, second = labels[b]!;
    if (first === 0 || second === 0 || first === second
      || regions[a] === 0 || regions[a] !== regions[b]) return;
    const lo = Math.min(first, second), hi = Math.max(first, second);
    const key = `${lo},${hi}`;
    let pair = pairs.get(key);
    if (!pair) {
      pair = { labels: [lo, hi], length: 0, sum: 0, low: 0 };
      pairs.set(key, pair);
    }
    const barrier = (cost[a]! + cost[b]!) / 2;
    pair.length++;
    pair.sum += barrier;
    if (barrier < LOW_BOUNDARY_EVIDENCE) pair.low++;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (x + 1 < width) edge(i, i + 1);
    if (y + 1 < height) edge(i, i + width);
  }

  return {
    boundaries: [...pairs.values()]
      .sort((a, b) => a.labels[0] - b.labels[0] || a.labels[1] - b.labels[1])
      .map(pair => ({ labels: pair.labels, length: pair.length,
        meanBarrier: pair.sum / pair.length, lowEvidenceFraction: pair.low / pair.length,
        needsReview: true })),
    rooms: [...seeds].sort((a, b) => a.seedIndex - b.seedIndex)
      .map(seed => ({ label: seed.label, seedIndex: seed.seedIndex, area: areas.get(seed.label) ?? 0,
        component: seed.component, nudgeDistance: seed.nudgeDistance ?? 0,
        seedRetained: labels[seed.index] === seed.label,
        collidingSeedPixel: seedsByPixel.get(seed.index)!.length > 1 })),
    duplicateSeedPixels: [...seedsByPixel.entries()]
      .filter(([, pixelSeeds]) => pixelSeeds.length > 1).sort(([a], [b]) => a - b)
      .map(([index, pixelSeeds]) => ({ index,
        seedIndices: pixelSeeds.map(seed => seed.seedIndex).sort((a, b) => a - b),
        labels: [...new Set(pixelSeeds.map(seed => seed.label))].sort((a, b) => a - b) })),
  };
}

/**
 * Offline, four-neighbour seeded partitioning. Positive region IDs are hard
 * boundaries; zero and unseeded regions remain unassigned. No image or app I/O.
 */
export type PartitionSeed = { index: number; label: number };

export type PartitionOptions = {
  width: number;
  height: number;
  regions: Int32Array;
  /** Soft barrier strength, in [0, 1]. */
  cost: Float32Array;
  seeds: readonly PartitionSeed[];
  mode: 'geodesic' | 'watershed';
  /** Geodesic edge cost is 1 + penalty * average endpoint cost. */
  penalty?: number;
};

/** An indexed heap holds each queued pixel once, including after improvements. */
class PixelHeap {
  private readonly pixels: Int32Array;
  private size = 0;

  constructor(
    capacity: number,
    private readonly positions: Int32Array,
    private readonly primary: Float64Array,
    private readonly secondary: Float64Array,
    private readonly owners: Int32Array,
  ) {
    this.pixels = new Int32Array(capacity);
  }

  private before(a: number, b: number): boolean {
    return this.primary[a]! < this.primary[b]!
      || (this.primary[a] === this.primary[b] && (
        this.secondary[a]! < this.secondary[b]!
        || (this.secondary[a] === this.secondary[b] && (
          this.owners[a]! < this.owners[b]!
          || (this.owners[a] === this.owners[b] && a < b)
        ))
      ));
  }

  /** The caller has already replaced a pixel's scores with better scores. */
  improve(pixel: number): void {
    let at = this.positions[pixel]!;
    if (at < 0) at = this.size++;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      const other = this.pixels[parent]!;
      if (!this.before(pixel, other)) break;
      this.pixels[at] = other;
      this.positions[other] = at;
      at = parent;
    }
    this.pixels[at] = pixel;
    this.positions[pixel] = at;
  }

  pop(): number {
    if (this.size === 0) return -1;
    const pixel = this.pixels[0]!;
    const last = this.pixels[--this.size]!;
    this.positions[pixel] = -2; // Finalized.
    if (this.size === 0) return pixel;
    let at = 0;
    for (;;) {
      const left = at * 2 + 1;
      if (left >= this.size) break;
      const right = left + 1;
      const child = right < this.size && this.before(this.pixels[right]!, this.pixels[left]!)
        ? right : left;
      const other = this.pixels[child]!;
      if (!this.before(other, last)) break;
      this.pixels[at] = other;
      this.positions[other] = at;
      at = child;
    }
    this.pixels[at] = last;
    this.positions[last] = at;
    return pixel;
  }
}

/**
 * Geodesic mode minimizes accumulated weighted path length. Watershed mode
 * orders flooding by the maximum encountered barrier, then distance travelled
 * on its current flooding plateau (reset on ascent). It is intentionally not
 * described as globally minimizing total path length among all minimax paths:
 * that objective cannot be solved by ordinary single-state Dijkstra.
 *
 * Equal costs/plateau distances go to the smaller label, then pixel index;
 * output is independent of seed input order. Seeds start at zero flooding
 * height, so a dark mark precisely at a label cannot suppress that seed.
 * Conflicting seeds at one pixel retain the smaller label. Regions are assumed
 * connected, as produced by a connected-component labeller. Each singly seeded
 * region is copied directly; the heap only visits regions with competing labels.
 */
export function partitionRegion({
  width, height, regions, cost, seeds, mode, penalty = 32,
}: PartitionOptions): Int32Array {
  const count = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || !Number.isSafeInteger(count) || count > 0x7fffffff
    || regions.length !== count || cost.length !== count) {
    throw new Error('Partition dimensions must be positive integers matching both input arrays');
  }
  if (mode !== 'geodesic' && mode !== 'watershed') throw new Error('Unknown partition mode');
  if (!Number.isFinite(penalty) || penalty < 0 || penalty > Number.MAX_SAFE_INTEGER / count) {
    throw new Error('Partition penalty must be finite, nonnegative, and safely representable');
  }
  for (let i = 0; i < count; i++) {
    if (regions[i]! < 0) throw new Error('Region IDs must be nonnegative');
    if (!Number.isFinite(cost[i]) || cost[i]! < 0 || cost[i]! > 1) {
      throw new Error('Partition costs must be finite values in [0, 1]');
    }
  }

  const seedPixels = new Map<number, number>();
  for (const { index, label } of seeds) {
    if (!Number.isInteger(index) || index < 0 || index >= count || !regions[index]) {
      throw new Error('Each partition seed must be inside a positive region');
    }
    if (!Number.isInteger(label) || label < 1 || label > 0x7fffffff) {
      throw new Error('Partition seed labels must be positive signed 32-bit integers');
    }
    seedPixels.set(index, Math.min(seedPixels.get(index) ?? label, label));
  }

  const regionOwners = new Map<number, number>();
  const competing = new Set<number>();
  for (const [index, label] of seedPixels) {
    const region = regions[index]!;
    const prior = regionOwners.get(region);
    if (prior !== undefined && prior !== label) competing.add(region);
    else regionOwners.set(region, label);
  }
  const owners = new Int32Array(count);
  let activePixels = 0;
  for (let i = 0; i < count; i++) {
    const region = regions[i]!;
    if (competing.has(region)) activePixels++;
    else owners[i] = regionOwners.get(region) ?? 0;
  }
  if (activePixels === 0) return owners;

  const positions = new Int32Array(count).fill(-1);
  const primary = new Float64Array(count).fill(Infinity);
  const secondary = new Float64Array(count).fill(Infinity);
  const heap = new PixelHeap(activePixels, positions, primary, secondary, owners);
  for (const [index, label] of seedPixels) {
    if (!competing.has(regions[index]!)) continue;
    owners[index] = label;
    primary[index] = 0;
    secondary[index] = 0;
    heap.improve(index);
  }

  const visit = (from: number, next: number): void => {
    if (positions[next] === -2 || regions[next] !== regions[from]) return;
    let candidatePrimary: number;
    let candidateSecondary: number;
    if (mode === 'geodesic') {
      candidatePrimary = primary[from]! + 1 + penalty * (cost[from]! + cost[next]!) / 2;
      candidateSecondary = secondary[from]! + 1;
    } else {
      candidatePrimary = Math.max(primary[from]!, cost[next]!);
      candidateSecondary = candidatePrimary > primary[from]! ? 0 : secondary[from]! + 1;
    }
    const better = candidatePrimary < primary[next]!
      || (candidatePrimary === primary[next] && (
        candidateSecondary < secondary[next]!
        || (candidateSecondary === secondary[next] && owners[from]! < owners[next]!)
      ));
    if (!better) return;
    primary[next] = candidatePrimary;
    secondary[next] = candidateSecondary;
    owners[next] = owners[from]!;
    heap.improve(next);
  };

  for (let pixel = heap.pop(); pixel >= 0; pixel = heap.pop()) {
    const x = pixel % width;
    if (x > 0) visit(pixel, pixel - 1);
    if (x + 1 < width) visit(pixel, pixel + 1);
    if (pixel >= width) visit(pixel, pixel - width);
    if (pixel + width < count) visit(pixel, pixel + width);
  }
  return owners;
}

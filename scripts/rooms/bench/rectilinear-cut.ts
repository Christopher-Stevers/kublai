/** Conservative geometric proposal for two labels sharing one free component. */
export type CutSeed = { index: number; label: number; component: number };

export type InferredCut = {
  component: number;
  axis: 'x' | 'y';
  /** Pixel edge: coordinates below position belong to labels[0]. */
  position: number;
  opening: number;
  widest: number;
  ratio: number;
  profileJump: number;
  labels: [number, number];
  areas: [number, number];
  needsReview: true;
  reason: 'wall-endpoint-continuation';
};

type Component = { seeds: CutSeed[]; pixels: number[] };
type Proposal = Omit<InferredCut, 'needsReview' | 'reason'> & { midpointDistance: number };

/**
 * A profile step can locate the end of a partial wall, but cannot establish
 * that a physical room boundary exists. Every returned cut remains inferred.
 *
 * Restricts changes to original components with exactly two distinct seeds.
 * A straight cut must cross one continuous opening, coincide with an abrupt
 * narrowing, leave at least 8% of the component on either side, and leave both
 * sides entirely reachable from their seed. A plain rectangle provides no
 * support. Only the strongest proposal is flood-checked, keeping time linear
 * in image/component size; a failed check preserves the input partition.
 */
export function refineByNarrowCut({
  width, height, regions, labels, seeds, maxCutRatio = 0.7,
}: {
  width: number;
  height: number;
  regions: Int32Array;
  labels: Int32Array;
  seeds: readonly CutSeed[];
  maxCutRatio?: number;
}): { labels: Int32Array; cuts: InferredCut[] } {
  const count = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || !Number.isSafeInteger(count) || count > 0x7fffffff
    || regions.length !== count || labels.length !== count) {
    throw new Error('Cut dimensions must match both input arrays');
  }
  if (!Number.isFinite(maxCutRatio) || maxCutRatio <= 0 || maxCutRatio >= 1) {
    throw new Error('Maximum cut ratio must lie strictly between zero and one');
  }
  const result = new Int32Array(labels);
  const cuts: InferredCut[] = [];
  const components = new Map<number, Component>();
  const invalid = new Set<number>();
  for (const seed of seeds) {
    if (!Number.isInteger(seed.component) || seed.component <= 0
      || !Number.isInteger(seed.index) || seed.index < 0 || seed.index >= count
      || regions[seed.index] !== seed.component
      || !Number.isInteger(seed.label) || seed.label < 1 || seed.label > 0x7fffffff) {
      invalid.add(seed.component);
      continue;
    }
    let component = components.get(seed.component);
    if (!component) { component = { seeds: [], pixels: [] }; components.set(seed.component, component); }
    component.seeds.push(seed);
  }
  for (const [id, component] of components) {
    if (invalid.has(id) || component.seeds.length !== 2
      || component.seeds[0]!.index === component.seeds[1]!.index
      || component.seeds[0]!.label === component.seeds[1]!.label) components.delete(id);
  }
  if (!components.size) return { labels: result, cuts };
  for (let pixel = 0; pixel < count; pixel++) components.get(regions[pixel]!)?.pixels.push(pixel);
  const visited = new Uint8Array(count);

  for (const [id, component] of components) {
    const { pixels } = component;
    const [first, second] = component.seeds as [CutSeed, CutSeed];
    const columns = new Int32Array(width), rows = new Int32Array(height);
    const crossX = new Int32Array(width), crossY = new Int32Array(height);
    const runsX = new Int32Array(width), runsY = new Int32Array(height);
    const lastX = new Int32Array(width).fill(-2), lastY = new Int32Array(height).fill(-2);
    // Pixels were collected in row order, so a crossing's changing transverse
    // coordinate also gives its number of disconnected opening intervals.
    for (const pixel of pixels) {
      const x = pixel % width, y = Math.floor(pixel / width);
      columns[x]!++; rows[y]!++;
      if (x > 0 && regions[pixel - 1] === id) {
        crossX[x]!++;
        if (lastX[x] !== y - 1) runsX[x]!++;
        lastX[x] = y;
      }
      if (y > 0 && regions[pixel - width] === id) {
        crossY[y]!++;
        if (lastY[y] !== x - 1) runsY[y]!++;
        lastY[y] = x;
      }
    }

    const propose = (axis: 'x' | 'y'): Proposal | undefined => {
      const profile = axis === 'x' ? columns : rows;
      const crossing = axis === 'x' ? crossX : crossY;
      const runs = axis === 'x' ? runsX : runsY;
      const coordinate = (seed: CutSeed) => axis === 'x' ? seed.index % width : Math.floor(seed.index / width);
      const a = coordinate(first), b = coordinate(second);
      const low = Math.min(a, b), high = Math.max(a, b);
      if (low === high) return undefined;
      let widest = 0;
      for (let p = low + 1; p <= high; p++) widest = Math.max(widest, crossing[p]!);
      if (!widest) return undefined;
      const minArea = Math.max(4, Math.ceil(pixels.length * 0.08));
      const minJump = Math.max(2, Math.ceil(widest * 0.12));
      let before = 0, best: Proposal | undefined;
      for (let position = 1; position < profile.length; position++) {
        before += profile[position - 1]!;
        if (position <= low || position > high || before < minArea || pixels.length - before < minArea) continue;
        const opening = crossing[position]!;
        if (opening === 0 || runs[position] !== 1 || opening / widest > maxCutRatio) continue;
        const jump = Math.max(crossing[position - 1] ?? 0, crossing[position + 1] ?? 0) - opening;
        if (jump < minJump) continue;
        const candidate: Proposal = {
          component: id, axis, position, opening, widest, ratio: opening / widest,
          profileJump: jump / widest,
          labels: a < b ? [first.label, second.label] : [second.label, first.label],
          areas: [before, pixels.length - before],
          midpointDistance: Math.abs(position - (a + b + 1) / 2) / (high - low),
        };
        if (!best || stronger(candidate, best) < 0) best = candidate;
      }
      return best;
    };

    const x = propose('x'), y = propose('y');
    // Exactly equal perpendicular evidence is ambiguous; avoid deciding by the
    // array iteration order or a preference for one page orientation.
    if (x && y && stronger(x, y) === 0) continue;
    const proposal = x && y ? (stronger(x, y) < 0 ? x : y) : x ?? y;
    if (!proposal) continue;
    const lowSide = (pixel: number) => (proposal.axis === 'x' ? pixel % width : Math.floor(pixel / width)) < proposal.position;
    const queue = new Int32Array(pixels.length);
    const connectedArea = (seed: CutSeed): number => {
      const side = lowSide(seed.index);
      let head = 0, tail = 1;
      queue[0] = seed.index; visited[seed.index] = 1;
      const visit = (pixel: number) => {
        if (regions[pixel] !== id || visited[pixel] || lowSide(pixel) !== side) return;
        visited[pixel] = 1; queue[tail++] = pixel;
      };
      while (head < tail) {
        const pixel = queue[head++]!, px = pixel % width;
        if (px > 0) visit(pixel - 1);
        if (px + 1 < width) visit(pixel + 1);
        if (pixel >= width) visit(pixel - width);
        if (pixel + width < count) visit(pixel + width);
      }
      return tail;
    };
    const lowSeed = lowSide(first.index) ? first : second;
    const highSeed = lowSide(first.index) ? second : first;
    if (connectedArea(lowSeed) !== proposal.areas[0] || connectedArea(highSeed) !== proposal.areas[1]) continue;
    for (const pixel of pixels) result[pixel] = proposal.labels[lowSide(pixel) ? 0 : 1];
    const { midpointDistance: _distance, ...cut } = proposal;
    cuts.push({ ...cut, needsReview: true, reason: 'wall-endpoint-continuation' });
  }
  cuts.sort((a, b) => a.component - b.component);
  return { labels: result, cuts };
}

/** Negative means the first candidate has stronger geometric support. */
function stronger(a: Proposal, b: Proposal): number {
  return a.ratio - b.ratio || b.profileJump - a.profileJump || a.midpointDistance - b.midpointDistance;
}

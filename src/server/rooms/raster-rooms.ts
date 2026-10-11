/**
 * Raster room detection primitives. Works on a grayscale render of the plan:
 * walls are the thick bands of ink that survive a morphological opening
 * (text, fixtures, door swings, dimension and revision-cloud lines are thin
 * and disappear), openings in those bands are sealed along the wall
 * direction, and every label claims the free-space region it sits in.
 *
 * Images are row-major Uint8Array masks (1 = set) of size width × height.
 */

export type Mask = { width: number; height: number; data: Uint8Array };

export function createMask(width: number, height: number): Mask {
  return { width, height, data: new Uint8Array(width * height) };
}

/** Ink = pixels darker than `threshold` (0-255 grayscale, RGBA input). */
export function inkMask(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  threshold: number,
): Mask {
  const mask = createMask(width, height);
  for (let i = 0, p = 0; i < mask.data.length; i += 1, p += 4) {
    const luma = 0.299 * rgba[p]! + 0.587 * rgba[p + 1]! + 0.114 * rgba[p + 2]!;
    mask.data[i] = luma < threshold ? 1 : 0;
  }
  return mask;
}

/**
 * Min (erode) or max (dilate) over a (2r+1)-wide window along one axis,
 * using van Herk/Gil-Werman blocks: O(1) per pixel regardless of r.
 */
function filterAxis(
  src: Mask,
  r: number,
  horizontal: boolean,
  dilate: boolean,
) {
  const { width, height } = src;
  const out = createMask(width, height);
  if (r <= 0) {
    out.data.set(src.data);
    return out;
  }
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;
  const k = 2 * r + 1;
  const g = new Uint8Array(length);
  const h = new Uint8Array(length);
  const pad = dilate ? 0 : 1; // outside the image: empty for dilate, full for erode
  const pick = dilate
    ? (a: number, b: number) => (a > b ? a : b)
    : (a: number, b: number) => (a < b ? a : b);
  for (let line = 0; line < lines; line += 1) {
    const at = (i: number) =>
      horizontal ? line * width + i : i * width + line;
    for (let i = 0; i < length; i += 1) {
      const v = src.data[at(i)]!;
      g[i] = i % k === 0 ? v : pick(g[i - 1]!, v);
    }
    for (let i = length - 1; i >= 0; i -= 1) {
      const v = src.data[at(i)]!;
      h[i] = i % k === k - 1 || i === length - 1 ? v : pick(h[i + 1]!, v);
    }
    for (let i = 0; i < length; i += 1) {
      const lo = i - r;
      const hi = i + r;
      const a = lo >= 0 ? h[lo]! : pad;
      const b = hi < length ? g[hi]! : pad;
      out.data[at(i)] = pick(a, b);
    }
  }
  return out;
}

/** Square-window erosion/dilation of radius r. */
export function erode(mask: Mask, r: number) {
  return filterAxis(filterAxis(mask, r, true, false), r, false, false);
}
export function dilate(mask: Mask, r: number) {
  return filterAxis(filterAxis(mask, r, true, true), r, false, true);
}
/** Joins features closer than 2r+1 pixels (e.g. the two lines of a wall). */
export function close(mask: Mask, r: number) {
  return erode(dilate(mask, r), r);
}
/** Keeps only features at least 2r+1 pixels thick in both directions. */
export function open(mask: Mask, r: number) {
  return dilate(erode(mask, r), r);
}

/**
 * Straight wall bands running along one axis: double lines closer than
 * 2·join+1 px across the band are merged, bands thinner than 2·thin+1 px
 * dropped, and only runs at least 2·length+1 px long along the axis kept.
 * Symbols, fixtures, text and swings are short or thin and disappear.
 */
export function axisWallBands(
  ink: Mask,
  horizontal: boolean,
  join: number,
  thin: number,
  length: number,
) {
  const across = !horizontal;
  let mask = filterAxis(
    filterAxis(ink, join, across, true),
    join,
    across,
    false,
  );
  mask = filterAxis(filterAxis(mask, thin, across, false), thin, across, true);
  return filterAxis(
    filterAxis(mask, length, horizontal, false),
    length,
    horizontal,
    true,
  );
}

/** Pixel-wise OR of two masks. */
export function union(a: Mask, b: Mask): Mask {
  const out = createMask(a.width, a.height);
  for (let i = 0; i < out.data.length; i += 1)
    out.data[i] = a.data[i]! | b.data[i]!;
  return out;
}

/**
 * Seals openings in walls along the axis: a run of free pixels of at most
 * `maxGap` between two wall runs that are each at least `minRun` long along
 * the same line is filled. Only straight continuations are bridged, so open
 * floor between parallel walls is never closed.
 */
export function sealAxisGaps(
  walls: Mask,
  maxGap: number,
  minRun: number,
  horizontal: boolean,
): Mask {
  const { width, height } = walls;
  const out = createMask(width, height);
  out.data.set(walls.data);
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;
  for (let line = 0; line < lines; line += 1) {
    const at = (i: number) =>
      horizontal ? line * width + i : i * width + line;
    let runStart = -1;
    let lastRunEnd = -1; // exclusive end of the previous qualifying wall run
    for (let i = 0; i <= length; i += 1) {
      const set = i < length && walls.data[at(i)] === 1;
      if (set && runStart < 0) runStart = i;
      if (!set && runStart >= 0) {
        const runLength = i - runStart;
        if (runLength >= minRun) {
          const gap = runStart - lastRunEnd;
          if (lastRunEnd >= 0 && gap > 0 && gap <= maxGap) {
            for (let j = lastRunEnd; j < runStart; j += 1) out.data[at(j)] = 1;
          }
          lastRunEnd = i;
        } else if (lastRunEnd >= 0 && runStart - lastRunEnd > maxGap) {
          lastRunEnd = -1;
        }
        runStart = -1;
      }
    }
  }
  return out;
}

/** Most common thickness (px) of wall bands, from horizontal+vertical run lengths. */
export function typicalBandThickness(walls: Mask, maxThickness = 60) {
  const counts = new Uint32Array(maxThickness + 1);
  const { width, height, data } = walls;
  const scan = (horizontal: boolean) => {
    const lines = horizontal ? height : width;
    const length = horizontal ? width : height;
    for (let line = 0; line < lines; line += 1) {
      let run = 0;
      for (let i = 0; i <= length; i += 1) {
        const set =
          i < length &&
          data[horizontal ? line * width + i : i * width + line] === 1;
        if (set) run += 1;
        else if (run > 0) {
          if (run <= maxThickness) counts[run] = counts[run]! + run;
          run = 0;
        }
      }
    }
  };
  scan(true);
  scan(false);
  let best = 1;
  for (let t = 2; t <= maxThickness; t += 1) {
    if (counts[t]! > counts[best]!) best = t;
  }
  return best;
}

/**
 * 4-connected components of free (unset) pixels. Returns a label per pixel
 * (0 = wall) and each component's pixel count and whether it touches the
 * image border (outdoors).
 */
export function freeComponents(walls: Mask) {
  const { width, height, data } = walls;
  const labels = new Int32Array(width * height);
  const sizes: number[] = [0];
  const touchesBorder: boolean[] = [false];
  const stack = new Int32Array(width * height);
  let next = 1;
  for (let start = 0; start < labels.length; start += 1) {
    if (data[start] || labels[start]) continue;
    let top = 0;
    stack[top++] = start;
    labels[start] = next;
    let size = 0;
    let border = false;
    while (top > 0) {
      const p = stack[--top]!;
      size += 1;
      const x = p % width;
      const y = (p - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1)
        border = true;
      const push = (q: number) => {
        if (!data[q] && !labels[q]) {
          labels[q] = next;
          stack[top++] = q;
        }
      };
      if (x > 0) push(p - 1);
      if (x < width - 1) push(p + 1);
      if (y > 0) push(p - width);
      if (y < height - 1) push(p + width);
    }
    sizes.push(size);
    touchesBorder.push(border);
    next += 1;
  }
  return { labels, sizes, touchesBorder };
}

/**
 * Door-sized openings between free-space components: for each pixel sealed
 * along an axis, the components found on either side of the seal (looking
 * across it up to `reach` px) share a doorway. Returns contact lengths per
 * component pair, keyed "a,b" with a < b.
 */
export function doorwayContacts(
  labels: Int32Array,
  walls: Mask,
  sealed: Mask,
  horizontal: boolean,
  reach: number,
) {
  const { width, height } = walls;
  const contacts = new Map<string, number>();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (!sealed.data[i] || walls.data[i]) continue;
      // A horizontal seal separates the free space above from below.
      const find = (step: number) => {
        for (let d = 1; d <= reach; d += 1) {
          const xx = horizontal ? x : x + step * d;
          const yy = horizontal ? y + step * d : y;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) return 0;
          const label = labels[yy * width + xx]!;
          if (label) return label;
        }
        return 0;
      };
      const a = find(-1);
      const b = find(1);
      if (!a || !b || a === b) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      contacts.set(key, (contacts.get(key) ?? 0) + 1);
    }
  }
  return contacts;
}

/**
 * Grows labelled components through doorways into unlabelled ones, breadth
 * first. A component reached by two labels in the same step is shared
 * circulation and stays unassigned; labelled components never merge.
 * `minContact` ignores slivers that only brush a seal.
 */
export function growThroughDoorways(
  componentCount: number,
  seedOwners: Map<number, number>,
  contacts: Map<string, number>,
  blocked: (component: number) => boolean,
  minContact: number,
) {
  const neighbours = new Map<number, number[]>();
  for (const [key, length] of contacts) {
    if (length < minContact) continue;
    const [a, b] = key.split(",").map(Number) as [number, number];
    neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
    neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
  }
  const owner = new Int32Array(componentCount + 1).fill(0); // 0 free, -1 shared
  let frontier: number[] = [];
  for (const [component, room] of seedOwners) {
    owner[component] = room;
    frontier.push(component);
  }
  while (frontier.length) {
    const claims = new Map<number, Set<number>>();
    for (const component of frontier) {
      for (const next of neighbours.get(component) ?? []) {
        if (owner[next] !== 0 || blocked(next)) continue;
        const set = claims.get(next) ?? new Set<number>();
        set.add(owner[component]!);
        claims.set(next, set);
      }
    }
    frontier = [];
    for (const [component, rooms] of claims) {
      if (rooms.size === 1) {
        owner[component] = [...rooms][0]!;
        frontier.push(component);
      } else {
        owner[component] = -1;
      }
    }
  }
  return owner;
}

/** Centroid (px) of every component. */
export function componentCentroids(
  labels: Int32Array,
  width: number,
  count: number,
) {
  const sx = new Float64Array(count + 1);
  const sy = new Float64Array(count + 1);
  const n = new Float64Array(count + 1);
  for (let i = 0; i < labels.length; i += 1) {
    const c = labels[i]!;
    if (!c) continue;
    sx[c] = sx[c]! + (i % width);
    sy[c] = sy[c]! + Math.floor(i / width);
    n[c] = n[c]! + 1;
  }
  return Array.from({ length: count + 1 }, (_, c) =>
    n[c] ? { x: sx[c]! / n[c]!, y: sy[c]! / n[c]! } : { x: 0, y: 0 },
  );
}

/**
 * Like growThroughDoorways, but each unlabelled component goes to the room
 * with the shortest walking distance (centroid to centroid through doorways),
 * and a room stops growing once it reaches `maxRoomSize` pixels.
 */
export function growByDistance(
  sizes: number[],
  centroids: Array<{ x: number; y: number }>,
  seedOwners: Map<number, number>,
  contacts: Map<string, number>,
  blocked: (component: number) => boolean,
  minContact: number,
  maxRoomSize: number,
) {
  const neighbours = new Map<number, number[]>();
  for (const [key, length] of contacts) {
    if (length < minContact) continue;
    const [a, b] = key.split(",").map(Number) as [number, number];
    neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
    neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
  }
  const owner = new Int32Array(sizes.length).fill(0);
  const roomSize = new Map<number, number>();
  // Simple binary-heap Dijkstra over components.
  const heap: Array<[number, number, number]> = []; // [distance, component, room]
  const push = (item: [number, number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent]![0] <= heap[i]![0]) break;
      [heap[parent], heap[i]] = [heap[i]!, heap[parent]!];
      i = parent;
    }
  };
  const pop = () => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  for (const [component, room] of seedOwners) {
    owner[component] = room;
    roomSize.set(room, (roomSize.get(room) ?? 0) + sizes[component]!);
  }
  for (const [component, room] of seedOwners) {
    for (const next of neighbours.get(component) ?? []) {
      const a = centroids[component]!,
        b = centroids[next]!;
      push([Math.hypot(a.x - b.x, a.y - b.y), next, room]);
    }
  }
  while (heap.length) {
    const [distance, component, room] = pop();
    if (owner[component] !== 0 || blocked(component)) continue;
    const size = roomSize.get(room)! + sizes[component]!;
    if (size > maxRoomSize) continue;
    owner[component] = room;
    roomSize.set(room, size);
    for (const next of neighbours.get(component) ?? []) {
      if (owner[next] !== 0) continue;
      const a = centroids[component]!,
        b = centroids[next]!;
      push([distance + Math.hypot(a.x - b.x, a.y - b.y), next, room]);
    }
  }
  return owner;
}

/**
 * Circulation: components that open (through doorways) onto three or more
 * different labelled cores, or long narrow strips, are corridors/lobbies and
 * are never absorbed into a suite.
 */
export function circulationComponents(
  labels: Int32Array,
  width: number,
  count: number,
  seedOwners: Map<number, number>,
  contacts: Map<string, number>,
  minContact: number,
) {
  const minX = new Float64Array(count + 1).fill(Infinity);
  const minY = new Float64Array(count + 1).fill(Infinity);
  const maxX = new Float64Array(count + 1).fill(-Infinity);
  const maxY = new Float64Array(count + 1).fill(-Infinity);
  const area = new Float64Array(count + 1);
  for (let i = 0; i < labels.length; i += 1) {
    const c = labels[i]!;
    if (!c) continue;
    const x = i % width,
      y = (i - x) / width;
    if (x < minX[c]!) minX[c] = x;
    if (x > maxX[c]!) maxX[c] = x;
    if (y < minY[c]!) minY[c] = y;
    if (y > maxY[c]!) maxY[c] = y;
    area[c] = area[c]! + 1;
  }
  const cores = new Map<number, Set<number>>();
  for (const [key, length] of contacts) {
    if (length < minContact) continue;
    const [a, b] = key.split(",").map(Number) as [number, number];
    for (const [c, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const room = seedOwners.get(other);
      if (room === undefined) continue;
      const set = cores.get(c) ?? new Set<number>();
      set.add(room);
      cores.set(c, set);
    }
  }
  const circulation = new Set<number>();
  for (let c = 1; c <= count; c += 1) {
    if (seedOwners.has(c) || !area[c]) continue;
    const long = Math.max(maxX[c]! - minX[c]!, maxY[c]! - minY[c]!) + 1;
    // Mean width of a strip = area / length.
    const narrow = area[c]! / long;
    if ((cores.get(c)?.size ?? 0) >= 3 || long > 6 * narrow) circulation.add(c);
  }
  return circulation;
}

/**
 * Typical door width (normalized page units along the long side) from
 * door-swing arcs: a quarter-circle swing's chord is √2 × the leaf width.
 * Takes the most common chord length, ignoring tiny revision-cloud scallops.
 */
export function typicalDoorWidth(
  arcs: Array<{ x1: number; y1: number; x2: number; y2: number }>,
  aspect: number,
) {
  const bins = new Map<number, number>();
  const binSize = 0.0005;
  for (const arc of arcs) {
    const dx = (arc.x2 - arc.x1) * (aspect >= 1 ? 1 : aspect);
    const dy = (arc.y2 - arc.y1) * (aspect >= 1 ? 1 / aspect : 1);
    const chord = Math.hypot(dx, dy);
    if (chord < 0.004 || chord > 0.05) continue;
    const bin = Math.round(chord / binSize);
    bins.set(bin, (bins.get(bin) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [bin, count] of bins) {
    // Smooth over neighbouring bins so near-identical doors pool together.
    const pooled = count + (bins.get(bin - 1) ?? 0) + (bins.get(bin + 1) ?? 0);
    if (pooled > bestCount) {
      bestCount = pooled;
      best = bin;
    }
  }
  return best ? (best * binSize) / Math.SQRT2 : null;
}

/** Sets a (2r+1)-wide square brush along the segment. */
export function stampLine(
  mask: Mask,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let s = 0; s <= steps; s += 1) {
    const x = Math.round(x0 + ((x1 - x0) * s) / steps);
    const y = Math.round(y0 + ((y1 - y0) * s) / steps);
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        const xx = x + dx,
          yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < mask.width && yy < mask.height) {
          mask.data[yy * mask.width + xx] = 1;
        }
      }
    }
  }
}

function inkNear(mask: Mask, x: number, y: number, r: number) {
  let hits = 0;
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      const xx = Math.round(x + dx),
        yy = Math.round(y + dy);
      if (xx >= 0 && yy >= 0 && xx < mask.width && yy < mask.height) {
        hits += mask.data[yy * mask.width + xx]!;
      }
    }
  }
  return hits;
}

export type DoorSeal = { x0: number; y0: number; x1: number; y1: number };

/**
 * Door openings from quarter-circle swing arcs. A swing's chord joins the
 * jamb on the wall to the open leaf tip; the hinge is the right-angle corner
 * of the isosceles triangle on that chord, and the opening runs hinge→jamb.
 * Of the two possible hinges and two chord ends, the ones sitting on wall ink
 * are chosen. Chords outside plausible door sizes (e.g. revision-cloud
 * scallops) are ignored.
 */
export function doorSealsFromArcs(
  arcs: Array<{ x1: number; y1: number; x2: number; y2: number }>,
  walls: Mask,
  doorPx: number,
  probe: number,
): DoorSeal[] {
  const { width, height } = walls;
  const seals: DoorSeal[] = [];
  for (const arc of arcs) {
    const ax = arc.x1 * width,
      ay = arc.y1 * height;
    const bx = arc.x2 * width,
      by = arc.y2 * height;
    const chord = Math.hypot(bx - ax, by - ay);
    const leaf = chord / Math.SQRT2;
    if (leaf < doorPx * 0.55 || leaf > doorPx * 2.2) continue;
    const mx = (ax + bx) / 2,
      my = (ay + by) / 2;
    const nx = -(by - ay) / chord,
      ny = (bx - ax) / chord;
    const hinges = [
      { x: mx + (nx * chord) / 2, y: my + (ny * chord) / 2 },
      { x: mx - (nx * chord) / 2, y: my - (ny * chord) / 2 },
    ];
    const hinge = hinges
      .map((h) => ({ h, ink: inkNear(walls, h.x, h.y, probe) }))
      .sort((p, q) => q.ink - p.ink)[0]!;
    if (!hinge.ink) continue;
    const ends = [
      { x: ax, y: ay, ink: inkNear(walls, ax, ay, probe) },
      { x: bx, y: by, ink: inkNear(walls, bx, by, probe) },
    ].sort((p, q) => q.ink - p.ink);
    const jamb = ends[0]!;
    if (!jamb.ink) continue;
    seals.push({ x0: hinge.h.x, y0: hinge.h.y, x1: jamb.x, y1: jamb.y });
  }
  return seals;
}

export type RasterCells = {
  width: number;
  height: number;
  walls: Mask;
  /** Walls plus sealed openings and everything outdoors. */
  sealed: Mask;
  labels: Int32Array;
  sizes: number[];
  touchesBorder: boolean[];
  /** Doorway contact length (px) per component pair "a,b" (a < b). */
  contacts: Map<string, number>;
  /** Door width in px, the scale for everything else. */
  doorPx: number;
  /** Openings sealed from door-swing arcs (px). */
  doorSeals: DoorSeal[];
};

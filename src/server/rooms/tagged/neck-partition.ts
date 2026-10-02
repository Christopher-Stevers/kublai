/**
 * Splits free floor space at doorways, the way a person reads a plan: a room
 * is a wide open area; a doorway is a narrow neck between two of them.
 *
 *  1. Distance from every free pixel to the nearest wall.
 *  2. Cores: free space more than `neck` px from any wall. Doorways and
 *     cased openings are narrower than 2·neck, so they vanish and each room
 *     keeps its own core; corridors are wider and keep theirs.
 *  3. Grow all cores back outward together, highest ground first
 *     (watershed on the distance map), so neighbouring spaces meet at the
 *     narrowest point between them: the doorway.
 *  4. Name regions from the room seeds; a region holding several seeds is
 *     shared out by distance to each seed.
 *  5. Unit level: an unnamed region whose neighbours are (almost) all one
 *     named room (a suite's bathroom or bedroom) joins it. Unnamed regions
 *     between several rooms (corridors, lobbies) stay their own space.
 */

export type NeckSeed = { x: number; y: number; name: string };

const SMALL_ROOM = /\b(?:closet|elec(?:trical)?|riser|shaft|garbage|janitor|storage|mech(?:anical)?|data|chute|intake)\b/i;
const CIRCULATION = /\b(?:corr(?:idor)?|lobby|vestibule|vest|hall(?:way)?|stair|elev(?:ator)?|foyer|entry|exit|passage)\b/i;

/** 3-4 chamfer distance (≈ Euclidean px × 3) to the nearest wall pixel. */
function chamfer(free: Uint8Array, width: number, height: number) {
  const INF = 1 << 29;
  const d = new Int32Array(width * height);
  for (let i = 0; i < d.length; i++) d[i] = free[i] ? INF : 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!d[i]) continue;
      let v = d[i]!;
      if (x > 0) v = Math.min(v, d[i - 1]! + 3);
      if (y > 0) {
        v = Math.min(v, d[i - width]! + 3);
        if (x > 0) v = Math.min(v, d[i - width - 1]! + 4);
        if (x < width - 1) v = Math.min(v, d[i - width + 1]! + 4);
      } else v = Math.min(v, 3); // page edge counts as wall
      if (x === 0 || x === width - 1) v = Math.min(v, 3);
      d[i] = v;
    }
  for (let y = height - 1; y >= 0; y--)
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (!d[i]) continue;
      let v = d[i]!;
      if (x < width - 1) v = Math.min(v, d[i + 1]! + 3);
      if (y < height - 1) {
        v = Math.min(v, d[i + width]! + 3);
        if (x < width - 1) v = Math.min(v, d[i + width + 1]! + 4);
        if (x > 0) v = Math.min(v, d[i + width - 1]! + 4);
      } else v = Math.min(v, 3);
      d[i] = v;
    }
  return d;
}

export function partitionAtNecks(
  walls: Uint8Array,
  width: number,
  height: number,
  seeds: NeckSeed[],
  { neck, minRoomPx }: { neck: number; minRoomPx: number },
) {
  const N = width * height;
  const free = new Uint8Array(N);
  for (let i = 0; i < N; i++) free[i] = walls[i] ? 0 : 1;
  const dist = chamfer(free, width, height);
  const neck3 = neck * 3;

  // 2. Cores: connected components of deep free space.
  const label = new Int32Array(N);
  const queue = new Int32Array(N);
  let cores = 0;
  for (let s = 0; s < N; s++) {
    if (dist[s]! <= neck3 || label[s]) continue;
    cores++;
    let head = 0, tail = 0;
    queue[tail++] = s;
    label[s] = cores;
    while (head < tail) {
      const p = queue[head++]!;
      const x = p % width;
      for (const q of [p - 1, p + 1, p - width, p + width]) {
        if (q < 0 || q >= N) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === width - 1)) continue;
        if (!label[q] && dist[q]! > neck3) { label[q] = cores; queue[tail++] = q; }
      }
    }
  }

  // 3. Watershed growth: lower the water level one step at a time and let
  // every labelled region flood the newly exposed free pixels next to it.
  for (let level = neck3; level >= 1; level--) {
    let tail = 0;
    for (let p = 0; p < N; p++) {
      if (!label[p] || dist[p]! < level) continue;
      const x = p % width;
      if ((x > 0 && !label[p - 1] && dist[p - 1]! >= level) || (x < width - 1 && !label[p + 1] && dist[p + 1]! >= level) ||
        (p >= width && !label[p - width] && dist[p - width]! >= level) || (p + width < N && !label[p + width] && dist[p + width]! >= level)) {
        queue[tail++] = p;
      }
    }
    let head = 0;
    while (head < tail) {
      const p = queue[head++]!;
      const x = p % width;
      const l = label[p]!;
      for (const q of [p - 1, p + 1, p - width, p + width]) {
        if (q < 0 || q >= N) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === width - 1)) continue;
        if (!label[q] && dist[q]! >= level) { label[q] = l; queue[tail++] = q; }
      }
    }
  }

  // 4. Seeds name regions. Find each seed's region (nudging off walls/text).
  const reach = Math.max(4, Math.round(neck * 2));
  const seedPixel = seeds.map((s) => {
    const cx = Math.round(s.x * (width - 1)), cy = Math.round(s.y * (height - 1));
    for (let r = 0; r <= reach; r++)
      for (let dy = -r; dy <= r; dy++)
        for (const dx of r === 0 ? [0] : [-r + Math.abs(dy), r - Math.abs(dy)]) {
          const x = cx + dx, y = cy + dy;
          if (x >= 0 && y >= 0 && x < width && y < height && label[y * width + x]) return y * width + x;
        }
    return -1;
  });
  const seedsByRegion = new Map<number, number[]>();
  seedPixel.forEach((p, i) => {
    if (p < 0) return;
    const l = label[p]!;
    seedsByRegion.set(l, [...(seedsByRegion.get(l) ?? []), i]);
  });
  // Output labels: 1..seeds.length = that seed; higher = unnamed region.
  const out = new Int32Array(N);
  const unnamedId = new Map<number, number>();
  let nextUnnamed = seeds.length;
  for (let p = 0; p < N; p++) {
    const l = label[p]!;
    if (!l) continue;
    const owners = seedsByRegion.get(l);
    if (owners?.length === 1) out[p] = owners[0]! + 1;
    else if (!owners) {
      let u = unnamedId.get(l);
      if (!u) unnamedId.set(l, (u = ++nextUnnamed));
      out[p] = u;
    }
  }
  // Regions with several seeds: share by geodesic distance from each seed.
  for (const [l, owners] of seedsByRegion) {
    if (owners.length < 2) continue;
    let head = 0, tail = 0;
    for (const i of owners) { const p = seedPixel[i]!; if (!out[p]) { out[p] = i + 1; queue[tail++] = p; } }
    while (head < tail) {
      const p = queue[head++]!;
      const x = p % width;
      for (const q of [p - 1, p + 1, p - width, p + width]) {
        if (q < 0 || q >= N) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === width - 1)) continue;
        if (!out[q] && label[q] === l) { out[q] = out[p]!; queue[tail++] = q; }
      }
    }
  }

  // 5. Unit assembly through the doorway network. Regions that touch
  // directly (free pixel next to free pixel) are joined by a doorway or
  // opening; regions separated by wall never touch.
  const contact = new Map<string, number>();
  for (let p = 0; p < N; p++) {
    const a = out[p]!;
    if (!a) continue;
    const x = p % width;
    for (const q of [x < width - 1 ? p + 1 : -1, p + width < N ? p + width : -1]) {
      if (q < 0) continue;
      const b = out[q]!;
      if (!b || b === a) continue;
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      contact.set(k, (contact.get(k) ?? 0) + 1);
    }
  }
  const minContact = Math.max(3, Math.round(neck * 0.5));
  const neighbours = new Map<number, Set<number>>();
  for (const [k, n] of contact) {
    if (n < minContact) continue;
    const [a, b] = k.split(",").map(Number) as [number, number];
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    if (!neighbours.has(b)) neighbours.set(b, new Set());
    neighbours.get(a)!.add(b);
    neighbours.get(b)!.add(a);
  }
  const isNamed = (l: number) => l <= seeds.length;
  // Circulation never owns the rooms that open off it.
  const circulation = (l: number) => isNamed(l) && CIRCULATION.test(seeds[l - 1]!.name);
  // Shared spaces open directly onto two or more named rooms (not counting
  // corridors/lobbies/stairs): unnamed corridors, lobbies, shared vestibules.
  const shared = new Set<number>();
  for (const [l, ns] of neighbours) {
    if (isNamed(l)) continue;
    let named = 0;
    for (const n of ns) if (isNamed(n) && !circulation(n)) named++;
    if (named >= 2) shared.add(l);
  }
  // Spread each named room through private unnamed spaces; a space reached
  // from more than one named room is left as its own space.
  const owner = new Map<number, number>();
  const conflict = new Set<number>();
  let frontier: Array<[number, number]> = [];
  for (let l = 1; l <= seeds.length; l++) if (!circulation(l)) frontier.push([l, l]);
  while (frontier.length) {
    const next: Array<[number, number]> = [];
    const claims = new Map<number, Set<number>>();
    for (const [region, from] of frontier)
      for (const n of neighbours.get(region) ?? []) {
        if (isNamed(n) || shared.has(n) || owner.has(n) || conflict.has(n)) continue;
        if (!claims.has(n)) claims.set(n, new Set());
        claims.get(n)!.add(from);
      }
    for (const [n, froms] of claims) {
      if (froms.size === 1) { const f = [...froms][0]!; owner.set(n, f); next.push([n, f]); }
      else conflict.add(n);
    }
    frontier = next;
  }
  for (let p = 0; p < N; p++) { const to = owner.get(out[p]!); if (to) out[p] = to; }
  const merged = owner.size;
  // A small room's tag often sits in the corridor outside it. A region named
  // after a closet/riser that opens onto three or more other rooms is
  // really that corridor.
  const renames = new Map<number, string>();
  for (let l = 1; l <= seeds.length; l++) {
    if (!SMALL_ROOM.test(seeds[l - 1]!.name)) continue;
    let opens = 0;
    for (const n of neighbours.get(l) ?? []) if (isNamed(n) && !circulation(n)) opens++;
    if (opens >= 3) renames.set(l, "Corridor");
  }
  // Drop unnamed specks, and unnamed open ground (page background, site):
  // anything touching the page edge or far larger than the named rooms.
  const finalArea = new Map<number, number>();
  const edge = new Set<number>();
  const sumX = new Map<number, number>(), sumY = new Map<number, number>();
  for (let p = 0; p < N; p++) {
    const l = out[p]!;
    if (!l) continue;
    finalArea.set(l, (finalArea.get(l) ?? 0) + 1);
    const x = p % width, y = (p - x) / width;
    sumX.set(l, (sumX.get(l) ?? 0) + x);
    sumY.set(l, (sumY.get(l) ?? 0) + y);
    if (x < 3 || y < 3 || x >= width - 3 || y >= height - 3) edge.add(l);
  }
  // Title block / margin band: unnamed spaces centred there are sheet furniture.
  for (const [l, a] of finalArea)
    if (sumX.get(l)! / a > width * 0.92 || sumY.get(l)! / a > height * 0.96) edge.add(l);
  const named = [...finalArea].filter(([l]) => l <= seeds.length).map(([, a]) => a).sort((a, b) => a - b);
  const medianNamed = named[Math.floor(named.length / 2)] ?? N;
  for (let p = 0; p < N; p++) {
    const l = out[p]!;
    if (l > seeds.length && (finalArea.get(l)! < minRoomPx || edge.has(l) || finalArea.get(l)! > medianNamed * 15)) out[p] = 0;
  }

  const rejected = seedPixel.flatMap((p, i) => (p < 0 ? [{ seedIndex: i, reason: "on-wall" as const }] : []));
  return { labels: out, cores, merged, shared: shared.size, renames, rejected };
}

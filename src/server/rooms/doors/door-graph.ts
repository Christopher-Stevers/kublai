/**
 * Rooms from a layered CAD plan, read the way a person reads one: walls and
 * door swings enclose spaces; every door links the two spaces it opens
 * between. Spaces with many doors are the building's common spaces
 * (corridors, lobbies); a unit is everything reached through one door off
 * a common space.
 */

export type LayeredSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  layer?: string;
};

export type PlanRole = "wall" | "door";

/** AIA/NCS layer names: discipline-major-minor, optionally behind an xref prefix. */
export function planRole(layer: string | undefined): PlanRole | null {
  if (!layer) return null;
  const name = layer.split("|").pop()!.toUpperCase();
  if (/^A-DOOR(?!-(?:IDEN|ANNO|TEXT|NOTE))/.test(name)) return name.startsWith("A-DOOR-FRAM") ? "wall" : "door";
  if (/^[AIS]-WALL(?!-(?:IDEN|ANNO|TEXT|NOTE|PATT|HTCH))/.test(name)) return "wall";
  if (/^A-GLAZ(?!-(?:IDEN|ANNO|TEXT|NOTE|HDLN))/.test(name)) return "wall";
  if (/^[AS]-COLS(?!-(?:IDEN|ANNO|TEXT|NOTE|HDLN))/.test(name)) return "wall";
  return null;
}

export type Door = {
  id: number;
  /** Bounding box in raster pixels. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** The spaces this door opens between (labels); one for an outside door. */
  spaces: number[];
};

function line(
  mask: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  value: number,
) {
  // Bresenham: an 8-connected line no 4-connected flood can cross.
  let x = Math.round(x0), y = Math.round(y0);
  const xe = Math.round(x1), ye = Math.round(y1);
  const dx = Math.abs(xe - x), dy = -Math.abs(ye - y);
  const sx = x < xe ? 1 : -1, sy = y < ye ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x >= 0 && y >= 0 && x < width && y < height) mask[y * width + x] = value;
    if (x === xe && y === ye) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

/** Group door strokes that touch into door instances (leaf + swing, pairs). */
function doorInstances(segments: LayeredSegment[], width: number, height: number, join: number) {
  const parent = segments.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const cell = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / join)},${Math.floor(y / join)}`;
  const ends = segments.map((s) => [
    [s.x1 * (width - 1), s.y1 * (height - 1)],
    [s.x2 * (width - 1), s.y2 * (height - 1)],
  ] as const);
  ends.forEach((pair, i) => {
    for (const [x, y] of pair) {
      for (let gx = -1; gx <= 1; gx++)
        for (let gy = -1; gy <= 1; gy++) {
          for (const j of cell.get(`${Math.floor(x / join) + gx},${Math.floor(y / join) + gy}`) ?? []) {
            for (const [u, v] of ends[j]!)
              if (Math.hypot(u - x, v - y) <= join) parent[find(i)] = find(j);
          }
        }
      const k = key(x, y);
      cell.set(k, [...(cell.get(k) ?? []), i]);
    }
  });
  const groups = new Map<number, number[]>();
  segments.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  return [...groups.values()];
}

type Pt = { x: number; y: number };

/** Least-squares circle through points (Kåsa fit); null when degenerate. */
export function fitCircle(points: Pt[]) {
  if (points.length < 3) return null;
  let mx = 0, my = 0;
  for (const p of points) { mx += p.x; my += p.y; }
  mx /= points.length; my /= points.length;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of points) {
    const u = p.x - mx, v = p.y - my;
    suu += u * u; svv += v * v; suv += u * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-12) return null;
  const a = (suuu + suvv) / 2, b = (svvv + svuu) / 2;
  const uc = (a * svv - b * suv) / det, vc = (b * suu - a * suv) / det;
  const x = uc + mx, y = vc + my;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / points.length);
  let error = 0;
  for (const p of points) error = Math.max(error, Math.abs(Math.hypot(p.x - x, p.y - y) - r));
  return { x, y, r, error };
}

/**
 * Door swings are drawn as an arc (often flattened into short strokes),
 * usually with the open leaf. The arc's centre is the hinge; lines from the
 * hinge to both arc ends close the doorway even when the leaf is missing.
 */
export function swingSeals(strokes: Array<[Pt, Pt]>, doorSize: number) {
  const short = strokes.filter(([a, b]) => {
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    return l > 1e-6 && l < doorSize * 0.35;
  });
  // Nodes: stroke ends merged on a small grid.
  const join = Math.max(0.5, doorSize * 0.01);
  const nodeOf = new Map<string, number>();
  const nodes: Pt[] = [];
  const node = (p: Pt) => {
    const gx = Math.round(p.x / join), gy = Math.round(p.y / join);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const hit = nodeOf.get(`${gx + dx},${gy + dy}`);
        if (hit !== undefined && Math.hypot(nodes[hit]!.x - p.x, nodes[hit]!.y - p.y) <= join) return hit;
      }
    nodes.push(p);
    nodeOf.set(`${gx},${gy}`, nodes.length - 1);
    return nodes.length - 1;
  };
  const edges = short.map(([a, b]) => [node(a), node(b)] as [number, number]).filter(([a, b]) => a !== b);
  const at = new Map<number, number[]>();
  edges.forEach(([a, b], i) => {
    at.set(a, [...(at.get(a) ?? []), i]);
    at.set(b, [...(at.get(b) ?? []), i]);
  });
  const used = new Uint8Array(edges.length);
  const seals: Array<{ hinge: Pt; ends: [Pt, Pt]; r: number }> = [];
  const heading = (from: number, to: number) => Math.atan2(nodes[to]!.y - nodes[from]!.y, nodes[to]!.x - nodes[from]!.x);
  const turn = (a: number, b: number) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  // Walk smooth runs that keep turning the same way: one swing each.
  const extend = (path: number[], edge: number, from: number) => {
    let current = edge, tail = edges[edge]![0] === from ? edges[edge]![1] : edges[edge]![0];
    let prevHeading = heading(from, tail), sign = 0;
    for (;;) {
      const next = (at.get(tail) ?? []).filter((e) => e !== current && !used[e]);
      if (next.length !== 1 || (at.get(tail)?.length ?? 0) > 2) break;
      const e = next[0]!;
      const to = edges[e]![0] === tail ? edges[e]![1] : edges[e]![0];
      const h = heading(tail, to), d = turn(prevHeading, h);
      if (Math.abs(d) > 0.5) break;
      if (Math.abs(d) > 0.01) { const s = Math.sign(d); if (sign && s !== sign) break; sign = s; }
      used[e] = 1;
      path.push(to);
      prevHeading = h; current = e; tail = to;
    }
  };
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const [a, b] = edges[i]!;
    const forward = [b], backward = [a];
    extend(forward, i, a);
    extend(backward, i, b);
    const path = [...backward.reverse(), ...forward].map((n) => nodes[n]!);
    if (path.length < 4) continue;
    const circle = fitCircle(path);
    if (!circle || circle.r < doorSize * 0.3 || circle.r > doorSize * 2.2 || circle.error > Math.max(1, circle.r * 0.06)) continue;
    const first = path[0]!, last = path[path.length - 1]!;
    const sweep = Math.abs(turn(Math.atan2(first.y - circle.y, first.x - circle.x), Math.atan2(last.y - circle.y, last.x - circle.x)));
    if (sweep < Math.PI / 6 || sweep > Math.PI * 0.75) continue;
    const toCircle = (p: Pt) => {
      const t = Math.atan2(p.y - circle.y, p.x - circle.x);
      return { x: circle.x + circle.r * Math.cos(t), y: circle.y + circle.r * Math.sin(t) };
    };
    seals.push({ hinge: { x: circle.x, y: circle.y }, ends: [toCircle(first), toCircle(last)], r: circle.r });
  }
  return seals;
}

/** A doorway: the wall gap a leaf closes, and the side the leaf swings into. */
export type Opening = { hinge: Pt; closed: Pt; open: Pt; r: number };

/**
 * Which arc end is the closed position: the open leaf is drawn as a line (or
 * thin rectangle) from the hinge to the other end; the closed end sits in the
 * wall gap with nothing drawn along it.
 */
function closedEnd(seal: { hinge: Pt; ends: [Pt, Pt]; r: number }, strokes: Array<[Pt, Pt]>): Opening | null {
  const { hinge, r } = seal;
  const leafScore = (end: Pt) => {
    const dx = (end.x - hinge.x) / r, dy = (end.y - hinge.y) / r;
    let score = 0;
    for (const [a, b] of strokes) {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < r * 0.6 || len > r * 1.3) continue;
      if (Math.abs(((b.x - a.x) * dx + (b.y - a.y) * dy) / len) < 0.95) continue;
      const off = (p: Pt) => Math.abs((p.x - hinge.x) * dy - (p.y - hinge.y) * dx);
      if (off(a) < r * 0.25 && off(b) < r * 0.25) score++;
    }
    return score;
  };
  const [a, b] = seal.ends;
  const sa = leafScore(a), sb = leafScore(b);
  if (sa === sb) return null;
  return sa > sb ? { hinge, closed: b, open: a, r } : { hinge, closed: a, open: b, r };
}

/** Square dilation in place; wall pixels win over door pixels. */
function dilate(mask: Uint8Array, width: number, height: number, radius: number) {
  const tmp = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (let k = Math.max(0, x - radius); k <= Math.min(width - 1, x + radius); k++) {
        const m = mask[row + k]!;
        if (m && (!v || m < v)) v = m;
        if (v === 1) break;
      }
      tmp[row + x] = v;
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let v = 0;
      for (let k = Math.max(0, y - radius); k <= Math.min(height - 1, y + radius); k++) {
        const m = tmp[k * width + x]!;
        if (m && (!v || m < v)) v = m;
        if (v === 1) break;
      }
      mask[y * width + x] = v;
    }
  }
}

export function doorGraph(
  segments: LayeredSegment[],
  { width, height }: { width: number; height: number },
) {
  const N = width * height;
  const barrier = new Uint8Array(N);
  const doorSegments: LayeredSegment[] = [];
  for (const s of segments) {
    const role = planRole(s.layer);
    if (!role) continue;
    if (role === "door") doorSegments.push(s);
    line(barrier, width, height, s.x1 * (width - 1), s.y1 * (height - 1), s.x2 * (width - 1), s.y2 * (height - 1), role === "door" ? 2 : 1);
  }
  const groups = doorInstances(doorSegments, width, height, 1.5);
  // Door size sets the drawing scale: a leaf is about 0.9 m.
  const doorBoxes = groups.map((g) => {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const i of g) {
      const s = doorSegments[i]!;
      for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]] as const) {
        left = Math.min(left, x * (width - 1)); right = Math.max(right, x * (width - 1));
        top = Math.min(top, y * (height - 1)); bottom = Math.max(bottom, y * (height - 1));
      }
    }
    return { left, top, right, bottom, segments: g, openings: [] as Opening[] };
  });
  const sizes = doorBoxes.map((b) => Math.max(b.right - b.left, b.bottom - b.top)).filter((v) => v > 4).sort((a, b) => a - b);
  const doorSize = sizes[Math.floor(sizes.length / 2)] ?? Math.max(width, height) * 0.01;
  const px = (x: number, y: number) => ({ x: x * (width - 1), y: y * (height - 1) });
  let sealed = 0;
  for (const box of doorBoxes) {
    const strokes = box.segments.map((i) => {
      const s = doorSegments[i]!;
      return [px(s.x1, s.y1), px(s.x2, s.y2)] as [Pt, Pt];
    });
    for (const seal of swingSeals(strokes, doorSize)) {
      sealed++;
      for (const end of seal.ends) line(barrier, width, height, seal.hinge.x, seal.hinge.y, end.x, end.y, 2);
      const opening = closedEnd(seal, strokes);
      if (opening) box.openings.push(opening);
    }
  }

  // CAD walls rarely meet exactly; close hairline gaps (about 4 cm) so a
  // mullion offset doesn't join a lobby to the street.
  dilate(barrier, width, height, Math.max(1, Math.round(doorSize * 0.04)));

  // Spaces: 4-connected free areas between walls and door swings.
  const label = new Int32Array(N);
  const queue = new Int32Array(N);
  const area: number[] = [0];
  const edge: boolean[] = [false];
  let count = 0;
  for (let s = 0; s < N; s++) {
    if (barrier[s] || label[s]) continue;
    count++;
    let head = 0, tail = 0, size = 0, touches = false;
    queue[tail++] = s;
    label[s] = count;
    while (head < tail) {
      const p = queue[head++]!;
      size++;
      const x = p % width;
      if (x === 0 || x === width - 1 || p < width || p >= N - width) touches = true;
      if (x > 0 && !barrier[p - 1] && !label[p - 1]) { label[p - 1] = count; queue[tail++] = p - 1; }
      if (x < width - 1 && !barrier[p + 1] && !label[p + 1]) { label[p + 1] = count; queue[tail++] = p + 1; }
      if (p >= width && !barrier[p - width] && !label[p - width]) { label[p - width] = count; queue[tail++] = p - width; }
      if (p < N - width && !barrier[p + width] && !label[p + width]) { label[p + width] = count; queue[tail++] = p + width; }
    }
    area.push(size);
    edge.push(touches);
  }
  return { barrier, label, area, edge, count, doorBoxes, doorSize, doorSegments, sealed };
}

/**
 * The spaces each door opens between: the two largest-contact room-sized
 * spaces within a short reach of the door's strokes. The swing's own pie
 * and wall cavities are too small to count.
 */
export function doorLinks(
  graph: ReturnType<typeof doorGraph>,
  width: number,
  height: number,
  minArea: number,
) {
  const { label, area, edge, doorBoxes, doorSize } = graph;
  const valid = (id: number) => id > 0 && area[id]! >= minArea;
  /** First room-sized space walking from the doorway, past wall, frame and swing. */
  const walk = (from: Pt, dx: number, dy: number, limit: number) => {
    for (let t = 0; t <= limit; t += 0.5) {
      const x = Math.round(from.x + dx * t), y = Math.round(from.y + dy * t);
      if (x < 0 || y < 0 || x >= width || y >= height) return 0;
      const id = label[y * width + x]!;
      if (valid(id)) return id;
    }
    return 0;
  };
  const reach = Math.max(2, Math.round(doorSize * 0.18));
  return doorBoxes.map((box) => {
    if (box.openings.length) {
      const found = new Set<number>();
      for (const { hinge, closed, open, r } of box.openings) {
        const mx = (hinge.x + closed.x) / 2, my = (hinge.y + closed.y) / 2;
        let nx = -(closed.y - hinge.y) / r, ny = (closed.x - hinge.x) / r;
        if (nx * (open.x - hinge.x) + ny * (open.y - hinge.y) < 0) { nx = -nx; ny = -ny; }
        for (const sign of [1, -1]) {
          const id = walk({ x: mx, y: my }, nx * sign, ny * sign, r * 1.6);
          if (id) found.add(id);
        }
      }
      const spaces = [...found];
      return { ...box, spaces, outside: spaces.some((id) => edge[id]) };
    }
    // No readable swing (sliding, pocket, unusual blocks): the spaces
    // touching the door's drawing. A second space needs real contact.
    const votes = new Map<number, number>();
    const l = Math.max(0, Math.floor(box.left - reach)), r = Math.min(width - 1, Math.ceil(box.right + reach));
    const t = Math.max(0, Math.floor(box.top - reach)), b = Math.min(height - 1, Math.ceil(box.bottom + reach));
    for (let y = t; y <= b; y++)
      for (let x = l; x <= r; x++) {
        const id = label[y * width + x]!;
        if (!valid(id)) continue;
        votes.set(id, (votes.get(id) ?? 0) + 1);
      }
    const ranked = [...votes].sort((a, b) => b[1] - a[1]);
    const spaces = ranked.slice(0, 2).filter(([, v], i) => i === 0 || v >= ranked[0]![1] * 0.25).map(([id]) => id);
    return { ...box, spaces, outside: spaces.some((id) => edge[id]) };
  });
}

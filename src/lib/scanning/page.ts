export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point]; // clockwise from top left
/** RGBA pixels: ImageData, or a plain object in tests. */
export type Pixels = { data: Uint8ClampedArray; width: number; height: number };
export type PageDetection = {
  brightness: number;
  /** Page corners in 0–1 frame coordinates. */
  quad: Quad | null;
  /** Detail inside the page; compare between frames to pick the sharpest. */
  sharpness: number;
  /** A page was found but part of it is outside the frame. */
  clipped: boolean;
};

const cross = (o: Point, a: Point, b: Point) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
function polygonArea(points: Point[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!,
      q = points[(i + 1) % points.length]!;
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}
function intersect(a: Point, b: Point, c: Point, d: Point): Point | null {
  const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

function boxBlur(src: Uint8Array, w: number, h: number, r: number) {
  const tmp = new Uint8Array(src.length),
    out = new Uint8Array(src.length),
    size = 2 * r + 1;
  const line = (
    from: Uint8Array,
    to: Uint8Array,
    base: number,
    step: number,
    len: number,
  ) => {
    let sum = 0;
    for (let k = -r; k <= r; k++)
      sum += from[base + Math.min(len - 1, Math.max(0, k)) * step]!;
    for (let k = 0; k < len; k++) {
      to[base + k * step] = (sum + r) / size;
      sum +=
        from[base + Math.min(len - 1, k + r + 1) * step]! -
        from[base + Math.max(0, k - r) * step]!;
    }
  };
  for (let y = 0; y < h; y++) line(src, tmp, y * w, 1, w);
  for (let x = 0; x < w; x++) line(tmp, out, x, w, h);
  return out;
}

function otsu(img: Uint8Array) {
  const hist = new Float64Array(256);
  for (const v of img) hist[v]!++;
  let total = 0;
  for (let i = 0; i < 256; i++) total += i * hist[i]!;
  let below = 0,
    belowSum = 0,
    best = 0,
    threshold = 128;
  for (let t = 0; t < 256; t++) {
    below += hist[t]!;
    if (!below || below === img.length) continue;
    belowSum += t * hist[t]!;
    const above = img.length - below,
      m0 = belowSum / below,
      m1 = (total - belowSum) / above;
    const between = below * above * (m0 - m1) ** 2;
    if (between > best) {
      best = between;
      threshold = t + 1;
    }
  }
  return threshold;
}

/** Binary dilation (grow) or erosion with a square window; erosion treats
 * outside the frame as set so pages near the border keep their size. */
function spread(
  mask: Uint8Array,
  w: number,
  h: number,
  r: number,
  grow: boolean,
) {
  const size = 2 * r + 1,
    outside = grow ? 0 : 1,
    tmp = new Uint8Array(mask.length),
    out = new Uint8Array(mask.length);
  const line = (
    from: Uint8Array,
    to: Uint8Array,
    base: number,
    step: number,
    len: number,
  ) => {
    let sum = 0;
    for (let k = -r; k <= r; k++)
      sum += k < 0 || k >= len ? outside : from[base + k * step]!;
    for (let k = 0; k < len; k++) {
      to[base + k * step] = grow ? (sum > 0 ? 1 : 0) : sum === size ? 1 : 0;
      const add = k + r + 1,
        drop = k - r;
      sum +=
        (add >= len ? outside : from[base + add * step]!) -
        (drop < 0 ? outside : from[base + drop * step]!);
    }
  };
  for (let y = 0; y < h; y++) line(mask, tmp, y * w, 1, w);
  for (let x = 0; x < w; x++) line(tmp, out, x, w, h);
  return out;
}
const closeMask = (mask: Uint8Array, w: number, h: number, r: number) =>
  spread(spread(mask, w, h, r, true), w, h, r, false);

function convexHull(points: Point[]) {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const lower: Point[] = [],
    upper: Point[] = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0
    )
      lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0
    )
      upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

type Region = { size: number; hull: Point[]; boundary: Point[] };
/** The largest connected regions of a mask, as convex hulls in pixel-edge coordinates. */
function regions(
  mask: Uint8Array,
  w: number,
  h: number,
  minSize: number,
  limit = 3,
) {
  const seen = new Uint8Array(mask.length),
    stack = new Int32Array(mask.length),
    rowMin = new Int32Array(h).fill(w),
    rowMax = new Int32Array(h).fill(-1),
    colMin = new Int32Array(w).fill(h),
    colMax = new Int32Array(w).fill(-1);
  const found: Region[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let top = 0,
      size = 0,
      yMin = h,
      yMax = -1,
      xMin = w,
      xMax = -1;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const i = stack[--top]!,
        y = (i / w) | 0,
        x = i - y * w;
      size++;
      if (x < rowMin[y]!) rowMin[y] = x;
      if (x > rowMax[y]!) rowMax[y] = x;
      if (y < colMin[x]!) colMin[x] = y;
      if (y > colMax[x]!) colMax[x] = y;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) {
        seen[i - 1] = 1;
        stack[top++] = i - 1;
      }
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) {
        seen[i + 1] = 1;
        stack[top++] = i + 1;
      }
      if (y > 0 && mask[i - w] && !seen[i - w]) {
        seen[i - w] = 1;
        stack[top++] = i - w;
      }
      if (y < h - 1 && mask[i + w] && !seen[i + w]) {
        seen[i + w] = 1;
        stack[top++] = i + w;
      }
    }
    if (size >= minSize) {
      const points: Point[] = [];
      for (let y = yMin; y <= yMax; y++)
        if (rowMax[y]! >= 0)
          points.push(
            { x: rowMin[y]!, y },
            { x: rowMax[y]! + 1, y },
            { x: rowMin[y]!, y: y + 1 },
            { x: rowMax[y]! + 1, y: y + 1 },
          );
      const boundary: Point[] = [];
      for (let y = yMin; y <= yMax; y++)
        if (rowMax[y]! >= 0)
          boundary.push(
            { x: rowMin[y]!, y: y + 0.5 },
            { x: rowMax[y]! + 1, y: y + 0.5 },
          );
      for (let x = xMin; x <= xMax; x++)
        if (colMax[x]! >= 0)
          boundary.push(
            { x: x + 0.5, y: colMin[x]! },
            { x: x + 0.5, y: colMax[x]! + 1 },
          );
      found.push({ size, hull: convexHull(points), boundary });
    }
    for (let y = yMin; y <= yMax; y++) {
      rowMin[y] = w;
      rowMax[y] = -1;
    }
    for (let x = xMin; x <= xMax; x++) {
      colMin[x] = h;
      colMax[x] = -1;
    }
  }
  return found.sort((a, b) => b.size - a.size).slice(0, limit);
}

/** Drop nearly collinear staircase points from a pixel hull. */
function simplifyHull(hull: Point[], tolerance = 1) {
  const pts = [...hull];
  while (pts.length > 4) {
    let best = -1,
      height = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length]!,
        b = pts[i]!,
        c = pts[(i + 1) % pts.length]!;
      const d =
        Math.abs(cross(a, b, c)) /
        Math.max(1e-9, Math.hypot(c.x - a.x, c.y - a.y));
      if (d < height) {
        height = d;
        best = i;
      }
    }
    if (height > tolerance) break;
    pts.splice(best, 1);
  }
  return pts;
}

/** Reduce a convex hull to the four-sided outline that adds the least area:
 * short edges (folded or rounded corners) are removed by extending their
 * neighbours, so corners hidden by a dog-ear are reconstructed. */
function hullToQuad(simplified: Point[]): Point[] | null {
  const pts = [...simplified];
  while (pts.length > 4) {
    const n = pts.length;
    let best = -1,
      cost = Infinity,
      corner: Point | null = null;
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n]!,
        b = pts[i]!,
        c = pts[(i + 1) % n]!,
        d = pts[(i + 2) % n]!;
      const x = intersect(a, b, c, d);
      if (!x) continue;
      if ((x.x - b.x) * (b.x - a.x) + (x.y - b.y) * (b.y - a.y) < 0) continue;
      if ((x.x - c.x) * (c.x - d.x) + (x.y - c.y) * (c.y - d.y) < 0) continue;
      const added = Math.abs(cross(b, x, c)) / 2;
      if (added < cost) {
        cost = added;
        best = i;
        corner = x;
      }
    }
    if (best < 0 || !corner) return null;
    if (best === n - 1) {
      pts.splice(n - 1, 1);
      pts[0] = corner;
    } else pts.splice(best, 2, corner);
  }
  return pts.length === 4 ? pts : null;
}

/** The four longest straight runs of a hull, extended to meet: a finger or
 * object overlapping one side only shortens that run. */
function hullSides(simplified: Point[]): Point[] | null {
  const n = simplified.length;
  if (n < 4) return null;
  const edges = simplified.map((a, i) => {
    const b = simplified[(i + 1) % n]!;
    return {
      a,
      b,
      len: Math.hypot(b.x - a.x, b.y - a.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  });
  const turn = (i: number) => {
    let d = edges[(i + 1) % n]!.angle - edges[i]!.angle;
    while (d <= -Math.PI) d += 2 * Math.PI;
    while (d > Math.PI) d -= 2 * Math.PI;
    return Math.abs(d);
  };
  // Start after the sharpest turn so no run wraps around.
  let start = 0;
  for (let i = 1; i < n; i++) if (turn(i) > turn(start)) start = i;
  const runs: Array<{ a: Point; b: Point; len: number }> = [];
  for (let k = 1; k <= n; k++) {
    const e = edges[(start + k) % n]!;
    const last = runs[runs.length - 1];
    if (last && turn((start + k - 1) % n) < 0.12) {
      last.b = e.b;
      last.len += e.len;
    } else runs.push({ a: e.a, b: e.b, len: e.len });
  }
  if (runs.length < 4) return null;
  const keep = new Set(
    runs
      .map((r, i) => [r.len, i] as const)
      .sort((a, b) => b[0] - a[0])
      .slice(0, 4)
      .map(([, i]) => i),
  );
  const sides = runs.filter((_, i) => keep.has(i));
  const corners: Point[] = [];
  for (let k = 0; k < 4; k++) {
    const p = sides[(k + 3) % 4]!,
      q = sides[k]!;
    const x = intersect(p.a, p.b, q.a, q.b);
    if (!x) return null;
    corners.push(x);
  }
  return corners;
}

/** Re-fit each side to the straight part of the region's outline (RANSAC),
 * so a finger, a fold or an object touching the page only adds outliers. */
function fitSides(q: Quad, boundary: Point[]): Quad | null {
  const lines: Array<[Point, Point]> = [];
  let seed = 1;
  const rand = (n: number) =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  for (let k = 0; k < 4; k++) {
    const { a, len, dir } = outwardNormal(q, k);
    const band = Math.max(6, len * 0.12);
    const near = boundary.filter((p) => {
      const t = (p.x - a.x) * dir.x + (p.y - a.y) * dir.y;
      return (
        t > -len * 0.05 &&
        t < len * 1.05 &&
        Math.abs((p.x - a.x) * dir.y - (p.y - a.y) * dir.x) < band
      );
    });
    if (near.length < 10) return null;
    let best: Point[] = [];
    for (let iter = 0; iter < 60; iter++) {
      const p = near[rand(near.length)]!,
        r = near[rand(near.length)]!,
        l = Math.hypot(r.x - p.x, r.y - p.y);
      if (l < len * 0.2) continue;
      const dx = (r.x - p.x) / l,
        dy = (r.y - p.y) / l;
      // Keep roughly the original direction.
      if (Math.abs(dx * dir.x + dy * dir.y) < 0.95) continue;
      const inliers = near.filter(
        (s) => Math.abs((s.x - p.x) * dy - (s.y - p.y) * dx) < 1.5,
      );
      if (inliers.length > best.length) best = inliers;
    }
    if (best.length < Math.max(10, near.length * 0.3)) return null;
    const line = fitLine(best);
    if (!line) return null;
    lines.push(line);
  }
  const corners: Point[] = [];
  for (let k = 0; k < 4; k++) {
    const p = lines[(k + 3) % 4]!,
      r = lines[k]!;
    const x = intersect(p[0], p[1], r[0], r[1]);
    if (!x) return null;
    corners.push(x);
  }
  return corners as Quad;
}

/** Clockwise from the top-left corner. */
function orderQuad(points: Point[]): Quad {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length,
    cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const sorted = [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  let first = 0;
  sorted.forEach((p, i) => {
    if (p.x + p.y < sorted[first]!.x + sorted[first]!.y) first = i;
  });
  return [0, 1, 2, 3].map((k) => sorted[(first + k) % 4]!) as Quad;
}

function plausible(q: Quad, w: number, h: number) {
  const side = Math.min(w, h) * 0.15;
  for (let k = 0; k < 4; k++) {
    const a = q[(k + 3) % 4]!,
      b = q[k]!,
      c = q[(k + 1) % 4]!;
    if (cross(a, b, c) <= 0) return false;
    const angle = Math.acos(
      ((a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y)) /
        (Math.hypot(a.x - b.x, a.y - b.y) * Math.hypot(c.x - b.x, c.y - b.y)),
    );
    if (angle < 0.6 || angle > 2.55) return false;
    if (Math.hypot(c.x - b.x, c.y - b.y) < side) return false;
  }
  return true;
}

type Sampler = (x: number, y: number) => number;
/** Bilinear sampling of a one-channel image in pixel-edge coordinates. */
function sampler(img: Uint8Array, w: number, h: number): Sampler {
  return (x, y) => {
    const fx = Math.min(w - 1.001, Math.max(0, x - 0.5)),
      fy = Math.min(h - 1.001, Math.max(0, y - 0.5));
    const ix = fx | 0,
      iy = fy | 0,
      tx = fx - ix,
      ty = fy - iy,
      i = iy * w + ix;
    return (
      (img[i]! * (1 - tx) + img[i + 1]! * tx) * (1 - ty) +
      (img[i + w]! * (1 - tx) + img[i + w + 1]! * tx) * ty
    );
  };
}
/** Brightness sampler over RGBA pixels, for full-resolution refinement. */
function rgbaSampler({ data, width: w, height: h }: Pixels): Sampler {
  const luma = (i: number) =>
    data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
  return (x, y) => {
    const fx = Math.min(w - 1.001, Math.max(0, x - 0.5)),
      fy = Math.min(h - 1.001, Math.max(0, y - 0.5));
    const ix = fx | 0,
      iy = fy | 0,
      tx = fx - ix,
      ty = fy - iy,
      i = (iy * w + ix) * 4;
    return (
      (luma(i) * (1 - tx) + luma(i + 4) * tx) * (1 - ty) +
      (luma(i + w * 4) * (1 - tx) + luma(i + w * 4 + 4) * tx) * ty
    );
  };
}

function outwardNormal(q: Quad, k: number) {
  const a = q[k]!,
    b = q[(k + 1) % 4]!,
    len = Math.hypot(b.x - a.x, b.y - a.y),
    dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
    cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  let n = { x: dir.y, y: -dir.x };
  if (n.x * ((a.x + b.x) / 2 - cx) + n.y * ((a.y + b.y) / 2 - cy) < 0)
    n = { x: -n.x, y: -n.y };
  return { a, b, len, dir, n };
}

/** How much of the outline sits on a visible edge, and how strong it is. */
function edgeSupport(channels: Sampler[], q: Quad) {
  let total = 0,
    contrast = 0,
    consistent = 0;
  for (let k = 0; k < 4; k++) {
    const { a, b, n } = outwardNormal(q, k);
    let sideBrighter = 0,
      sideDarker = 0;
    for (let s = 0; s < 20; s++) {
      const t = 0.1 + (0.8 * s) / 19,
        px = a.x + (b.x - a.x) * t,
        py = a.y + (b.y - a.y) * t;
      // Contrast relative to brightness (×255), so shadowed edges still count.
      let best = 0,
        sign = 0;
      for (const at of channels)
        for (let d = -2; d <= 2; d++) {
          const inner = at(px + n.x * (d - 2.5), py + n.y * (d - 2.5)),
            outer = at(px + n.x * (d + 2.5), py + n.y * (d + 2.5));
          const c =
            (Math.abs(inner - outer) * 255) / (Math.max(inner, outer) + 24);
          if (c > best) {
            best = c;
            sign = inner > outer ? 1 : -1;
          }
        }
      total++;
      if (best >= 14) {
        if (sign > 0) sideBrighter++;
        else sideDarker++;
      }
      contrast += Math.min(best, 80);
    }
    // A real page edge keeps the same light/dark direction along a side;
    // a line through printed text does not.
    consistent += Math.max(sideBrighter, sideDarker);
  }
  return { fraction: consistent / total, contrast: contrast / total };
}

/** Snap each side of an approximate outline to the strongest consistent edge
 * within `radius` pixels, fitting a straight line through the edge points. */
export function refineQuad(
  at: Sampler,
  q: Quad,
  radius: number,
  limit = radius * 2.5,
): Quad {
  const steps = Math.max(2, Math.ceil(radius));
  const lines: Array<[Point, Point]> = [];
  for (let k = 0; k < 4; k++) {
    const { a, b, dir, n } = outwardNormal(q, k);
    const peaks: Array<{
      x: number;
      y: number;
      up: number;
      upAt: number;
      down: number;
      downAt: number;
    }> = [];
    const f = new Float64Array(2 * steps + 3),
      g = new Float64Array(2 * steps + 1);
    for (let s = 0; s < 40; s++) {
      const t = 0.07 + (0.86 * s) / 39,
        x = a.x + (b.x - a.x) * t,
        y = a.y + (b.y - a.y) * t;
      for (let j = -steps - 1; j <= steps + 1; j++) {
        const sx = x + n.x * j,
          sy = y + n.y * j;
        f[j + steps + 1] =
          (at(sx - dir.x, sy - dir.y) +
            at(sx, sy) +
            at(sx + dir.x, sy + dir.y)) /
          3;
      }
      let up = 0,
        upAt = 0,
        down = 0,
        downAt = 0;
      for (let j = -steps; j <= steps; j++) {
        const v = f[j + steps + 2]! - f[j + steps]!;
        g[j + steps] = v;
        // Paper is usually brighter inside (down = brightness falls going outward).
        if (-v > down) {
          down = -v;
          downAt = j;
        }
        if (v > up) {
          up = v;
          upAt = j;
        }
      }
      // Sub-pixel peak by fitting a parabola.
      const refine = (j: number, sign: number) => {
        if (j <= -steps || j >= steps) return j;
        const l = sign * g[j + steps - 1]!,
          c = sign * g[j + steps]!,
          r = sign * g[j + steps + 1]!,
          den = l - 2 * c + r;
        return den < 0
          ? j + Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / den))
          : j;
      };
      peaks.push({
        x,
        y,
        up,
        upAt: refine(upAt, 1),
        down,
        downAt: refine(downAt, -1),
      });
    }
    const downTotal = peaks.reduce((s, p) => s + p.down, 0),
      upTotal = peaks.reduce((s, p) => s + p.up, 0);
    const falling = downTotal >= upTotal;
    const points = peaks
      .filter((p) => (falling ? p.down : p.up) >= 6)
      .map((p) => {
        const d = falling ? p.downAt : p.upAt;
        return { x: p.x + n.x * d, y: p.y + n.y * d };
      });
    const line = fitLine(points);
    lines.push(line ?? [a, b]);
  }
  const corners: Point[] = [];
  for (let k = 0; k < 4; k++) {
    const prev = lines[(k + 3) % 4]!,
      next = lines[k]!;
    const p = intersect(prev[0], prev[1], next[0], next[1]);
    if (!p || Math.hypot(p.x - q[k]!.x, p.y - q[k]!.y) > limit) return q;
    corners.push(p);
  }
  return corners as Quad;
}

/** Total-least-squares line through edge points, ignoring outliers. */
function fitLine(points: Point[]): [Point, Point] | null {
  let pts = points;
  for (let round = 0; round < 3 && pts.length >= 8; round++) {
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length,
      my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    let sxx = 0,
      sxy = 0,
      syy = 0;
    for (const p of pts) {
      sxx += (p.x - mx) ** 2;
      sxy += (p.x - mx) * (p.y - my);
      syy += (p.y - my) ** 2;
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy),
      dx = Math.cos(angle),
      dy = Math.sin(angle);
    const distance = (p: Point) => Math.abs((p.x - mx) * dy - (p.y - my) * dx);
    const sorted = pts.map(distance).sort((a, b) => a - b);
    const cut = Math.max(0.75, sorted[Math.floor(sorted.length / 2)]! * 2.5);
    const kept = pts.filter((p) => distance(p) <= cut);
    if (kept.length === pts.length || kept.length < 8 || round === 2)
      return [
        { x: mx, y: my },
        { x: mx + dx, y: my + dy },
      ];
    pts = kept;
  }
  return null;
}

/** Inside a convex quad shrunk towards its centre. */
function interiorTest(q: Quad, inset: number) {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
    cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const s = q.map((p) => ({
    x: cx + (p.x - cx) * (1 - inset),
    y: cy + (p.y - cy) * (1 - inset),
  }));
  return (x: number, y: number) =>
    s.every((a, k) => cross(a, s[(k + 1) % 4]!, { x, y }) >= 0);
}

function sharpnessIn(luma: Uint8Array, w: number, h: number, q: Quad) {
  const inside = interiorTest(q, 0.12);
  const x0 = Math.max(1, Math.floor(Math.min(...q.map((p) => p.x)))),
    x1 = Math.min(w - 2, Math.ceil(Math.max(...q.map((p) => p.x)))),
    y0 = Math.max(1, Math.floor(Math.min(...q.map((p) => p.y)))),
    y1 = Math.min(h - 2, Math.ceil(Math.max(...q.map((p) => p.y))));
  let sum = 0,
    count = 0;
  for (let y = y0; y <= y1; y += 2)
    for (let x = x0; x <= x1; x += 2) {
      if (!inside(x + 0.5, y + 0.5)) continue;
      const i = y * w + x;
      const lap =
        luma[i - 1]! +
        luma[i + 1]! +
        luma[i - w]! +
        luma[i + w]! -
        4 * luma[i]!;
      sum += lap * lap;
      count++;
    }
  return sum / Math.max(1, count);
}

/** Regions bounded by a closed outline of edges: finds pages on light surfaces
 * where brightness alone cannot separate paper from the table. Edges are
 * measured relative to local brightness, so a shadow does not hide them. */
function enclosed(
  images: Uint8Array[],
  chroma: Uint8Array,
  w: number,
  h: number,
  r: number,
) {
  const n = w * h,
    magnitudes = new Uint16Array(n);
  const sobel = (img: Uint8Array, i: number) =>
    Math.abs(
      img[i - w + 1]! +
        2 * img[i + 1]! +
        img[i + w + 1]! -
        img[i - w - 1]! -
        2 * img[i - 1]! -
        img[i + w - 1]!,
    ) +
    Math.abs(
      img[i + w - 1]! +
        2 * img[i + w]! +
        img[i + w + 1]! -
        img[i - w - 1]! -
        2 * img[i - w]! -
        img[i - w + 1]!,
    );
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      // Scaled so a 10% brightness step on paper scores about 64.
      let m = (sobel(chroma, i) * 2.4) | 0;
      for (const img of images)
        m = Math.max(m, ((sobel(img, i) * 240) / (img[i]! + 24)) | 0);
      magnitudes[i] = m;
    }
  const sorted = Uint16Array.from(magnitudes).sort();
  const threshold = Math.max(40, sorted[Math.floor(n * 0.6)]! * 2.2);
  const edges = new Uint8Array(n);
  for (let i = 0; i < n; i++) edges[i] = magnitudes[i]! >= threshold ? 1 : 0;
  const walls = spread(edges, w, h, r, true);
  // Flood the background in from the frame border.
  const outside = new Uint8Array(n),
    stack = new Int32Array(n);
  let top = 0;
  const push = (i: number) => {
    if (!walls[i] && !outside[i]) {
      outside[i] = 1;
      stack[top++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (top) {
    const i = stack[--top]!,
      x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < n - w) push(i + w);
  }
  // Everything the background could not reach (the page with its print), and
  // open areas kept apart by their walls (a page beside other enclosed objects).
  const solid = new Uint8Array(n),
    open = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    solid[i] = outside[i] ? 0 : 1;
    open[i] = outside[i] || walls[i] ? 0 : 1;
  }
  return [
    spread(solid, w, h, r, false),
    spread(open, w, h, r + 1, true),
  ] as const;
}

/** Share of an outline's edge that must show a consistent paper edge. */
const MIN_SUPPORT = 0.65;

export function detectPage(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): PageDetection {
  const w = width,
    h = height,
    n = w * h;
  const luma = new Uint8Array(n),
    low = new Uint8Array(n),
    chroma = new Uint8Array(n);
  let brightness = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i * 4]!,
      g = data[i * 4 + 1]!,
      b = data[i * 4 + 2]!;
    luma[i] = (r * 77 + g * 150 + b * 29) >> 8;
    low[i] = Math.min(r, g, b);
    chroma[i] = Math.max(r, g, b) - low[i]!;
    brightness += luma[i]!;
  }
  brightness /= n;
  const smooth = boxBlur(luma, w, h, 1),
    smoothLow = boxBlur(low, w, h, 1),
    smoothChroma = boxBlur(chroma, w, h, 1);
  const channels = [
    sampler(smooth, w, h),
    sampler(smoothLow, w, h),
    sampler(smoothChroma, w, h),
  ];
  const r = Math.max(1, Math.round(Math.max(w, h) / 180));
  let best: { quad: Quad; score: number } | null = null,
    clipped = false;
  const consider = (mask: Uint8Array, close = true) => {
    for (const region of regions(
      close ? closeMask(mask, w, h, r) : mask,
      w,
      h,
      n * 0.1,
    )) {
      const simplified = simplifyHull(region.hull);
      const outlines = [hullSides(simplified), hullToQuad(simplified)]
        .filter((p): p is Point[] => !!p)
        .map(orderQuad);
      for (const outline of [...outlines]) {
        const fitted = fitSides(outline, region.boundary);
        if (fitted) outlines.push(orderQuad(fitted));
      }
      for (const quad of outlines) {
        const area = polygonArea(quad);
        if (area < n * 0.1 || area > n * 0.985 || !plausible(quad, w, h))
          continue;
        if (
          polygonArea(region.hull) / area < 0.8 ||
          region.size / area < (close ? 0.45 : 0.2)
        )
          continue;
        const support = edgeSupport(channels, quad);
        if (support.fraction < MIN_SUPPORT) continue;
        if (
          quad.some(
            (p) => p.x < 1.5 || p.y < 1.5 || p.x > w - 1.5 || p.y > h - 1.5,
          )
        ) {
          clipped = true;
          continue;
        }
        const score =
          support.fraction +
          0.5 * Math.min(1, support.contrast / 40) +
          0.4 * (area / n);
        if (!best || score > best.score) best = { quad, score };
      }
    }
  };
  const split = (img: Uint8Array, t: number, above: boolean) => {
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = img[i]! >= t === above ? 1 : 0;
    return mask;
  };
  const t = otsu(smooth),
    tLow = otsu(smoothLow);
  for (const d of [0, -12, 12]) consider(split(smooth, t + d, true));
  consider(split(smoothLow, tLow, true));
  // Coloured paper on a white table is darker in its weakest channel.
  consider(split(smoothLow, tLow, false));
  for (const mask of enclosed([smooth, smoothLow], smoothChroma, w, h, r))
    consider(mask, false);
  const found = best as { quad: Quad; score: number } | null;
  if (!found) return { brightness, quad: null, sharpness: 0, clipped };
  let quad = refineQuad(sampler(luma, w, h), found.quad, r + 2);
  if (
    !plausible(quad, w, h) ||
    quad.some((p) => p.x < 0 || p.y < 0 || p.x > w || p.y > h)
  )
    quad = found.quad;
  return {
    brightness,
    quad: quad.map((p) => ({ x: p.x / w, y: p.y / h })) as Quad,
    sharpness: sharpnessIn(luma, w, h, quad),
    clipped: false,
  };
}

/** Largest corner movement between two outlines, in frame fractions. */
export function cornerShift(a: Quad | null, b: Quad) {
  return a
    ? Math.max(...a.map((p, i) => Math.hypot(p.x - b[i]!.x, p.y - b[i]!.y)))
    : Infinity;
}
export function averageQuad(quads: Quad[]): Quad {
  return [0, 1, 2, 3].map((k) => ({
    x: quads.reduce((s, q) => s + q[k]!.x, 0) / quads.length,
    y: quads.reduce((s, q) => s + q[k]!.y, 0) / quads.length,
  })) as Quad;
}

// Projective map from a unit square into the detected quadrilateral.
function projection(quad: Quad) {
  const [a, b, c, d] = quad;
  const dx = a.x - b.x + c.x - d.x,
    dy = a.y - b.y + c.y - d.y;
  const den = (b.x - c.x) * (d.y - c.y) - (d.x - c.x) * (b.y - c.y);
  const g =
    Math.abs(den) < 1e-8 ? 0 : (dx * (d.y - c.y) - (d.x - c.x) * dy) / den;
  const h =
    Math.abs(den) < 1e-8 ? 0 : ((b.x - c.x) * dy - dx * (b.y - c.y)) / den;
  return [
    b.x - a.x + g * b.x,
    d.x - a.x + h * d.x,
    a.x,
    b.y - a.y + g * b.y,
    d.y - a.y + h * d.y,
    a.y,
    g,
    h,
  ] as const;
}
export function project(quad: Quad, u: number, v: number): Point {
  const [A, B, C, D, E, F, G, H] = projection(quad);
  const z = G * u + H * v + 1;
  return { x: (A * u + B * v + C) / z, y: (D * u + E * v + F) / z };
}

/** Refine a preview outline against the full-resolution frame. */
export function locatePage(frame: Pixels, quad: Quad): Quad {
  const at = rgbaSampler(frame),
    { width: w, height: h } = frame;
  const px = quad.map((p) => ({ x: p.x * w, y: p.y * h })) as Quad;
  // Preview frames are ~400 px across, so their corners can be several pixels off here.
  const coarse = Math.max(4, (Math.max(w, h) / 400) * 2 + 3);
  let refined = refineQuad(at, px, coarse);
  refined = refineQuad(at, refined, 4, 6);
  if (!plausible(refined, w, h)) refined = px;
  return refined.map((p) => ({
    x: Math.min(1, Math.max(0, p.x / w)),
    y: Math.min(1, Math.max(0, p.y / h)),
  })) as Quad;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Flatten the page to a rectangle and even out shadows. */
export async function rectifyPage(
  frame: Pixels,
  quad: Quad,
  maxSide = 2400,
): Promise<Pixels> {
  const { width: sw, height: sh, data: src } = frame;
  const q = quad.map((p) => ({ x: p.x * sw, y: p.y * sh })) as Quad;
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  let width = Math.max(distance(q[0], q[1]), distance(q[3], q[2])),
    height = Math.max(distance(q[0], q[3]), distance(q[1], q[2]));
  const scale = Math.min(1, maxSide / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  const out = new Uint8ClampedArray(width * height * 4);
  const [A, B, C, D, E, F, G, H] = projection(q);
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width,
        z = G * u + H * v + 1;
      const fx = Math.min(
          sw - 1.001,
          Math.max(0, (A * u + B * v + C) / z - 0.5),
        ),
        fy = Math.min(sh - 1.001, Math.max(0, (D * u + E * v + F) / z - 0.5));
      const ix = fx | 0,
        iy = fy | 0,
        tx = fx - ix,
        ty = fy - iy;
      const i = (iy * sw + ix) * 4,
        j = i + sw * 4,
        o = (y * width + x) * 4;
      const w00 = (1 - tx) * (1 - ty),
        w10 = tx * (1 - ty),
        w01 = (1 - tx) * ty,
        w11 = tx * ty;
      out[o] =
        src[i]! * w00 + src[i + 4]! * w10 + src[j]! * w01 + src[j + 4]! * w11;
      out[o + 1] =
        src[i + 1]! * w00 +
        src[i + 5]! * w10 +
        src[j + 1]! * w01 +
        src[j + 5]! * w11;
      out[o + 2] =
        src[i + 2]! * w00 +
        src[i + 6]! * w10 +
        src[j + 2]! * w01 +
        src[j + 6]! * w11;
      out[o + 3] = 255;
    }
    if (y % 256 === 255) await pause();
  }
  const page = { data: out, width, height };
  evenLighting(page);
  return page;
}

/** Divide out uneven light (hand and phone shadows, a dim cab) using the local
 * paper brightness, keeping coloured paper and faint marks. */
export function evenLighting({ data, width: w, height: h }: Pixels) {
  const block = Math.max(12, Math.round(Math.max(w, h) / 40)),
    gw = Math.ceil(w / block),
    gh = Math.ceil(h / block);
  const hist = new Uint32Array(gw * gh * 32),
    counts = new Uint32Array(gw * gh);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4,
        cell = ((y / block) | 0) * gw + ((x / block) | 0);
      hist[
        cell * 32 +
          ((data[i]! * 77 + data[i + 1]! * 150 + data[i + 2]! * 29) >> 11)
      ]!++;
      counts[cell]!++;
    }
  // Paper level per block: the 90th percentile brightness.
  const level = new Float32Array(gw * gh);
  for (let c = 0; c < level.length; c++) {
    let seen = 0;
    const goal = counts[c]! * 0.9;
    for (let b = 0; b < 32; b++) {
      seen += hist[c * 32 + b]!;
      if (seen >= goal) {
        level[c] = b * 8 + 4;
        break;
      }
    }
  }
  // Blocks covered by a logo or table borrow the brightest neighbour, then smooth.
  const grown = new Float32Array(level.length),
    paper = new Float32Array(level.length);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy,
            xx = x + dx;
          if (yy >= 0 && yy < gh && xx >= 0 && xx < gw)
            m = Math.max(m, level[yy * gw + xx]!);
        }
      grown[y * gw + x] = m;
    }
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      let s = 0,
        k = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy,
            xx = x + dx;
          if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) {
            s += grown[yy * gw + xx]!;
            k++;
          }
        }
      paper[y * gw + x] = s / k;
    }
  for (let y = 0; y < h; y++) {
    const gy = Math.min(gh - 1, Math.max(0, (y + 0.5) / block - 0.5)),
      y0 = gy | 0,
      y1 = Math.min(gh - 1, y0 + 1),
      ty = gy - y0;
    for (let x = 0; x < w; x++) {
      const gx = Math.min(gw - 1, Math.max(0, (x + 0.5) / block - 0.5)),
        x0 = gx | 0,
        x1 = Math.min(gw - 1, x0 + 1),
        tx = gx - x0;
      const bg =
        (paper[y0 * gw + x0]! * (1 - tx) + paper[y0 * gw + x1]! * tx) *
          (1 - ty) +
        (paper[y1 * gw + x0]! * (1 - tx) + paper[y1 * gw + x1]! * tx) * ty;
      const gain = Math.min(2.6, Math.max(0.95, 240 / Math.max(40, bg)));
      const i = (y * w + x) * 4;
      for (let k = 0; k < 3; k++)
        data[i + k] = (data[i + k]! * gain - 12) * 1.05;
    }
  }
}

/** The current camera frame, at most `maxSide` pixels across. */
export function grabFrame(video: HTMLVideoElement, maxSide = 2600): Pixels {
  const scale = Math.min(
    1,
    maxSide / Math.max(video.videoWidth, video.videoHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Pixels as a JPEG data URL, optionally downscaled for on-screen previews. */
export function toJpeg(pixels: Pixels, quality = 0.92, maxSide = Infinity) {
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  canvas
    .getContext("2d")!
    .putImageData(
      new ImageData(
        pixels.data as Uint8ClampedArray<ArrayBuffer>,
        pixels.width,
        pixels.height,
      ),
      0,
      0,
    );
  const scale = Math.min(1, maxSide / Math.max(pixels.width, pixels.height));
  if (scale === 1) return canvas.toDataURL("image/jpeg", quality);
  const small = document.createElement("canvas");
  small.width = Math.round(pixels.width * scale);
  small.height = Math.round(pixels.height * scale);
  small.getContext("2d")!.drawImage(canvas, 0, 0, small.width, small.height);
  return small.toDataURL("image/jpeg", quality);
}

export async function scanPdf(pages: string[]) {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  for (const image of pages) {
    const jpg = await pdf.embedJpg(image);
    const w = 612,
      h = (w * jpg.height) / jpg.width;
    const page = pdf.addPage([w, h]);
    page.drawImage(jpg, { x: 0, y: 0, width: w, height: h });
  }
  const bytes = await pdf.save();
  if (bytes.length > 49 * 1024 * 1024)
    throw Error("This scan is too large. Save fewer pages in one PDF.");
  return new File([new Uint8Array(bytes)], "Packing slip.pdf", {
    type: "application/pdf",
  });
}

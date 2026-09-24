/**
 * Turns a per-pixel room label map into room outlines: for each label, the
 * largest 4-connected area's outer boundary is traced along pixel edges and
 * simplified (Douglas–Peucker). Holes are ignored; outlines are closed rings
 * in pixel coordinates.
 */
export type PixelPoint = { x: number; y: number };

type Box = { x0: number; y0: number; x1: number; y1: number };

function boxes(labels: Int32Array, width: number) {
  const out = new Map<number, Box>();
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]!;
    if (label <= 0) continue;
    const x = i % width;
    const y = (i - x) / width;
    const box = out.get(label);
    if (!box) out.set(label, { x0: x, y0: y, x1: x, y1: y });
    else {
      if (x < box.x0) box.x0 = x;
      if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y;
      if (y > box.y1) box.y1 = y;
    }
  }
  return out;
}

/** Largest 4-connected area of `label` inside `box`, as a local bitmap. */
function largestArea(labels: Int32Array, width: number, label: number, box: Box) {
  const w = box.x1 - box.x0 + 1;
  const h = box.y1 - box.y0 + 1;
  const seen = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let best = 0;
  let bestSize = 0;
  let next = 1;
  for (let start = 0; start < w * h; start++) {
    if (seen[start]) continue;
    const sx = start % w;
    const sy = (start - sx) / w;
    if (labels[(sy + box.y0) * width + sx + box.x0] !== label) continue;
    let top = 0;
    let size = 0;
    stack[top++] = start;
    seen[start] = next;
    while (top) {
      const p = stack[--top]!;
      size++;
      const x = p % w;
      const y = (p - x) / w;
      const visit = (q: number, qx: number, qy: number) => {
        if (!seen[q] && labels[(qy + box.y0) * width + qx + box.x0] === label) {
          seen[q] = next;
          stack[top++] = q;
        }
      };
      if (x > 0) visit(p - 1, x - 1, y);
      if (x < w - 1) visit(p + 1, x + 1, y);
      if (y > 0) visit(p - w, x, y - 1);
      if (y < h - 1) visit(p + w, x, y + 1);
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
    next++;
  }
  const inside = new Uint8Array(w * h);
  for (let i = 0; i < inside.length; i++) inside[i] = seen[i] === best ? 1 : 0;
  return { inside, w, h, size: bestSize };
}

// Directions: 0 right, 1 down, 2 left, 3 up (image y grows downwards).
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/**
 * Outer boundary of a 4-connected bitmap, walked clockwise with the region
 * on the right, as the corners where the direction changes.
 */
export function traceOuterBoundary(inside: Uint8Array, w: number, h: number): PixelPoint[] {
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h ? inside[y * w + x]! : 0;
  let startIndex = -1;
  for (let i = 0; i < inside.length; i++) {
    if (inside[i]) {
      startIndex = i;
      break;
    }
  }
  if (startIndex < 0) return [];
  const sx = startIndex % w;
  const sy = (startIndex - sx) / w;
  let cx = sx;
  let cy = sy;
  let dir = 0;
  const corners: PixelPoint[] = [{ x: sx, y: sy }];
  const limit = 4 * (w + 1) * (h + 1);
  for (let step = 0; step < limit; step++) {
    cx += DX[dir]!;
    cy += DY[dir]!;
    if (cx === sx && cy === sy && dir === 3) break;
    // Pixels ahead of the corner, to the right and left of travel.
    const [ar, al] =
      dir === 0
        ? [at(cx, cy), at(cx, cy - 1)]
        : dir === 1
          ? [at(cx - 1, cy), at(cx, cy)]
          : dir === 2
            ? [at(cx - 1, cy - 1), at(cx - 1, cy)]
            : [at(cx, cy - 1), at(cx - 1, cy - 1)];
    let next = dir;
    if (!ar) next = (dir + 1) % 4;
    else if (al) next = (dir + 3) % 4;
    if (next !== dir) corners.push({ x: cx, y: cy });
    dir = next;
  }
  return corners;
}

function perpendicularDistance(p: PixelPoint, a: PixelPoint, b: PixelPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!length) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / length;
}

export function simplifyPath(points: PixelPoint[], epsilon: number): PixelPoint[] {
  if (points.length < 3) return points;
  let index = 0;
  let max = 0;
  const last = points.length - 1;
  for (let i = 1; i < last; i++) {
    const d = perpendicularDistance(points[i]!, points[0]!, points[last]!);
    if (d > max) {
      max = d;
      index = i;
    }
  }
  if (max <= epsilon) return [points[0]!, points[last]!];
  return [
    ...simplifyPath(points.slice(0, index + 1), epsilon).slice(0, -1),
    ...simplifyPath(points.slice(index), epsilon),
  ];
}

/** Closed-ring simplification: split at the point farthest from the start. */
function simplifyRing(ring: PixelPoint[], epsilon: number) {
  if (ring.length <= 4) return ring;
  let far = 0;
  let farDistance = 0;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i]!.x - ring[0]!.x, ring[i]!.y - ring[0]!.y);
    if (d > farDistance) {
      farDistance = d;
      far = i;
    }
  }
  const first = simplifyPath(ring.slice(0, far + 1), epsilon);
  const second = simplifyPath([...ring.slice(far), ring[0]!], epsilon);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

export type LabelOutline = { label: number; points: PixelPoint[]; areaPx: number };

/** One simplified outline per label (largest connected area only). */
export function labelOutlines(
  labels: Int32Array,
  width: number,
  options: { epsilon: number; minAreaPx: number },
): LabelOutline[] {
  const outlines: LabelOutline[] = [];
  for (const [label, box] of boxes(labels, width)) {
    const area = largestArea(labels, width, label, box);
    if (area.size < options.minAreaPx) continue;
    const ring = traceOuterBoundary(area.inside, area.w, area.h).map((p) => ({
      x: p.x + box.x0,
      y: p.y + box.y0,
    }));
    const points = simplifyRing(ring, options.epsilon);
    if (points.length >= 3) outlines.push({ label, points, areaPx: area.size });
  }
  return outlines.sort((a, b) => a.label - b.label);
}

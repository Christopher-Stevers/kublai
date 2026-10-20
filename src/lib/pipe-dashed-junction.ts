import type { PipeSegment } from "./pipe-system";
import type { SheetPoint } from "./sheet-measure";

/** Same ink style is corroboration, not a drawing-specific layer convention. */
export function samePipeInk(a: PipeSegment, b: PipeSegment) {
  return (
    a.layer === b.layer &&
    a.stroke === b.stroke &&
    Math.abs(a.width - b.width) <=
      Math.max(1e-7, Math.min(a.width, b.width) * 0.1) &&
    a.dash.length === b.dash.length &&
    a.dash.every((v, i) => Math.abs(v - b.dash[i]!) < 1e-7)
  );
}

/** Recognize a locally repeated dashed run, without adding geometry to the
 * measured selection. Require two comparable gaps and ink on both sides of the
 * branch. A lone break, crossing, or nearby parallel pipe is not enough. */
export function dashedRunAt(
  point: SheetPoint,
  branch: PipeSegment,
  nearby: PipeSegment[],
  aspect: number,
  tolerance: number,
): { x: number; y: number } | null {
  const bx = branch.x2 - branch.x1,
    by = (branch.y2 - branch.y1) * aspect;
  const bl = Math.hypot(bx, by);
  if (bl < tolerance * 4) return null;
  const possible = nearby.filter((s) => samePipeInk(branch, s));
  const tried: { x: number; y: number }[] = [];
  let answer: { x: number; y: number } | null = null;
  for (const seed of possible) {
    const dx = seed.x2 - seed.x1,
      dy = (seed.y2 - seed.y1) * aspect;
    const length = Math.hypot(dx, dy);
    if (length < tolerance * 2) continue;
    const ray = { x: dx / length, y: dy / length };
    if (Math.abs((ray.x * bx + ray.y * by) / bl) > 0.95) continue;
    if (tried.some((r) => Math.abs(r.x * ray.x + r.y * ray.y) > 0.995))
      continue;
    tried.push(ray);
    if (tried.length > 8) return null;
    const intervals: [number, number][] = [];
    for (const s of possible) {
      const ax = s.x1 - point.x,
        ay = (s.y1 - point.y) * aspect;
      const zx = s.x2 - point.x,
        zy = (s.y2 - point.y) * aspect;
      const sl = Math.hypot(zx - ax, zy - ay);
      if (
        sl < tolerance * 2 ||
        Math.abs(((zx - ax) * ray.x + (zy - ay) * ray.y) / sl) < 0.995 ||
        Math.abs(ax * ray.y - ay * ray.x) > tolerance ||
        Math.abs(zx * ray.y - zy * ray.x) > tolerance
      )
        continue;
      const a = ax * ray.x + ay * ray.y,
        b = zx * ray.x + zy * ray.y;
      intervals.push([Math.min(a, b), Math.max(a, b)]);
    }
    intervals.sort((a, b) => a[0] - b[0]);
    const runs: [number, number][] = [];
    for (const interval of intervals) {
      const last = runs.at(-1);
      if (last && interval[0] - last[1] <= tolerance)
        last[1] = Math.max(last[1], interval[1]);
      else runs.push([...interval]);
    }
    if (
      runs.length < 3 ||
      runs[0]![0] >= -tolerance ||
      runs.at(-1)![1] <= tolerance
    )
      continue;
    const gaps = runs.slice(1).map((run, i) => ({
      left: runs[i]![1],
      right: run[0],
      width: run[0] - runs[i]![1],
    }));
    const closest = [...gaps].sort(
      (a, b) =>
        Math.min(Math.abs(a.left), Math.abs(a.right)) -
        Math.min(Math.abs(b.left), Math.abs(b.right)),
    )[0]!;
    // The branch must be at or near a dash gap, not arbitrarily somewhere along
    // a distant line. Require repeated spacing, not merely two disconnected ends.
    if (
      closest.width > 0.003 ||
      Math.min(Math.abs(closest.left), Math.abs(closest.right)) >
        closest.width * 1.5 ||
      !gaps.some(
        (g) =>
          g !== closest &&
          g.width / closest.width > 0.7 &&
          g.width / closest.width < 1.3,
      )
    )
      continue;
    if (answer && Math.abs(answer.x * ray.x + answer.y * ray.y) < 0.995)
      return null;
    answer = ray;
  }
  return answer;
}

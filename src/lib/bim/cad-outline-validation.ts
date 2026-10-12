import type { Point3 } from "./types";

/** Reject crossings, non-adjacent touching edges, and collinear overlaps. */
export function assertSimpleOutline(vertices: Point3[], close = false) {
  const eps = 1e-8;
  const points = [...vertices];
  const same = (a: Point3, b: Point3) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]) < eps;
  if (close && points.length && !same(points[0]!, points.at(-1)!))
    points.push(points[0]!);
  const turn = (a: Point3, b: Point3, c: Point3) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const on = (a: Point3, b: Point3, p: Point3) =>
    Math.abs(turn(a, b, p)) < eps &&
    p[0] >= Math.min(a[0], b[0]) - eps &&
    p[0] <= Math.max(a[0], b[0]) + eps &&
    p[1] >= Math.min(a[1], b[1]) - eps &&
    p[1] <= Math.max(a[1], b[1]) + eps;
  const error = () => {
    throw Error(
      "The outline crosses or doubles back on itself. Repair the vertices or use a smaller distance.",
    );
  };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!,
      b = points[i + 1]!;
    if (same(a, b)) error();
    const c = points[i + 2] ?? (close ? points[1] : undefined);
    if (
      c &&
      Math.abs(turn(a, b, c)) < eps &&
      (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) < 0
    )
      error();
    for (let j = i + 2; j < points.length - 1; j++) {
      if (
        i === 0 &&
        j === points.length - 2 &&
        same(points[0]!, points.at(-1)!)
      )
        continue;
      const c = points[j]!,
        d = points[j + 1]!;
      if (
        on(a, b, c) ||
        on(a, b, d) ||
        on(c, d, a) ||
        on(c, d, b) ||
        (turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0)
      )
        error();
    }
  }
}

import type { Point3 } from "./types";
export function distance3(a: Point3, b: Point3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
export function measureDistance(points: Point3[]) {
  return points.reduce(
    (sum, p, i) => sum + (i ? distance3(points[i - 1]!, p) : 0),
    0,
  );
}
/** Newell area of a planar polygon in arbitrary orientation, in square metres. */
export function measureArea(points: Point3[]) {
  const normal: Point3 = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
    normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
    normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return Math.hypot(...normal) / 2;
}
export function formatModelMeasure(
  value: number,
  units: "metric" | "imperial",
  area = false,
) {
  if (units === "metric")
    return `${value.toLocaleString(undefined, { maximumFractionDigits: area ? 2 : 3 })} ${area ? "m²" : "m"}`;
  if (area)
    return `${(value * 10.7639104167).toLocaleString(undefined, { maximumFractionDigits: 2 })} ft²`;
  const inches = Math.round((value / 0.0254) * 16) / 16;
  const feet = Math.floor(inches / 12);
  return `${feet}′ ${(inches - feet * 12).toLocaleString(undefined, { maximumFractionDigits: 4 })}″`;
}
export function csvCell(value: string | number) {
  const s = String(value);
  return `"${(/^[=+@\-\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""')}"`;
}

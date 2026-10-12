import * as THREE from "three";
import { objectMatrix, remapDimension } from "./cad-geometry";
import type { DesignElement } from "./design";
import type { Point3 } from "./types";
import { assertSimpleOutline } from "./cad-outline-validation";
const EPS = 1e-8;
const cross = (a: THREE.Vector2, b: THREE.Vector2) => a.x * b.y - a.y * b.x;
function outline(element: DesignElement) {
  if (
    !["line", "polyline", "rectangle", "circle", "profile"].includes(
      element.kind,
    ) ||
    !element.points ||
    element.points.some((p) => Math.abs(p[2]) > 1e-6)
  )
    throw Error("Choose a flat line or outline.");
  const points = element.points.map((p) => new THREE.Vector2(p[0], p[1]));
  const closed =
    points.length > 2 && points[0]!.distanceTo(points.at(-1)!) < EPS;
  if (closed) points.pop();
  if (
    points.length < 2 ||
    points.some((p, i) => i > 0 && p.distanceTo(points[i - 1]!) < EPS)
  )
    throw Error("Remove duplicate vertices first.");
  return { points, closed };
}
function intersection(
  a: THREE.Vector2,
  u: THREE.Vector2,
  b: THREE.Vector2,
  v: THREE.Vector2,
) {
  const den = cross(u, v);
  if (Math.abs(den) < EPS) return null;
  return a.clone().addScaledVector(u, cross(b.clone().sub(a), v) / den);
}
function withPoints(
  element: DesignElement,
  points: THREE.Vector2[],
  closed: boolean,
): DesignElement {
  if (closed) points.push(points[0]!.clone());
  return {
    ...element,
    kind:
      element.kind === "profile"
        ? "profile"
        : points.length === 2
          ? "line"
          : "polyline",
    points: points.map((p) => [p.x, p.y, 0]),
  };
}
function bakeOutlineScale(element: DesignElement): DesignElement {
  if (!element.scale) return element;
  // Distances are physical metres even after non-uniform scaling or reflection.
  const [x, y, z] = element.scale;
  return {
    ...element,
    scale: [1, 1, z],
    points: element.points?.map((p) => [p[0] * x, p[1] * y, p[2]]),
  };
}
/** Closed outlines: positive means outward. Open paths: positive means left. */
export function offsetOutline(
  element: DesignElement,
  distance: number,
): DesignElement {
  if (!Number.isFinite(distance) || Math.abs(distance) < EPS)
    throw Error("Enter a non-zero offset.");
  element = bakeOutlineScale(element);
  const { points, closed } = outline(element);
  let d = distance;
  if (closed) {
    const area = points.reduce(
      (n, p, i) => n + cross(p, points[(i + 1) % points.length]!),
      0,
    );
    if (Math.abs(area) < EPS) throw Error("Choose an outline with an area.");
    d *= area > 0 ? -1 : 1;
  }
  const count = closed ? points.length : points.length - 1;
  const edges = Array.from({ length: count }, (_, i) => {
    const direction = points[(i + 1) % points.length]!.clone()
      .sub(points[i]!)
      .normalize();
    return {
      direction,
      start: points[i]!.clone().add(
        new THREE.Vector2(-direction.y, direction.x).multiplyScalar(d),
      ),
    };
  });
  const shifted = points.map((p, i) => {
    if (!closed && i === 0) return edges[0]!.start;
    if (!closed && i === points.length - 1)
      return edges
        .at(-1)!
        .start.clone()
        .add(p.clone().sub(points[i - 1]!));
    const before = edges[(i + edges.length - 1) % edges.length]!,
      after = edges[i]!;
    const hit =
      intersection(
        before.start,
        before.direction,
        after.start,
        after.direction,
      ) ?? after.start;
    if (hit.distanceTo(p) > Math.abs(distance) * 20)
      throw Error("This corner is too sharp for that offset.");
    return hit;
  });
  // An inward offset cannot pass through the opposite side and invert edges.
  for (let i = 0; i < count; i++)
    if (
      shifted[(i + 1) % shifted.length]!.clone()
        .sub(shifted[i]!)
        .dot(edges[i]!.direction) <= EPS
    )
      throw Error("That offset collapses the outline. Use a smaller distance.");
  const result = withPoints(element, shifted, closed);
  assertSimpleOutline(result.points!);
  return result;
}
/** Round/bevel all non-straight vertices; reject intersecting corner treatments. */
export function roundOutline(
  element: DesignElement,
  distance: number,
  mode: "fillet" | "chamfer",
): DesignElement {
  if (!Number.isFinite(distance) || distance <= 0)
    throw Error("Enter a positive radius or chamfer distance.");
  element = bakeOutlineScale(element);
  const { points, closed } = outline(element);
  if (points.length < 3)
    throw Error("Choose an outline with at least three vertices.");
  const corners = points.map((p, i) => {
    if (!closed && (i === 0 || i === points.length - 1))
      return { points: [p], cut: 0 };
    const a = points[(i + points.length - 1) % points.length]!.clone()
        .sub(p)
        .normalize(),
      b = points[(i + 1) % points.length]!.clone().sub(p).normalize();
    const theta = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
    if (Math.abs(Math.PI - theta) < EPS) return { points: [p], cut: 0 };
    if (theta < EPS) throw Error("The outline doubles back at a corner.");
    const cut = mode === "fillet" ? distance / Math.tan(theta / 2) : distance;
    const start = p.clone().addScaledVector(a, cut),
      end = p.clone().addScaledVector(b, cut);
    if (mode === "chamfer") return { points: [start, end], cut };
    const centre = p
      .clone()
      .addScaledVector(
        a.clone().add(b).normalize(),
        distance / Math.sin(theta / 2),
      );
    const sa = Math.atan2(start.y - centre.y, start.x - centre.x),
      ea = Math.atan2(end.y - centre.y, end.x - centre.x);
    let sweep = ea - sa;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    const segments = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
    return {
      cut,
      points: Array.from(
        { length: segments + 1 },
        (_, j) =>
          new THREE.Vector2(
            centre.x + distance * Math.cos(sa + (sweep * j) / segments),
            centre.y + distance * Math.sin(sa + (sweep * j) / segments),
          ),
      ),
    };
  });
  for (let i = 0; i < (closed ? points.length : points.length - 1); i++) {
    const j = (i + 1) % points.length;
    if (
      corners[i]!.cut + corners[j]!.cut >=
      points[i]!.distanceTo(points[j]!) - EPS
    )
      throw Error("The corners overlap. Reduce the radius or distance.");
  }
  const result = withPoints(
    element,
    corners.flatMap((c) => c.points),
    closed,
  );
  if (result.points!.length > 512)
    throw Error(
      "The rounded outline has too many vertices. Use a simpler outline.",
    );
  assertSimpleOutline(result.points!);
  return result;
}
/** Extend/trim the nearest endpoint of the first line to the second line. */
export function meetLines(
  first: DesignElement,
  boundary: DesignElement,
  extend: boolean,
): DesignElement {
  if (
    !["line", "polyline"].includes(first.kind) ||
    !["line", "polyline"].includes(boundary.kind) ||
    first.points?.length !== 2 ||
    boundary.points?.length !== 2
  )
    throw Error("Select two straight lines, with the line to change first.");
  const inverse = objectMatrix(first).invert();
  const p = first.points.map((v) => new THREE.Vector2(v[0], v[1]));
  const q = boundary.points.map((v) =>
    new THREE.Vector3(...v)
      .applyMatrix4(objectMatrix(boundary))
      .applyMatrix4(inverse),
  );
  if (
    first.points.some((v) => Math.abs(v[2]) > 1e-6) ||
    q.some((v) => Math.abs(v.z) > 1e-5)
  )
    throw Error("Both lines must lie in the same plane.");
  const a = new THREE.Vector2(q[0]!.x, q[0]!.y),
    b = new THREE.Vector2(q[1]!.x, q[1]!.y);
  const direction = p[1]!.clone().sub(p[0]!),
    hit = intersection(p[0]!, direction, a, b.sub(a));
  if (!hit) throw Error("Parallel lines do not meet.");
  const t = hit.clone().sub(p[0]!).dot(direction) / direction.lengthSq();
  if (extend ? t > EPS && t < 1 - EPS : t <= EPS || t >= 1 - EPS)
    throw Error(
      extend
        ? "The lines already cross. Use Trim instead."
        : "The crossing is outside this line. Use Extend instead.",
    );
  const end = extend ? (t < 0 ? 0 : 1) : t < 0.5 ? 0 : 1;
  p[end] = hit;
  return withPoints(first, p, false);
}
export function mirrorElements(
  elements: DesignElement[],
  axis: 0 | 1 | 2,
  coordinate: number,
): DesignElement[] {
  const s = new THREE.Vector3(1, 1, 1).setComponent(axis, -1),
    shift = new THREE.Vector3().setComponent(axis, 2 * coordinate);
  const reflection = new THREE.Matrix4()
    .makeTranslation(...(shift.toArray() as Point3))
    .multiply(new THREE.Matrix4().makeScale(s.x, s.y, s.z));
  const ids = new Map(elements.map((e) => [e.id, crypto.randomUUID()]));
  return elements.map((e) => {
    const position = new THREE.Vector3(),
      rotation = new THREE.Quaternion(),
      scale = new THREE.Vector3();
    reflection
      .clone()
      .multiply(objectMatrix(e))
      .decompose(position, rotation, scale);
    const angles = new THREE.Euler().setFromQuaternion(rotation);
    return {
      ...e,
      id: ids.get(e.id)!,
      dimension: remapDimension(e, ids),
      name: `${e.name.slice(0, 150)} mirror`,
      position: position.toArray() as Point3,
      rotation: [angles.x, angles.y, angles.z].map(
        THREE.MathUtils.radToDeg,
      ) as Point3,
      scale: scale.toArray() as Point3,
    };
  });
}

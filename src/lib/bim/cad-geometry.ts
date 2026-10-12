import * as THREE from "three";
import {
  newDesignElement,
  type DesignElement,
  type DesignKind,
  type ModelDesign,
} from "./design";
import type { Point3 } from "./types";
export type CadView = "3d" | "top" | "front" | "right";
export type CadPlane = Exclude<CadView, "3d">;
export const cadViews: Record<CadView, string> = {
  "3d": "3D",
  top: "Top",
  front: "Front",
  right: "Right",
};
export const sketchKinds = new Set<DesignKind>([
  "line",
  "polyline",
  "rectangle",
  "circle",
  "profile",
  "dimension",
]);
export const planeAxes = (plane: CadPlane) =>
  plane === "top"
    ? {
        u: new THREE.Vector3(1, 0, 0),
        v: new THREE.Vector3(0, 0, -1),
        normal: new THREE.Vector3(0, 1, 0),
        axis: 1,
      }
    : plane === "front"
      ? {
          u: new THREE.Vector3(1, 0, 0),
          v: new THREE.Vector3(0, 1, 0),
          normal: new THREE.Vector3(0, 0, 1),
          axis: 2,
        }
      : {
          u: new THREE.Vector3(0, 0, -1),
          v: new THREE.Vector3(0, 1, 0),
          normal: new THREE.Vector3(1, 0, 0),
          axis: 0,
        };
export function planeRotation(plane: CadPlane) {
  const { u, v, normal } = planeAxes(plane);
  return new THREE.Euler().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(u, v, normal),
  );
}
export function constrainPoint(
  point: THREE.Vector3,
  start: THREE.Vector3 | null,
  plane: CadPlane,
  grid: number,
  angle: 0 | 45 | 90,
  length = 0,
) {
  const { u, v, axis } = planeAxes(plane),
    result = point.clone();
  if (grid > 0)
    for (let i = 0; i < 3; i++)
      if (i !== axis)
        result.setComponent(
          i,
          Math.round(result.getComponent(i) / grid) * grid,
        );
  if (start && (angle || length > 0)) {
    const delta = result.clone().sub(start),
      x = delta.dot(u),
      y = delta.dot(v);
    let a = Math.atan2(y, x);
    if (angle)
      a =
        Math.round(a / THREE.MathUtils.degToRad(angle)) *
        THREE.MathUtils.degToRad(angle);
    const distance = length > 0 ? length : Math.hypot(x, y);
    result
      .copy(start)
      .addScaledVector(u, Math.cos(a) * distance)
      .addScaledVector(v, Math.sin(a) * distance);
  }
  return result;
}
export function sketchVertices(
  kind: DesignKind,
  points: THREE.Vector3[],
  plane: CadPlane,
) {
  if (points.length < 2) return points;
  const first = points[0]!,
    last = points.at(-1)!,
    { u, v } = planeAxes(plane),
    delta = last.clone().sub(first);
  if (kind === "rectangle")
    return [
      first,
      first.clone().addScaledVector(u, delta.dot(u)),
      last,
      first.clone().addScaledVector(v, delta.dot(v)),
      first,
    ];
  if (kind === "circle") {
    const r = Math.hypot(delta.dot(u), delta.dot(v));
    return Array.from({ length: 65 }, (_, i) =>
      first
        .clone()
        .addScaledVector(u, r * Math.cos((i * Math.PI) / 32))
        .addScaledVector(v, r * Math.sin((i * Math.PI) / 32)),
    );
  }
  return points;
}
export function createSketch(
  kind: DesignKind,
  input: Point3[],
  plane: CadPlane,
): DesignElement {
  const points = sketchVertices(
      kind,
      input.map((p) => new THREE.Vector3(...p)),
      plane,
    ),
    center = points[0]!.clone(),
    rotation = planeRotation(plane);
  const inverse = new THREE.Quaternion().setFromEuler(rotation).invert();
  const element = newDesignElement(kind, center.toArray() as Point3);
  element.rotation = [rotation.x, rotation.y, rotation.z].map(
    (value) => THREE.MathUtils.radToDeg(value) + 0,
  ) as Point3;
  element.points = points.map(
    (p) => p.clone().sub(center).applyQuaternion(inverse).toArray() as Point3,
  );
  return element;
}
export function objectMatrix(element: DesignElement) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...element.position),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        ...(element.rotation.map(THREE.MathUtils.degToRad) as Point3),
      ),
    ),
    new THREE.Vector3(...(element.scale ?? [1, 1, 1])),
  );
}
export function elementSnapPoints(
  e: DesignElement,
): { point: THREE.Vector3; kind: string }[] {
  const matrix = objectMatrix(e),
    points: { point: THREE.Vector3; kind: string }[] = [];
  const add = (p: THREE.Vector3, kind: string) =>
    points.push({ point: p.applyMatrix4(matrix), kind });
  if (e.points) {
    for (let i = 0; i < e.points.length; i++) {
      add(new THREE.Vector3(...e.points[i]!), "Endpoint");
      if (i)
        add(
          new THREE.Vector3(...e.points[i - 1]!)
            .add(new THREE.Vector3(...e.points[i]!))
            .multiplyScalar(0.5),
          "Midpoint",
        );
    }
  } else if (e.mesh) {
    // Bound the snap index while retaining exact corners for ordinary solids.
    const stride = Math.max(1, Math.ceil(e.mesh.positions.length / 3 / 2000));
    for (let i = 0; i < e.mesh.positions.length; i += 3 * stride)
      add(
        new THREE.Vector3(
          ...(e.mesh.positions.slice(i, i + 3) as [number, number, number]),
        ),
        "Vertex",
      );
  } else if (["pipe", "duct", "tee"].includes(e.kind)) {
    add(new THREE.Vector3(0, -e.size[1] / 2, 0), "Endpoint");
    add(new THREE.Vector3(0, e.size[1] / 2, 0), "Endpoint");
  } else
    for (const x of [-0.5, 0.5])
      for (const y of [-0.5, 0.5])
        for (const z of [-0.5, 0.5])
          add(
            new THREE.Vector3(x * e.size[0], y * e.size[1], z * e.size[2]),
            "Corner",
          );
  add(
    e.points
      ? new THREE.Box3()
          .setFromPoints(e.points.map((p) => new THREE.Vector3(...p)))
          .getCenter(new THREE.Vector3())
      : new THREE.Vector3(),
    "Centre",
  );
  return points;
}
export const designLayers = (doc: ModelDesign) =>
  doc.layers ??
  [...new Set(["Design", ...doc.elements.map((e) => e.layer ?? "Design")])].map(
    (name) => ({ name, visible: true, locked: false }),
  );
export function isEditable(doc: ModelDesign, element: DesignElement) {
  if (!doc.layers) return true;
  const layer = doc.layers.find((l) => l.name === (element.layer ?? "Design"));
  return layer?.visible !== false && !layer?.locked;
}
export function duplicateElements(
  elements: DesignElement[],
  offset: Point3,
  copies = 1,
) {
  return Array.from({ length: Math.max(1, Math.min(100, copies)) }, (_, i) => {
    const ids = new Map(elements.map((e) => [e.id, crypto.randomUUID()]));
    return elements.map((e) => ({
      ...e,
      id: ids.get(e.id)!,
      dimension: remapDimension(e, ids),
      name: `${e.name.slice(0, 145)} copy ${i + 1}`,
      position: e.position.map((n, a) => n + offset[a]! * (i + 1)) as Point3,
    }));
  }).flat();
}
export function remapDimension(e: DesignElement, ids: Map<string, string>) {
  return e.dimension
    ? {
        ...e.dimension,
        anchors: e.dimension.anchors?.map((ref) =>
          ref && ids.has(ref.id) ? { ...ref, id: ids.get(ref.id)! } : null,
        ),
      }
    : undefined;
}
export function transformElements(
  doc: ModelDesign,
  ids: string[],
  delta: Point3,
  rotation: Point3,
  pivot: Point3,
  center: (id: number) => Point3 | undefined,
): ModelDesign {
  const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...(rotation.map(THREE.MathUtils.degToRad) as Point3)),
    ),
    p = new THREE.Vector3(...pivot),
    d = new THREE.Vector3(...delta);
  const rotate = (old: Point3) => {
    const next = new THREE.Euler().setFromQuaternion(
      q
        .clone()
        .multiply(
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(...(old.map(THREE.MathUtils.degToRad) as Point3)),
          ),
        ),
    );
    return [next.x, next.y, next.z].map(THREE.MathUtils.radToDeg) as Point3;
  };
  const move = (point: Point3) =>
    new THREE.Vector3(...point)
      .sub(p)
      .applyQuaternion(q)
      .add(p)
      .add(d)
      .toArray() as Point3;
  const overrides = [...doc.overrides];
  for (const id of ids.filter((id) => id.startsWith("source:"))) {
    const expressId = Number(id.slice(7)),
      c = center(expressId);
    if (!c) continue;
    const previous = overrides.find((o) => o.expressId === expressId) ?? {
      expressId,
      name: "",
      deleted: false,
      translation: [0, 0, 0] as Point3,
      rotation: [0, 0, 0] as Point3,
    };
    const target = move(c),
      next = {
        ...previous,
        translation: target.map(
          (v, i) => v - c[i]! + previous.translation[i]!,
        ) as Point3,
        rotation: rotate(previous.rotation),
      };
    const index = overrides.findIndex((o) => o.expressId === expressId);
    if (index < 0) overrides.push(next);
    else overrides[index] = next;
  }
  return {
    ...doc,
    overrides,
    elements: doc.elements.map((e) =>
      ids.includes(e.id) && isEditable(doc, e)
        ? { ...e, position: move(e.position), rotation: rotate(e.rotation) }
        : e,
    ),
  };
}

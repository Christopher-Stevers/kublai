import * as THREE from "three";
import type { DesignElement, ModelDesign } from "./design";
import { elementSnapPoints, objectMatrix } from "./cad-geometry";
import type { Point3 } from "./types";
export function dimensionValues(e: DesignElement) {
  const a = new THREE.Vector3(...(e.points?.[0] ?? [0, 0, 0])),
    b = new THREE.Vector3(...(e.points?.[1] ?? [1, 0, 0]));
  const scale = new THREE.Vector3(...(e.scale ?? [1, 1, 1]));
  const scaled = b.clone().sub(a).multiply(scale),
    physicalLength = scaled.length();
  const direction = b
    .clone()
    .sub(a)
    .divideScalar(physicalLength || 1);
  const perpendicular = new THREE.Vector3(0, 0, 1).cross(scaled);
  if (perpendicular.lengthSq() < 1e-12)
    perpendicular.set(0, 1, 0).cross(scaled);
  const normal = perpendicular.normalize().divide(scale);
  const options = e.dimension ?? {
    offset: 0.2,
    unit: "m" as const,
    precision: 2,
  };
  const start = a.clone().addScaledVector(normal, options.offset),
    end = b.clone().addScaledVector(normal, options.offset);
  const matrix = objectMatrix(e),
    length = a
      .clone()
      .applyMatrix4(matrix)
      .distanceTo(b.clone().applyMatrix4(matrix));
  const factor = { m: 1, mm: 1000, ft: 1 / 0.3048, in: 1 / 0.0254 }[
    options.unit
  ];
  return {
    a,
    b,
    start,
    end,
    direction,
    normal,
    length,
    label: `${(length * factor).toFixed(options.precision)} ${options.unit}`,
  };
}
export function bindDimension(e: DesignElement, doc: ModelDesign) {
  const matrix = objectMatrix(e);
  const candidates = doc.elements
    .filter((o) => o.kind !== "dimension")
    .map((o) => ({ id: o.id, anchors: elementSnapPoints(o) }));
  const anchors = (e.points ?? []).slice(0, 2).map((point) => {
    const world = new THREE.Vector3(...point).applyMatrix4(matrix);
    for (const candidate of candidates) {
      const index = candidate.anchors.findIndex(
        (a) => a.point.distanceTo(world) < 1e-5,
      );
      if (index >= 0) return { id: candidate.id, anchor: index };
    }
    return null;
  });
  return {
    ...e,
    dimension: {
      ...(e.dimension ?? { offset: 0.2, unit: "m" as const, precision: 2 }),
      anchors,
    },
  };
}
/** Refresh associative dimensions, freezing the last position if a target is removed. */
export function reconcileDimensions(
  doc: ModelDesign,
  previous: ModelDesign,
): ModelDesign {
  const get = (target: ModelDesign, ref: { id: string; anchor: number }) => {
    const object = target.elements.find(
      (e) => e.id === ref.id && e.kind !== "dimension",
    );
    return object ? elementSnapPoints(object)[ref.anchor]?.point : undefined;
  };
  return {
    ...doc,
    elements: doc.elements.map((e) => {
      if (e.kind !== "dimension" || !e.dimension?.anchors?.some(Boolean))
        return e;
      const inverse = objectMatrix(e).invert();
      const anchors = [...e.dimension.anchors];
      const points = e.points!.map((p, i) => {
        const ref = anchors[i];
        if (!ref) return p;
        const before = previous.elements.find((o) => o.id === ref.id),
          after = doc.elements.find((o) => o.id === ref.id);
        let world =
          before &&
          after &&
          (before.kind !== after.kind ||
            before.points?.length !== after.points?.length)
            ? undefined
            : get(doc, ref);
        if (!world) {
          world = get(previous, ref);
          anchors[i] = null;
        }
        return world ? (world.applyMatrix4(inverse).toArray() as Point3) : p;
      });
      return { ...e, points, dimension: { ...e.dimension, anchors } };
    }),
  };
}
export function dimensionGraphic(e: DesignElement) {
  const group = new THREE.Group(),
    { lines, label, labelPoint, height } = dimensionGeometry(e);
  group.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(lines),
      new THREE.LineBasicMaterial({ color: e.color, depthTest: false }),
    ),
  );
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (context) {
      context.font = "600 42px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.lineWidth = 9;
      context.strokeStyle = "#101820";
      context.strokeText(label, 320, 48);
      context.fillStyle = e.color;
      context.fillText(label, 320, 48);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          depthTest: false,
        }),
      );
      sprite.position.copy(labelPoint);
      sprite.scale.set((height * 640) / 96, height, 1);
      sprite.renderOrder = 1001;
      group.add(sprite);
    }
  }
  group.renderOrder = 1000;
  return group;
}
/** Local-space annotation geometry shared by the canvas, DXF and IFC exports. */
export function dimensionGeometry(e: DesignElement) {
  const { a, b, start, end, direction, normal, label, length } =
    dimensionValues(e);
  const arrow = Math.max(0.005, Math.min(0.15, length * 0.04));
  const lines = [a, start, b, end, start, end];
  for (const [point, sign] of [
    [start, 1],
    [end, -1],
  ] as const) {
    lines.push(
      point,
      point
        .clone()
        .addScaledVector(direction, arrow * sign)
        .addScaledVector(normal, arrow * 0.4),
    );
    lines.push(
      point,
      point
        .clone()
        .addScaledVector(direction, arrow * sign)
        .addScaledVector(normal, -arrow * 0.4),
    );
  }
  return {
    lines,
    label,
    labelPoint: start
      .clone()
      .add(end)
      .multiplyScalar(0.5)
      .addScaledVector(normal, arrow * 2),
    height: Math.max(0.02, Math.min(0.45, length * 0.075)),
    direction,
    normal,
  };
}

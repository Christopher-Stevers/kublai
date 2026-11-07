import * as THREE from "three";
import { designObject, disposeDesignObject } from "./design-geometry";
import type { CadMesh, DesignElement } from "./design";
import type { Point3 } from "./types";

/** Geometry is kept near an operation's origin before conversion to float32. */
export function geometryMesh(
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
): CadMesh {
  const attribute = geometry.getAttribute("position"),
    positions: number[] = [];
  const point = new THREE.Vector3();
  for (let i = 0; i < attribute.count; i++) {
    point.fromBufferAttribute(attribute, i).applyMatrix4(matrix);
    positions.push(point.x, point.y, point.z);
  }
  const indices = geometry.index
    ? Array.from(geometry.index.array)
    : Array.from({ length: attribute.count }, (_, i) => i);
  if (matrix.determinant() < 0)
    for (let i = 0; i < indices.length; i += 3)
      [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!];
  return { positions, indices };
}
export function elementMeshes(
  element: DesignElement,
  origin: Point3 = [0, 0, 0],
): CadMesh[] {
  const group = designObject(element),
    result: CadMesh[] = [];
  group.position.sub(new THREE.Vector3(...origin));
  group.updateMatrixWorld(true);
  try {
    group.traverse((object) => {
      if (object instanceof THREE.Mesh)
        result.push(
          geometryMesh(
            object.geometry as THREE.BufferGeometry,
            object.matrixWorld,
          ),
        );
    });
    return result;
  } finally {
    disposeDesignObject(group);
  }
}
export function meshBounds(mesh: CadMesh) {
  const bounds = new THREE.Box3(),
    point = new THREE.Vector3();
  for (let i = 0; i < mesh.positions.length; i += 3)
    bounds.expandByPoint(point.fromArray(mesh.positions, i));
  return bounds;
}

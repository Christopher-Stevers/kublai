import * as THREE from "three";

type Entry = { index: number; bounds: THREE.Box3 };
type Node = {
  bounds: THREE.Box3;
  entries?: Entry[];
  left?: Node;
  right?: Node;
};
export type ModelIntersection = THREE.Intersection<THREE.BatchedMesh> & {
  batchId: number;
};

function tree(entries: Entry[]): Node | undefined {
  if (!entries.length) return;
  const bounds = new THREE.Box3();
  for (const entry of entries) bounds.union(entry.bounds);
  if (entries.length <= 8) return { bounds, entries };
  const size = bounds.getSize(new THREE.Vector3());
  const axis =
    size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z";
  entries.sort(
    (a, b) =>
      a.bounds.min[axis] +
      a.bounds.max[axis] -
      b.bounds.min[axis] -
      b.bounds.max[axis],
  );
  const middle = Math.floor(entries.length / 2);
  return {
    bounds,
    left: tree(entries.slice(0, middle)),
    right: tree(entries.slice(middle)),
  };
}
function candidates(node: Node | undefined, ray: THREE.Ray, result: number[]) {
  if (!node || !ray.intersectsBox(node.bounds)) return;
  if (node.entries) {
    for (const entry of node.entries)
      if (ray.intersectsBox(entry.bounds)) result.push(entry.index);
  } else {
    candidates(node.left, ray, result);
    candidates(node.right, ray, result);
  }
}

/** Bounds only select candidates. Three.js still computes the exact triangle hit. */
export class SpatialModelPicker {
  private batches = new Map<THREE.BatchedMesh, Node | undefined>();
  private mesh = new THREE.Mesh(new THREE.BufferGeometry());
  private matrix = new THREE.Matrix4();
  private ray = new THREE.Ray();
  add(batch: THREE.BatchedMesh, indices: Iterable<number>) {
    const entries: Entry[] = [];
    for (const index of indices) {
      const bounds = new THREE.Box3();
      const geometryId = batch.getGeometryIdAt(index);
      batch.getBoundingBoxAt(geometryId, bounds);
      batch.getMatrixAt(index, this.matrix);
      // Use the actual stored instance matrix, including Float32 rounding.
      bounds.applyMatrix4(this.matrix);
      if (
        !Number.isFinite(
          bounds.min.x +
            bounds.min.y +
            bounds.min.z +
            bounds.max.x +
            bounds.max.y +
            bounds.max.z,
        )
      ) {
        this.batches.set(batch, undefined);
        return;
      }
      // Conservative bounds protect edge hits; measurement coordinates remain exact.
      const scale = Math.max(
        1,
        ...bounds.min.toArray().map(Math.abs),
        ...bounds.max.toArray().map(Math.abs),
      );
      bounds.expandByScalar(Math.max(1e-7, scale * 1e-12));
      entries.push({ index, bounds });
    }
    this.batches.set(batch, tree(entries));
  }
  remove(batch: THREE.BatchedMesh) {
    this.batches.delete(batch);
    this.releaseScratch();
  }
  clear() {
    this.batches.clear();
    this.releaseScratch();
  }
  private releaseScratch() {
    this.mesh.geometry.attributes = {};
    this.mesh.geometry.setIndex(null);
  }
  intersect(raycaster: THREE.Raycaster): ModelIntersection[] {
    const hits: ModelIntersection[] = [];
    for (const [batch, root] of this.batches) {
      if (!batch.layers.test(raycaster.layers)) continue;
      if (!root) {
        batch.raycast(raycaster, hits);
        continue;
      }
      this.matrix.copy(batch.matrixWorld).invert();
      this.ray.copy(raycaster.ray).applyMatrix4(this.matrix);
      const indices: number[] = [];
      candidates(root, this.ray, indices);
      // Preserve Three.js instance order for equal-distance triangle hits.
      indices.sort((a, b) => a - b);
      const geometry = this.mesh.geometry;
      geometry.attributes = batch.geometry.attributes;
      geometry.index = batch.geometry.index;
      geometry.boundingBox ??= new THREE.Box3();
      geometry.boundingSphere ??= new THREE.Sphere();
      this.mesh.material = batch.material;
      for (const index of indices) {
        if (!batch.getVisibleAt(index)) continue;
        const id = batch.getGeometryIdAt(index);
        const range = batch.getGeometryRangeAt(id)!;
        geometry.setDrawRange(range.start, range.count);
        batch
          .getMatrixAt(index, this.mesh.matrixWorld)
          .premultiply(batch.matrixWorld);
        batch.getBoundingBoxAt(id, geometry.boundingBox);
        batch.getBoundingSphereAt(id, geometry.boundingSphere);
        const exact: THREE.Intersection[] = [];
        this.mesh.raycast(raycaster, exact);
        for (const hit of exact)
          hits.push({ ...hit, object: batch, batchId: index });
      }
    }
    hits.sort((a, b) => a.distance - b.distance);
    return hits;
  }
}

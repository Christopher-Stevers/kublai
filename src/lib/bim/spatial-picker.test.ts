// @vitest-environment node
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { SpatialModelPicker } from "./spatial-picker";
function summary(hits: THREE.Intersection[]) {
  return hits.map((hit) => ({
    object: hit.object.uuid,
    id: (hit as THREE.Intersection & { batchId: number }).batchId,
    distance: hit.distance,
    point: hit.point.toArray(),
    face: hit.face,
    faceIndex: hit.faceIndex,
    uv: hit.uv?.toArray(),
    normal: hit.normal?.toArray(),
  }));
}
function fixture(indexed = true) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const source = indexed ? geometry : geometry.toNonIndexed();
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const batch = new THREE.BatchedMesh(
    100,
    source.attributes.position!.count,
    source.index?.count ?? 0,
    material,
  );
  const geometryId = batch.addGeometry(source);
  const indices = [];
  for (let i = 0; i < 100; i++) {
    const id = batch.addInstance(geometryId);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3((i % 10) * 3, Math.floor(i / 10) * 3, i % 3),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.13, i * 0.04, 0.2)),
      new THREE.Vector3(1, 0.7, 1.4),
    );
    batch.setMatrixAt(id, matrix);
    indices.push(id);
  }
  const picker = new SpatialModelPicker();
  picker.add(batch, indices);
  batch.position.set(100, 20, -30);
  batch.rotation.y = 0.25;
  batch.updateMatrixWorld(true);
  return {
    batch,
    picker,
    indices,
    dispose: () => {
      picker.clear();
      batch.dispose();
      material.dispose();
      source.dispose();
      geometry.dispose();
    },
  };
}
describe("spatial model selection", () => {
  it.each([true, false])(
    "retains exact Three.js hits with indexed geometry=%s",
    (indexed) => {
      const f = fixture(indexed);
      try {
        for (let i = 0; i < 30; i++) {
          const center = new THREE.Vector3(
            (i % 10) * 3,
            Math.floor(i / 10) * 3,
            i % 3,
          ).applyMatrix4(f.batch.matrixWorld);
          const origin = center.clone().add(new THREE.Vector3(0.2, 0.1, 20));
          const ray = new THREE.Raycaster(
            origin,
            center.clone().sub(origin).normalize(),
            i % 5 === 0 ? 19.8 : 0,
            i % 7 === 0 ? 19.9 : Infinity,
          );
          expect(summary(f.picker.intersect(ray))).toEqual(
            summary(ray.intersectObject(f.batch, false)),
          );
        }
      } finally {
        f.dispose();
      }
    },
  );
  it("applies visibility and layers without rebuilding, then frees removed batches", () => {
    const f = fixture();
    try {
      const center = new THREE.Vector3().applyMatrix4(f.batch.matrixWorld);
      const ray = new THREE.Raycaster(
        center.clone().add(new THREE.Vector3(0, 0, 10)),
        new THREE.Vector3(0, 0, -1),
      );
      for (const visible of [true, false, true]) {
        f.batch.setVisibleAt(0, visible);
        expect(summary(f.picker.intersect(ray))).toEqual(
          summary(ray.intersectObject(f.batch, false)),
        );
      }
      f.batch.layers.set(2);
      expect(f.picker.intersect(ray)).toEqual([]);
      ray.layers.set(2);
      expect(summary(f.picker.intersect(ray))).toEqual(
        summary(ray.intersectObject(f.batch, false)),
      );
      f.picker.remove(f.batch);
      expect(f.picker.intersect(ray)).toEqual([]);
    } finally {
      f.dispose();
    }
  });
  it("preserves equal-distance ordering and triangle edges across batches", () => {
    const fixtures = [fixture(), fixture()];
    const picker = new SpatialModelPicker();
    try {
      for (const f of fixtures) {
        f.batch.position.set(0, 0, 0);
        f.batch.rotation.set(0, 0, 0);
        f.batch.updateMatrixWorld();
        picker.add(f.batch, f.indices);
      }
      for (const x of [0, 0.5, -0.5, 0.49999999]) {
        const ray = new THREE.Raycaster(
          new THREE.Vector3(x, 0, 10),
          new THREE.Vector3(0, 0, -1),
        );
        expect(summary(picker.intersect(ray))).toEqual(
          summary(
            ray.intersectObjects(
              fixtures.map((f) => f.batch),
              false,
            ),
          ),
        );
      }
    } finally {
      picker.clear();
      for (const f of fixtures) f.dispose();
    }
  });
});

import * as THREE from "three";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { SpatialModelPicker } from "../src/lib/bim/spatial-picker";

const [output] = process.argv.slice(2);
if (!output) throw Error("Usage: benchmark-model-picker.ts report.json");
const cases = [];
for (const placements of [1000, 10000, 50000]) {
  const batches: THREE.BatchedMesh[] = [];
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const geometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
  const picker = new SpatialModelPicker();
  const start = performance.now();
  for (let base = 0; base < placements; base += 100) {
    const batch = new THREE.BatchedMesh(100, 24, 36, material);
    const geometryId = batch.addGeometry(geometry);
    const ids = [];
    for (let i = base; i < base + 100; i++) {
      const id = batch.addInstance(geometryId);
      batch.setMatrixAt(
        id,
        new THREE.Matrix4().makeTranslation(i % 250, Math.floor(i / 250), 0),
      );
      ids.push(id);
    }
    batch.updateMatrixWorld();
    picker.add(batch, ids);
    batches.push(batch);
  }
  const setupMs = performance.now() - start;
  const rays = Array.from(
    { length: 25 },
    (_, i) =>
      new THREE.Raycaster(
        new THREE.Vector3(
          (i * 17) % 250,
          Math.floor(((i * 193) % placements) / 250),
          10,
        ),
        new THREE.Vector3(0, 0, -1),
      ),
  );
  const summaries = [];
  for (const engine of ["scan", "indexed"]) {
    const times = [];
    let resultSha256 = "";
    for (let round = 0; round < 4; round++) {
      const results = [];
      const started = performance.now();
      for (const ray of rays) {
        const hits =
          engine === "scan"
            ? ray.intersectObjects(batches, false)
            : picker.intersect(ray);
        results.push(
          hits.map((hit) => ({
            batch: batches.indexOf(hit.object as THREE.BatchedMesh),
            instance: (hit as THREE.Intersection & { batchId: number }).batchId,
            distance: hit.distance,
            point: hit.point.toArray(),
            face: hit.faceIndex,
          })),
        );
      }
      const elapsed = (performance.now() - started) / rays.length;
      const hash = createHash("sha256")
        .update(JSON.stringify(results))
        .digest("hex");
      if (resultSha256 && resultSha256 !== hash)
        throw Error("Unstable raycast result");
      resultSha256 = hash;
      if (round) times.push(elapsed);
    }
    summaries.push({
      engine,
      perPickMs: times,
      medianMs: [...times].sort((a, b) => a - b)[1],
      resultSha256,
    });
  }
  if (summaries[0]!.resultSha256 !== summaries[1]!.resultSha256)
    throw Error("Raycast results differ");
  const result = { placements, setupMs, summaries };
  cases.push(result);
  console.log(JSON.stringify(result));
  picker.clear();
  for (const batch of batches) batch.dispose();
  geometry.dispose();
  material.dispose();
}
await writeFile(
  output,
  JSON.stringify({ synthetic: true, cases }, null, 2) + "\n",
);

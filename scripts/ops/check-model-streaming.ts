/** Compare progressive geometry against the original IFC reader. No app data is modified. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { IfcAPI, LogLevel } from "web-ifc";
import { compactGeometry } from "../../src/lib/bim/compact-geometry";
import {
  readMeshParts,
  viewableElementIds,
} from "../../src/lib/bim/ifc-geometry";
import { planModelBatches } from "../../src/lib/bim/model-memory";
import type { IfcPart } from "../../src/lib/bim/worker-protocol";

const file = process.argv[2];
if (!file)
  throw Error(
    "Usage: pnpm exec tsx scripts/ops/check-model-streaming.ts model.ifc [report.json]",
  );
const data = await readFile(file);
const api = new IfcAPI();
await api.Init();
api.SetLogLevel(LogLevel.LOG_LEVEL_ERROR);
const model = api.OpenModel(data, {
  COORDINATE_TO_ORIGIN: false,
  CIRCLE_SEGMENTS: 24,
  MEMORY_LIMIT: 512 * 1024 * 1024,
});
assert(model >= 0 && api.IsModelOpen(model));
const baseline = new Map<number, string[]>();
let sourceBytes = 0,
  compactBytes = 0,
  sourceVertices = 0,
  compactVertices = 0;
let triangles = 0,
  streamedTriangles = 0,
  sceneBytes = 0,
  chunks = 0;
const start = performance.now();
function signature(
  positions: Float32Array,
  indices: Uint32Array | Uint16Array,
  stride: number,
  matrix: number[],
) {
  const expanded = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    const j = indices[i]! * stride;
    expanded[i * 3] = positions[j]!;
    expanded[i * 3 + 1] = positions[j + 1]!;
    expanded[i * 3 + 2] = positions[j + 2]!;
  }
  return createHash("sha256")
    .update(new Uint8Array(expanded.buffer))
    .update(JSON.stringify(matrix))
    .digest("hex");
}
try {
  api.StreamAllMeshes(model, (mesh) => {
    const signatures: string[] = [];
    for (let i = 0; i < mesh.geometries.size(); i++) {
      const placed = mesh.geometries.get(i),
        g = api.GetGeometry(model, placed.geometryExpressID);
      try {
        const v = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
        const ix = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
        if (!ix.length) continue;
        sourceBytes += v.byteLength + ix.byteLength;
        sourceVertices += v.length / 6;
        triangles += ix.length / 3;
        signatures.push(signature(v, ix, 6, placed.flatTransformation));
        const packed = compactGeometry(v, ix);
        compactVertices += packed.positions.length / 3;
        compactBytes +=
          packed.positions.byteLength +
          packed.normals.byteLength +
          packed.indices.byteLength;
      } finally {
        g.delete();
      }
    }
    if (signatures.length) baseline.set(mesh.expressID, signatures);
  });
  const cache: Parameters<typeof readMeshParts>[3] = new Map();
  const seen = new Set<number>();
  let parts: IfcPart[] = [],
    bytes = 0;
  const buffers = new Set<ArrayBufferLike>();
  const flush = () => {
    if (!parts.length) return;
    sceneBytes += planModelBatches(parts).reduce(
      (sum, batch) => sum + batch.bytes,
      0,
    );
    parts = [];
    bytes = 0;
    cache.clear();
    buffers.clear();
    chunks++;
  };
  for (const id of viewableElementIds(api, model)) {
    const incoming = readMeshParts(api, model, id, cache);
    if (!incoming.length) continue;
    seen.add(id);
    assert.deepEqual(
      incoming.map((p) => signature(p.positions, p.indices, 3, p.matrix)),
      baseline.get(id),
      `Triangle coordinates or placement changed for #${id}`,
    );
    for (const part of incoming) {
      parts.push(part);
      streamedTriangles += part.indices.length / 3;
      for (const buffer of [
        part.positions.buffer,
        part.normals.buffer,
        part.indices.buffer,
      ])
        if (!buffers.has(buffer)) {
          buffers.add(buffer);
          bytes += buffer.byteLength;
        }
    }
    if (parts.length >= 96 || bytes >= 2 * 1024 * 1024) flush();
  }
  flush();
  assert.deepEqual(
    seen,
    new Set(baseline.keys()),
    "Visible element set changed",
  );
  assert.equal(streamedTriangles, triangles);
  const report = {
    checkedAt: new Date().toISOString(),
    file,
    fileBytes: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
    elements: seen.size,
    triangles,
    sourceVertices,
    compactVertices,
    sourceBytes,
    compactBytes,
    savedPercent: Number((100 * (1 - compactBytes / sourceBytes)).toFixed(2)),
    estimatedSceneBytes: sceneBytes,
    chunks,
    elapsedMs: Math.round(performance.now() - start),
    exactTrianglePositionsAndTransforms: true,
    limitation:
      "Reader regression check, not verification of source conversion completeness or construction accuracy.",
  };
  if (process.argv[3])
    await writeFile(process.argv[3], JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  api.CloseModel(model);
}

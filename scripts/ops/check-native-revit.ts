/** Downloads public MIT reference models; never uses or uploads project data.
 * Run from the repo root: pnpm exec tsx scripts/ops/check-native-revit.ts
 * Matching bounds are a regression signal, not proof of construction accuracy.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { IfcAPI } from "web-ifc";
import models from "../../native/revit/reference-models.json";
import { convertNativeRevit } from "../../src/server/models/native-conversion";

const directory = path.resolve(".tmp/native-revit-validation");
await mkdir(directory, { recursive: true });
const digest = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
async function fixture(name: string, source: { url: string; sha256: string }) {
  const file = path.join(directory, name);
  let bytes: Uint8Array;
  try {
    bytes = await readFile(file);
  } catch {
    const response = await fetch(source.url, {
      signal: AbortSignal.timeout(120000),
    });
    assert(response.ok, `Download failed: ${name}`);
    bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(
      digest(bytes),
      source.sha256,
      `Unexpected public sample: ${name}`,
    );
    await writeFile(file, bytes);
  }
  assert.equal(digest(bytes), source.sha256, `Sample changed: ${name}`);
  return file;
}

type Element = { guid: string; bounds: number[] };
const api = new IfcAPI();
await api.Init();
async function geometry(file: string) {
  const id = api.OpenModel(new Uint8Array(await readFile(file)), {
    COORDINATE_TO_ORIGIN: false,
  });
  assert(id >= 0, `IFC did not open: ${path.basename(file)}`);
  const elements = new Map<string, Element>();
  try {
    api.StreamAllMeshes(id, (mesh) => {
      const row = api.GetLine(id, mesh.expressID, false) as {
        Tag?: { value?: unknown };
        GlobalId?: { value?: unknown };
      };
      const tag = String(row.Tag?.value ?? "");
      if (!tag) return;
      const bounds = [
        Infinity,
        Infinity,
        Infinity,
        -Infinity,
        -Infinity,
        -Infinity,
      ];
      for (let j = 0; j < mesh.geometries.size(); j++) {
        const placed = mesh.geometries.get(j);
        const shape = api.GetGeometry(id, placed.geometryExpressID);
        try {
          const vertices = api.GetVertexArray(
            shape.GetVertexData(),
            shape.GetVertexDataSize(),
          );
          const m = placed.flatTransformation;
          for (let i = 0; i < vertices.length; i += 6) {
            for (let k = 0; k < 3; k++) {
              const v =
                vertices[i]! * m[k]! +
                vertices[i + 1]! * m[4 + k]! +
                vertices[i + 2]! * m[8 + k]! +
                m[12 + k]!;
              bounds[k] = Math.min(bounds[k]!, v);
              bounds[k + 3] = Math.max(bounds[k + 3]!, v);
            }
          }
        } finally {
          shape.delete();
        }
      }
      assert(
        bounds.every(Number.isFinite),
        `Non-finite geometry for ElementId ${tag}`,
      );
      assert(!elements.has(tag), `Duplicate ElementId ${tag}`);
      elements.set(tag, { guid: String(row.GlobalId?.value ?? ""), bounds });
    });
  } finally {
    api.CloseModel(id);
  }
  return elements;
}

for (const sample of models) {
  const input = await fixture(sample.name + ".rvt", sample.rvt);
  const reference = await fixture(sample.name + "-reference.ifc", sample.ifc);
  const start = performance.now();
  const result = await convertNativeRevit(input);
  const elapsedMs = Math.round(performance.now() - start);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") throw Error("No converted geometry");
  assert.equal(result.report.revitVersion, sample.revitVersion);
  assert.equal(result.report.displayedElements, sample.baseline.geometry);
  assert.equal(result.report.omittedBoxElements, sample.baseline.omitted);
  assert.equal(result.report.measurementsAllowed, false);
  const output = path.join(directory, sample.name + "-converted.ifc");
  await writeFile(output, result.bytes);
  const actual = await geometry(output),
    expected = await geometry(reference);
  let matchingIds = 0,
    matchingGuids = 0,
    boundsWithin5mm = 0;
  const mismatches: { elementId: string; maxBoundErrorMetres: number }[] = [];
  for (const [elementId, a] of actual) {
    const e = expected.get(elementId);
    if (!e) continue;
    matchingIds++;
    if (a.guid === e.guid) matchingGuids++;
    const difference = Math.max(
      ...a.bounds.map((value, k) => Math.abs(value - e.bounds[k]!)),
    );
    if (difference <= 0.005) boundsWithin5mm++;
    else mismatches.push({ elementId, maxBoundErrorMetres: difference });
  }
  assert.equal(matchingIds, sample.baseline.matchingIds);
  assert.equal(matchingGuids, sample.baseline.matchingGuids);
  assert(
    boundsWithin5mm >= sample.baseline.boundsWithin5mm,
    "Geometry regression against known baseline",
  );
  const comparison = {
    name: sample.name,
    elapsedMs,
    report: result.report,
    visibleElements: actual.size,
    referenceVisibleElements: expected.size,
    matchingIds,
    matchingGuids,
    boundsWithin5mm,
    mismatches,
    limitation:
      "Bounding-box comparison only. Not surface, opening, property or construction-accuracy verification.",
  };
  await writeFile(
    path.join(directory, sample.name + ".json"),
    JSON.stringify(comparison, null, 2) + "\n",
  );
  console.log(
    `${sample.name}: ${elapsedMs} ms, ${matchingIds} matching IDs, ${boundsWithin5mm} bounds within 5 mm; experimental preview`,
  );
}

const invalid = path.join(directory, "invalid.rvt");
await writeFile(invalid, "Not a Revit file");
assert.equal((await convertNativeRevit(invalid)).status, "failed");
// Apache-2.0, synthetic CFB fixture from the pinned reader; not a real project.
const synthetic = await fixture("synthetic-2024.rvt", {
  url: "https://raw.githubusercontent.com/DrunkOnJava/rvt-rs/120e2f9ffa8422ba437102c8d300b7e902cdde80/corpus/tier1/mep-2024/mep-2024.rvt",
  sha256: "2c0516739b4eda099cfb18031f65e0c39f3cf52cf200b1a4a0451f4d25618604",
});
const bytes = await readFile(synthetic);
const from = Buffer.from("2024", "utf16le"),
  to = Buffer.from("2027", "utf16le");
let offset = 0;
while ((offset = bytes.indexOf(from, offset)) >= 0) {
  to.copy(bytes, offset);
  offset += to.length;
}
const future = path.join(directory, "synthetic-future.rvt");
await writeFile(future, bytes);
const futureResult = await convertNativeRevit(future);
assert.equal(futureResult.status, "failed");
assert.equal(futureResult.report.revitVersion, 2027);
console.log(
  "PASS: public model baselines, malformed file, automatic version detection and unsupported future version.",
);

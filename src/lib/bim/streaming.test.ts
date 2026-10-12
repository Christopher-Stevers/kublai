// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type * as WebIfc from "web-ifc";
import { compactGeometry } from "./compact-geometry";
import { readMeshParts, viewableElementIds } from "./ifc-geometry";
import { ModelLoadFlow } from "./model-load-flow";
import { modelMemoryBudget, planModelBatches } from "./model-memory";
import type { IfcPart } from "./worker-protocol";
const { IfcAPI } = createRequire(import.meta.url)("web-ifc") as typeof WebIfc;

describe("compact model geometry", () => {
  it("preserves indexed triangle positions, winding and hard normal seams", () => {
    const source = new Float32Array([
      0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0,
      1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0,
      1, 1, 0, 0,
    ]);
    const indices = new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const result = compactGeometry(source, indices);
    expect(result.positions.length / 3).toBe(6);
    expect(result.indices.length).toBe(indices.length);
    for (let i = 0; i < indices.length; i++) {
      const old = indices[i]! * 6,
        next = result.indices[i]! * 3;
      expect([...result.positions.slice(next, next + 3)]).toEqual([
        ...source.slice(old, old + 3),
      ]);
      expect(
        [...result.normals.slice(next, next + 3)].map((n) => n / 32767),
      ).toEqual([...source.slice(old + 3, old + 6)]);
    }
    expect(result.indices[0]).not.toBe(result.indices[6]);
  });
  it("bounds normal quantization error while preserving precise survey positions", () => {
    const v = new Float32Array([
      123456.75, 0.125, -8231.5, 0.371, -0.518, 0.77,
    ]);
    const result = compactGeometry(v, new Uint32Array([0, 0, 0]));
    expect([...new Uint32Array(result.positions.buffer)]).toEqual([
      ...new Uint32Array(v.buffer).slice(0, 3),
    ]);
    const original = [...v.slice(3)],
      normal = [...result.normals].map((n) => n / 32767);
    const l1 = Math.hypot(...original),
      l2 = Math.hypot(...normal);
    const dot = original.reduce(
      (sum, n, i) => sum + ((n / l1) * normal[i]!) / l2,
      0,
    );
    expect((Math.acos(Math.min(1, dot)) * 180) / Math.PI).toBeLessThan(0.003);
  });
  it("keeps wide indices for a single large component", () => {
    const vertices = new Float32Array(65538 * 6);
    for (let i = 0; i < 65538; i++) {
      vertices[i * 6] = i;
      vertices[i * 6 + 5] = 1;
    }
    const indices = Uint32Array.from({ length: 65538 }, (_, i) => i);
    const result = compactGeometry(vertices, indices);
    expect(result.indices).toBeInstanceOf(Uint32Array);
    expect(result.indices[65537]).toBe(65537);
    expect(result.positions[65537 * 3]).toBe(65537);
  });
  it("rejects corrupt indices and non-finite coordinates", () => {
    expect(() =>
      compactGeometry(new Float32Array(18), new Uint32Array([0, 1, 4])),
    ).toThrow("indices");
    expect(() =>
      compactGeometry(
        new Float32Array([NaN, 0, 0, 0, 0, 1]),
        new Uint32Array([0, 0, 0]),
      ),
    ).toThrow("non-finite");
  });
});

describe("streaming IFC elements", () => {
  it("matches the original reader's visible elements and all triangle coordinates", async () => {
    const api = new IfcAPI();
    await api.Init();
    const model = api.OpenModel(
      readFileSync(new URL("./fixtures/construction.ifc", import.meta.url)),
      { COORDINATE_TO_ORIGIN: false, CIRCLE_SEGMENTS: 24 },
    );
    const reference = new Map<
      number,
      { id: number; positions: number[]; matrix: number[] }[]
    >();
    try {
      api.StreamAllMeshes(model, (mesh) => {
        const parts: { id: number; positions: number[]; matrix: number[] }[] =
          [];
        for (let i = 0; i < mesh.geometries.size(); i++) {
          const p = mesh.geometries.get(i),
            g = api.GetGeometry(model, p.geometryExpressID);
          try {
            const v = api.GetVertexArray(
              g.GetVertexData(),
              g.GetVertexDataSize(),
            );
            const ix = api.GetIndexArray(
              g.GetIndexData(),
              g.GetIndexDataSize(),
            );
            const positions = [...ix].flatMap((index) => [
              v[index * 6]!,
              v[index * 6 + 1]!,
              v[index * 6 + 2]!,
            ]);
            parts.push({
              id: p.geometryExpressID,
              positions,
              matrix: p.flatTransformation,
            });
          } finally {
            g.delete();
          }
        }
        if (parts.length) reference.set(mesh.expressID, parts);
      });
      const seen = new Set<number>();
      const cache: Parameters<typeof readMeshParts>[3] = new Map();
      for (const id of viewableElementIds(api, model)) {
        const parts = readMeshParts(api, model, id, cache);
        if (!parts.length) continue;
        seen.add(id);
        const expected = reference.get(id)!;
        expect(parts.length).toBe(expected.length);
        parts.forEach((p, i) => {
          expect(p.geometryId).toBe(expected[i]!.id);
          expect(p.matrix).toEqual(expected[i]!.matrix);
          expect(
            [...p.indices].flatMap((index) => [
              p.positions[index * 3]!,
              p.positions[index * 3 + 1]!,
              p.positions[index * 3 + 2]!,
            ]),
          ).toEqual(expected[i]!.positions);
        });
        cache.clear();
      }
      expect(seen).toEqual(new Set(reference.keys()));
      expect(seen.size).toBeGreaterThan(3);
    } finally {
      api.CloseModel(model);
    }
  });
});

describe("geometry flow control", () => {
  it("waits for the correct chunk and prevents two in flight", async () => {
    const flow = new ModelLoadFlow();
    let accepted = false;
    const pending = flow.waitForChunk(2).then(() => {
      accepted = true;
    });
    expect(() => flow.waitForChunk(3)).toThrow("already in flight");
    flow.acknowledge(1);
    await Promise.resolve();
    expect(accepted).toBe(false);
    flow.acknowledge(2);
    await pending;
    expect(accepted).toBe(true);
    const next = flow.waitForChunk(3);
    flow.acknowledge(3);
    await next;
  });
  it("cancels a waiting chunk and also aborts an in-flight download", async () => {
    const flow = new ModelLoadFlow();
    const pending = flow.waitForChunk(1);
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    flow.cancel();
    await rejected;
    expect(flow.signal.aborted).toBe(true);
    expect(() => flow.check()).toThrow();
    expect(() => flow.waitForChunk(2)).toThrow();
  });
});

describe("scene memory accounting", () => {
  it("stores repeated placements once per material batch and keeps all instances", () => {
    const buffers = compactGeometry(
      new Float32Array([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1]),
      new Uint32Array([0, 1, 2]),
    );
    const part: IfcPart = {
      expressId: 1,
      geometryId: 5,
      ...buffers,
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      color: [1, 1, 1, 1],
    };
    const batches = planModelBatches([
      part,
      { ...part, expressId: 2 },
      { ...part, expressId: 3, color: [1, 1, 1, 0.5] },
    ]);
    expect(batches.map((b) => [b.vertices, b.indices, b.group.length])).toEqual(
      [
        [3, 3, 2],
        [3, 3, 1],
      ],
    );
    expect(batches[0]!.bytes).toBe((3 * 18 + 3 * 2) * 2 + 2 * 256);
  });
  it("uses a lower geometry budget on constrained devices", () => {
    expect(modelMemoryBudget(2)).toBeLessThan(modelMemoryBudget(4, true));
    expect(modelMemoryBudget(4, true)).toBeLessThan(modelMemoryBudget(8));
  });
});

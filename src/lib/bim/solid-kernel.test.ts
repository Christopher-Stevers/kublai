// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { createRequire } from "node:module";
import { newDesignElement, designSchema } from "./design";
import { elementMeshes } from "./cad-mesh";
import { evaluateSolid, type SolidOperation } from "./solid-kernel";
const require = createRequire(import.meta.url);
let kernel: ManifoldToplevel;
beforeAll(async () => {
  kernel = await Module({
    locateFile: () => require.resolve("manifold-3d/manifold.wasm"),
  });
  kernel.setup();
});
const box = (x = 0) => ({
  name: "Box",
  meshes: elementMeshes(newDesignElement("box", [x, 0, 0])),
});
describe("solid modelling with the real WASM kernel", () => {
  it.each([
    "pipe",
    "elbow",
    "tee",
    "valve",
    "pump",
    "tank",
    "equipment",
    "wall",
    "slab",
    "box",
    "profile",
  ] as const)("converts %s into a closed solid", (kind) => {
    const object = newDesignElement(kind, [0, 0, 0]);
    const result = evaluateSolid(kernel, {
      operation: "convert",
      objects: [{ name: kind, meshes: elementMeshes(object) }],
    });
    expect(result.volume).toBeGreaterThan(0);
  });
  it.each([
    ["union", 1.5],
    ["subtract", 0.5],
    ["intersect", 0.5],
  ] as [SolidOperation, number][])(
    "%s has the expected volume",
    (operation, volume) => {
      const result = evaluateSolid(kernel, {
        operation,
        objects: [box(), box(0.5)],
      });
      expect(result.volume).toBeCloseTo(volume, 5);
      expect(result.area).toBeGreaterThan(0);
      expect(
        designSchema.safeParse({
          elements: [
            { ...newDesignElement("solid", [0, 0, 0]), mesh: result.mesh },
          ],
          overrides: [],
        }).success,
      ).toBe(true);
    },
  );
  it("handles touching solids without an internal face", () => {
    const result = evaluateSolid(kernel, {
      operation: "union",
      objects: [box(), box(1)],
    });
    expect(result.volume).toBeCloseTo(2);
    expect(result.area).toBeCloseTo(10);
  });
  it("cuts a pipe-sized opening out of a wall", () => {
    const wall = newDesignElement("box", [0, 0, 0]),
      pipe = newDesignElement("pipe", [0, 0, 0]);
    pipe.size[1] = 2;
    pipe.diameter = 0.2;
    const result = evaluateSolid(kernel, {
      operation: "subtract",
      objects: [
        { name: "Wall", meshes: elementMeshes(wall) },
        { name: "Pipe", meshes: elementMeshes(pipe) },
      ],
    });
    expect(result.volume).toBeGreaterThan(0.968);
    expect(result.volume).toBeLessThan(0.97);
  });
  it("reports an empty intersection instead of deleting the selection", () => {
    expect(() =>
      evaluateSolid(kernel, {
        operation: "intersect",
        objects: [box(), box(4)],
      }),
    ).toThrow("no solid");
  });
  it("rejects open meshes", () => {
    expect(() =>
      evaluateSolid(kernel, {
        operation: "union",
        objects: [
          box(),
          {
            name: "Open sheet",
            meshes: [
              { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] },
            ],
          },
        ],
      }),
    ).toThrow("closed solid");
  });
  it("preserves precision at large site coordinates by using a nearby origin", () => {
    const origin: [number, number, number] = [1e7, 1e6, 1e7];
    const a = newDesignElement("box", origin),
      b = newDesignElement("box", [origin[0] + 0.5, origin[1], origin[2]]);
    expect(
      evaluateSolid(kernel, {
        operation: "intersect",
        objects: [a, b].map((e) => ({
          name: e.name,
          meshes: elementMeshes(e, origin),
        })),
      }).volume,
    ).toBeCloseTo(0.5, 5);
  });
  it("supports reflected geometry", () => {
    const reflected = {
      ...newDesignElement("box", [0.5, 0, 0]),
      scale: [-1, 1, 1] as [number, number, number],
    };
    expect(
      evaluateSolid(kernel, {
        operation: "union",
        objects: [
          box(),
          { name: "Mirrored", meshes: elementMeshes(reflected) },
        ],
      }).volume,
    ).toBeCloseTo(1.5);
  });
  it("rejects corrupt mesh indices and excessive payloads", () => {
    expect(
      designSchema.safeParse({
        elements: [
          {
            ...newDesignElement("solid", [0, 0, 0]),
            mesh: {
              positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
              indices: [0, 1, 9],
            },
          },
        ],
        overrides: [],
      }).success,
    ).toBe(false);
  });
});

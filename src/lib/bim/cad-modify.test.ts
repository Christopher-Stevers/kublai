import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createSketch, duplicateElements, objectMatrix } from "./cad-geometry";
import { assertSimpleOutline } from "./cad-outline-validation";
import {
  offsetOutline,
  roundOutline,
  meetLines,
  mirrorElements,
} from "./cad-modify";
import {
  bindDimension,
  dimensionValues,
  reconcileDimensions,
} from "./cad-dimensions";
import { makeComponent, insertComponent } from "./cad-components";
import { designSchema, newDesignElement, type ModelDesign } from "./design";
const rectangle = () =>
  createSketch(
    "rectangle",
    [
      [0, 0, 0],
      [1, 1, 0],
    ],
    "front",
  );
const line = (x = 0) =>
  createSketch(
    "line",
    [
      [x, 0, 0],
      [x + 2, 0, 0],
    ],
    "front",
  );
const area = (points: number[][]) =>
  Math.abs(
    points.reduce((n, p, i) => {
      const q = points[(i + 1) % points.length]!;
      return n + p[0]! * q[1]! - q[0]! * p[1]!;
    }, 0),
  ) / 2;
describe("CAD outline modifications", () => {
  it("offsets a closed outline outward independently of winding", () => {
    const a = rectangle(),
      b = { ...a, points: [...a.points!].reverse() };
    expect(area(offsetOutline(a, 0.25).points!)).toBeCloseTo(2.25);
    expect(area(offsetOutline(b, 0.25).points!)).toBeCloseTo(2.25);
    expect(area(offsetOutline(a, -0.25).points!)).toBeCloseTo(0.25);
  });
  it("offsets an open line left and right", () => {
    expect(offsetOutline(line(), 0.5).points).toEqual([
      [0, 0.5, 0],
      [2, 0.5, 0],
    ]);
    expect(offsetOutline(line(), -0.5).points).toEqual([
      [0, -0.5, 0],
      [2, -0.5, 0],
    ]);
  });
  it("uses physical distance after non-uniform scaling and reflection", () => {
    const source = {
      ...rectangle(),
      scale: [-2, 3, 1] as [number, number, number],
    };
    const result = offsetOutline(source, 0.25);
    expect(area(result.points!)).toBeCloseTo(2.5 * 3.5);
    expect(result.scale).toEqual([1, 1, 1]);
    const fillet = roundOutline(source, 0.1, "fillet");
    expect(area(fillet.points!)).toBeCloseTo(6 - (4 - Math.PI) * 0.1 ** 2, 3);
    expect(source.points).toEqual(rectangle().points);
  });
  it("rejects crossed profiles, touching edges and doubled-back outlines", () => {
    const invalid: [number, number, number][][] = [
      [
        [0, 0, 0],
        [2, 2, 0],
        [0, 2, 0],
        [1, 0, 0],
      ],
      [
        [0, 0, 0],
        [2, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
      ],
      [
        [0, 0, 0],
        [2, 0, 0],
        [2, 2, 0],
        [1, 0, 0],
        [0, 2, 0],
      ],
    ];
    for (const points of invalid) {
      expect(() => assertSimpleOutline(points, true)).toThrow("outline");
      expect(
        designSchema.safeParse({
          elements: [{ ...newDesignElement("profile", [0, 0, 0]), points }],
          overrides: [],
        }).success,
      ).toBe(false);
    }
    expect(() =>
      assertSimpleOutline(
        [
          [0, 0, 0],
          [1, 0, 0],
          [2, 0, 0],
          [2, 2, 0],
          [0, 2, 0],
        ],
        true,
      ),
    ).not.toThrow();
  });
  it("rejects collapsed offsets", () => {
    expect(() => offsetOutline(rectangle(), -0.6)).toThrow("collapses");
  });
  it("rounds and bevels corners to the requested size", () => {
    const rounded = roundOutline(rectangle(), 0.1, "fillet");
    expect(area(rounded.points!)).toBeCloseTo(1 - (4 - Math.PI) * 0.1 ** 2, 3);
    expect(area(roundOutline(rectangle(), 0.1, "chamfer").points!)).toBeCloseTo(
      0.98,
      5,
    );
    expect(
      designSchema.safeParse({ elements: [rounded], overrides: [] }).success,
    ).toBe(true);
  });
  it("rejects corner treatments that overlap", () => {
    expect(() => roundOutline(rectangle(), 0.6, "fillet")).toThrow("overlap");
  });
  it("extends and trims the nearest endpoint to another line", () => {
    const a = createSketch(
        "line",
        [
          [0, 0, 0],
          [1, 0, 0],
        ],
        "front",
      ),
      boundary = createSketch(
        "line",
        [
          [2, -1, 0],
          [2, 1, 0],
        ],
        "front",
      );
    expect(meetLines(a, boundary, true).points).toEqual([
      [0, 0, 0],
      [2, 0, 0],
    ]);
    const cut = createSketch(
      "line",
      [
        [0.25, -1, 0],
        [0.25, 1, 0],
      ],
      "front",
    );
    expect(meetLines(a, cut, false).points).toEqual([
      [0.25, 0, 0],
      [1, 0, 0],
    ]);
    expect(() => meetLines(a, boundary, false)).toThrow("Extend");
    expect(() => meetLines(a, cut, true)).toThrow("Trim");
  });
  it("rejects skew or parallel boundary lines", () => {
    const a = line(),
      parallel = { ...line(), position: [0, 1, 0] as [number, number, number] };
    expect(() => meetLines(a, parallel, true)).toThrow("Parallel");
    const skew = createSketch(
      "line",
      [
        [1, -1, 1],
        [1, 1, 1],
      ],
      "front",
    );
    expect(() => meetLines(a, skew, true)).toThrow("same plane");
  });
  it("reflects rotated, non-uniformly scaled geometry exactly", () => {
    const e = {
      ...newDesignElement("box", [3, 2, 1]),
      rotation: [13, 29, 42] as [number, number, number],
      scale: [2, 0.5, 3] as [number, number, number],
    };
    const copy = mirrorElements([e], 0, 1)[0]!;
    for (const point of [
      [0, 0, 0],
      [0.5, 0.5, 0.5],
      [-0.5, -0.5, -0.5],
    ]) {
      const before = new THREE.Vector3(
        ...(point as [number, number, number]),
      ).applyMatrix4(objectMatrix(e));
      const after = new THREE.Vector3(
        ...(point as [number, number, number]),
      ).applyMatrix4(objectMatrix(copy));
      expect(after.x).toBeCloseTo(2 - before.x, 8);
      expect(after.y).toBeCloseTo(before.y, 8);
      expect(after.z).toBeCloseTo(before.z, 8);
    }
  });
});
describe("dimensions and reusable assemblies", () => {
  function fixture() {
    const object = line();
    const initial = { elements: [object], overrides: [] };
    const dimension = bindDimension(
      createSketch(
        "dimension",
        [
          [0, 0, 0],
          [2, 0, 0],
        ],
        "front",
      ),
      initial,
    );
    return {
      object,
      dimension,
      doc: { ...initial, elements: [object, dimension] } as ModelDesign,
    };
  }
  it("updates a dimension when its snapped geometry is resized", () => {
    const { object, doc } = fixture();
    const resized = {
      ...doc,
      elements: doc.elements.map((e) =>
        e.id === object.id
          ? {
              ...e,
              points: [
                [0, 0, 0],
                [4, 0, 0],
              ] as [number, number, number][],
            }
          : e,
      ),
    };
    const result = reconcileDimensions(resized, doc);
    expect(dimensionValues(result.elements[1]!).label).toBe("4.00 m");
  });
  it("freezes the last position when the reference is deleted", () => {
    const { object, doc } = fixture();
    const moved = reconcileDimensions(
      {
        ...doc,
        elements: doc.elements.map((e) =>
          e.id === object.id
            ? { ...e, position: [8, 0, 0] as [number, number, number] }
            : e,
        ),
      },
      doc,
    );
    const after = reconcileDimensions(
      { ...moved, elements: moved.elements.filter((e) => e.id !== object.id) },
      moved,
    );
    expect(after.elements[0]!.dimension!.anchors).toEqual([null, null]);
    expect(after.elements[0]!.points![0]).toEqual([8, 0, 0]);
  });
  it("clones dimension associations only within the copied selection", () => {
    const { doc } = fixture(),
      copy = duplicateElements(doc.elements, [5, 0, 0]);
    expect(copy[1]!.dimension!.anchors![0]!.id).toBe(copy[0]!.id);
    expect(
      duplicateElements([doc.elements[1]!], [5, 0, 0])[0]!.dimension!.anchors,
    ).toEqual([null, null]);
  });
  it("preserves relative positions and remaps dimension references in components", () => {
    const { doc } = fixture(),
      component = makeComponent("Measured run", doc.elements),
      added = insertComponent(component, [10, 0, 0], "Pipework");
    expect(added[0]!.position).toEqual([10, 0, 0]);
    expect(added[0]!.layer).toBe("Pipework");
    expect(added[1]!.dimension!.anchors![0]!.id).toBe(added[0]!.id);
    expect(added[0]!.id).not.toBe(doc.elements[0]!.id);
  });
  it("keeps dimension offset perpendicular and physical on scaled geometry", () => {
    const e = {
      ...createSketch(
        "dimension",
        [
          [0, 0, 0],
          [1, 1, 0],
        ],
        "front",
      ),
      scale: [2, 1, 1] as [number, number, number],
    };
    const { a, b, start, end } = dimensionValues(e),
      matrix = objectMatrix(e);
    a.applyMatrix4(matrix);
    b.applyMatrix4(matrix);
    start.applyMatrix4(matrix);
    end.applyMatrix4(matrix);
    expect(a.distanceTo(start)).toBeCloseTo(0.2);
    expect(b.distanceTo(end)).toBeCloseTo(0.2);
    expect(start.clone().sub(a).dot(b.clone().sub(a))).toBeCloseTo(0);
  });
  it("detaches a dimension if referenced geometry changes topology", () => {
    const { doc, object } = fixture();
    const result = reconcileDimensions(
      {
        ...doc,
        elements: doc.elements.map((e) =>
          e.id === object.id
            ? {
                ...e,
                kind: "polyline" as const,
                points: [
                  [0, 0, 0],
                  [1, 0, 0],
                  [2, 1, 0],
                ] as [number, number, number][],
              }
            : e,
        ),
      },
      doc,
    );
    expect(result.elements[1]!.dimension!.anchors).toEqual([null, null]);
    expect(dimensionValues(result.elements[1]!).length).toBeCloseTo(2);
  });
  it("formats dimensions in user-selected units", () => {
    const dimension = createSketch(
      "dimension",
      [
        [0, 0, 0],
        [0.3048, 0, 0],
      ],
      "front",
    );
    dimension.dimension = { offset: 0.1, unit: "ft", precision: 2 };
    expect(dimensionValues(dimension).label).toBe("1.00 ft");
  });
});

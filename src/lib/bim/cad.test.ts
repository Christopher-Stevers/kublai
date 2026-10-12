import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  constrainPoint,
  createSketch,
  designLayers,
  duplicateElements,
  elementSnapPoints,
  isEditable,
  objectMatrix,
  planeAxes,
  transformElements,
  type CadPlane,
} from "./cad-geometry";
import { designSchema, emptyDesign, newDesignElement } from "./design";
import { designObject, disposeDesignObject } from "./design-geometry";
import { designDxf, parseCad, serializeCad } from "./cad-export";
import type { Point3 } from "./types";
const planes: CadPlane[] = ["top", "front", "right"];
const near = (actual: number[], expected: number[]) =>
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 6));
describe("CAD precision across views", () => {
  it.each(planes)(
    "keeps %s sketches at their world position and on their workplane",
    (plane) => {
      const { u, v, normal } = planeAxes(plane),
        first = new THREE.Vector3(12500, 3, 7200),
        last = first.clone().addScaledVector(u, 3).addScaledVector(v, 2);
      const sketch = createSketch(
          "rectangle",
          [first.toArray() as Point3, last.toArray() as Point3],
          plane,
        ),
        matrix = objectMatrix(sketch);
      expect(
        designSchema.safeParse({ ...emptyDesign(), elements: [sketch] })
          .success,
      ).toBe(true);
      const points = sketch.points!.map((p) =>
        new THREE.Vector3(...p).applyMatrix4(matrix),
      );
      near(points[0]!.toArray(), first.toArray());
      near(points[2]!.toArray(), last.toArray());
      for (const point of points)
        expect(point.clone().sub(first).dot(normal)).toBeCloseTo(0);
      const solid = designObject({
          ...sketch,
          kind: "profile",
          size: [1, 0.4, 1],
        }),
        bounds = new THREE.Box3().setFromObject(solid);
      expect(
        bounds.getSize(new THREE.Vector3()).getComponent(planeAxes(plane).axis),
      ).toBeCloseTo(0.4);
      disposeDesignObject(solid);
    },
  );
  it.each(planes)(
    "applies exact length and 45-degree constraints in %s",
    (plane) => {
      const { u, v } = planeAxes(plane),
        start = new THREE.Vector3(5000, 12, 9000),
        point = start.clone().addScaledVector(u, 2).addScaledVector(v, 1.5);
      const snapped = constrainPoint(point, start, plane, 0.05, 45, 5),
        delta = snapped.clone().sub(start);
      expect(delta.length()).toBeCloseTo(5);
      expect(Math.abs(delta.dot(u))).toBeCloseTo(Math.abs(delta.dot(v)));
      const ortho = constrainPoint(point, start, plane, 0.05, 90, 0).sub(start);
      expect(ortho.dot(v)).toBeCloseTo(0);
    },
  );
  it("snaps to transformed pipe endpoints and the actual centre of a circle", () => {
    const pipe = {
      ...newDesignElement("pipe", [10, 2, 30]),
      rotation: [0, 0, 90] as Point3,
      size: [0.1, 4, 0.1] as Point3,
    };
    const anchors = elementSnapPoints(pipe);
    near(anchors[0]!.point.toArray(), [12, 2, 30]);
    near(anchors[1]!.point.toArray(), [8, 2, 30]);
    const circle = createSketch(
      "circle",
      [
        [12, 3, 40],
        [14, 3, 40],
      ],
      "top",
    );
    near(
      elementSnapPoints(circle)
        .find((p) => p.kind === "Centre")!
        .point.toArray(),
      [12, 3, 40],
    );
  });
  it("rotates a mixed new/imported selection around one pivot without accumulating source offsets", () => {
    const e = newDesignElement("equipment", [2, 0, 0]),
      doc = {
        ...emptyDesign(),
        elements: [e],
        overrides: [
          {
            expressId: 5,
            name: "Source",
            translation: [1, 0, 0] as Point3,
            rotation: [0, 0, 0] as Point3,
            deleted: false,
          },
        ],
      };
    const result = transformElements(
      doc,
      [e.id, "source:5"],
      [0, 1, 0],
      [0, 0, 90],
      [0, 0, 0],
      () => [3, 0, 0],
    );
    near(result.elements[0]!.position, [0, 3, 0]);
    near(result.overrides[0]!.translation, [-2, 4, 0]);
    near(
      new THREE.Vector3(1, 0, 0)
        .applyMatrix4(
          objectMatrix({ ...result.elements[0]!, position: [0, 0, 0] }),
        )
        .toArray(),
      [0, 1, 0],
    );
  });
  it("makes independent, evenly spaced copies without moving the originals", () => {
    const e = newDesignElement("pipe", [10, 2, 3]),
      copies = duplicateElements([e], [2, 0, 0], 3);
    expect(copies.map((e) => e.position[0])).toEqual([12, 14, 16]);
    expect(new Set(copies.map((e) => e.id)).size).toBe(3);
    expect(e.position[0]).toBe(10);
  });
  it("preserves legacy documents and validates sketch and layer integrity", () => {
    const e = newDesignElement("equipment", [0, 0, 0]),
      doc = { elements: [e], overrides: [] };
    expect(designLayers(doc)).toEqual([
      { name: "Design", visible: true, locked: false },
    ]);
    expect(
      isEditable(
        { ...doc, layers: [{ name: "Design", visible: true, locked: true }] },
        e,
      ),
    ).toBe(false);
    expect(designSchema.safeParse({ ...doc, layers: [] }).success).toBe(false);
    expect(
      designSchema.safeParse({ ...doc, elements: [{ ...e, kind: "line" }] })
        .success,
    ).toBe(false);
    expect(
      designSchema.safeParse({
        ...doc,
        elements: [
          {
            ...newDesignElement("profile", [0, 0, 0]),
            points: [
              [0, 0, 0],
              [1, 0, 0],
              [2, 0, 0],
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
describe("portable CAD documents", () => {
  it("round-trips all data and rejects applying source edits to another model", () => {
    const doc = {
      ...emptyDesign(),
      elements: [
        createSketch(
          "polyline",
          [
            [0, 0, 0],
            [2, 0, 0],
            [2, 0, 3],
          ],
          "top",
        ),
      ],
      layers: [{ name: "Design", visible: false, locked: true }],
    };
    expect(parseCad(serializeCad(doc, "model-a"), "model-a")).toEqual(doc);
    const override = {
      expressId: 5,
      name: "",
      translation: [0, 0, 0] as Point3,
      rotation: [0, 0, 0] as Point3,
      deleted: false,
    };
    expect(() =>
      parseCad(
        serializeCad({ ...doc, overrides: [override] }, "model-a"),
        "model-b",
      ),
    ).toThrow("different source model");
  });
  it("exports metre-based 3D linework with CAD Z-up coordinates", () => {
    const doc = {
      ...emptyDesign(),
      elements: [
        createSketch(
          "line",
          [
            [10, 2, 30],
            [14, 5, 35],
          ],
          "front",
        ),
      ],
    };
    const text = designDxf(doc);
    expect(text).toContain("$INSUNITS\n70\n6\n");
    expect(text).toContain("10\n10\n20\n-30\n30\n2\n");
    expect(text).toContain("10\n14\n20\n-35\n30\n5\n");
    expect(text.endsWith("0\nEOF\n")).toBe(true);
  });
});

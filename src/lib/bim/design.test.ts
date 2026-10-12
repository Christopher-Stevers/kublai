import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  designKinds,
  designSchema,
  emptyDesign,
  newDesignElement,
} from "./design";
import { designObject, disposeDesignObject } from "./design-geometry";
describe("editable model geometry", () => {
  it.each(Object.keys(designKinds) as (keyof typeof designKinds)[])(
    "builds finite pickable %s geometry",
    (kind) => {
      const element = newDesignElement(kind, [12, 3, 4]);
      const object = designObject(element);
      object.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(object),
        size = box.getSize(new THREE.Vector3());
      expect(box.isEmpty()).toBe(false);
      expect(size.toArray().every((n) => Number.isFinite(n) && n > 0)).toBe(
        true,
      );
      expect(object.userData.designId).toBe(element.id);
      disposeDesignObject(object);
    },
  );
  it("pipe diameter and length drive the rendered shape", () => {
    const element = {
      ...newDesignElement("pipe", [0, 0, 0]),
      diameter: 0.2,
      size: [0.2, 3, 0.2] as [number, number, number],
    };
    const object = designObject(element);
    const size = new THREE.Box3()
      .setFromObject(object)
      .getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(0.2);
    expect(size.y).toBeCloseTo(3);
    expect(size.z).toBeCloseTo(0.2);
    disposeDesignObject(object);
  });
  it("rejects invalid dimensions and duplicate element identity", () => {
    const element = newDesignElement("pipe", [0, 0, 0]);
    expect(
      designSchema.safeParse({
        ...emptyDesign(),
        elements: [element, { ...element }],
      }).success,
    ).toBe(false);
    expect(
      designSchema.safeParse({
        ...emptyDesign(),
        elements: [{ ...element, diameter: -1 }],
      }).success,
    ).toBe(false);
  });
});

import { Vector3, Box3 } from "three";
import {
  newDesignElement,
  type CadComponent,
  type DesignElement,
} from "./design";
import type { Point3 } from "./types";
import { remapDimension } from "./cad-geometry";
export function makeComponent(
  name: string,
  objects: DesignElement[],
): CadComponent {
  if (!name.trim()) throw Error("Name the component first.");
  if (!objects.length)
    throw Error("Select the design objects to save as a component.");
  const origin = new Box3()
    .setFromPoints(objects.map((e) => new Vector3(...e.position)))
    .getCenter(new Vector3());
  const ids = new Map(objects.map((e) => [e.id, e.id]));
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    elements: objects.map((e) => ({
      ...e,
      dimension: remapDimension(e, ids),
      position: new Vector3(...e.position).sub(origin).toArray() as Point3,
    })),
  };
}
export function insertComponent(
  component: CadComponent,
  position: Point3,
  layer: string,
): DesignElement[] {
  const ids = new Map(
    component.elements.map((e) => [e.id, crypto.randomUUID()]),
  );
  return component.elements.map((e) => ({
    ...e,
    id: ids.get(e.id)!,
    dimension: remapDimension(e, ids),
    layer,
    position: new Vector3(...e.position)
      .add(new Vector3(...position))
      .toArray() as Point3,
  }));
}
/** A small editable starter, with actual dimensions rather than decorative icons. */
export function pipeRackComponent(): CadComponent {
  const elements: DesignElement[] = [];
  for (const x of [-0.6, 0.6]) {
    const post = newDesignElement("box", [x, 1.1, 0]);
    post.name = "Rack upright";
    post.size = [0.05, 2.2, 0.05];
    post.material = "Steel";
    post.color = "#94a3b8";
    elements.push(post);
  }
  for (const y of [0.5, 1.2, 1.9]) {
    const rail = newDesignElement("box", [0, y, 0]);
    rail.name = "Rack crossbar";
    rail.size = [1.25, 0.05, 0.05];
    rail.material = "Steel";
    rail.color = "#94a3b8";
    elements.push(rail);
  }
  return {
    id: crypto.randomUUID(),
    name: "Pipe rack · 1.25 × 2.2 m",
    elements,
  };
}

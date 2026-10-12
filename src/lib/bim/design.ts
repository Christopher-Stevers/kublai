import { z } from "zod";
import { point3Schema } from "./types";
export const designKinds = {
  pipe: "Pipe",
  duct: "Duct",
  elbow: "Elbow",
  tee: "Tee",
  valve: "Valve",
  pump: "Pump",
  tank: "Tank",
  equipment: "Equipment",
  wall: "Wall",
  slab: "Slab",
  box: "Custom object",
  line: "Line",
  polyline: "Polyline",
  rectangle: "Rectangle",
  circle: "Circle",
  profile: "Extruded profile",
} as const;
export type DesignKind = keyof typeof designKinds;
const boundedPoint = point3Schema.refine(
  (p) => p.every((v) => Math.abs(v) <= 1e8),
  "Coordinates and rotations must be within the supported range.",
);
const dimension = z.number().finite().min(0.001).max(1000);
export const designElementSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    kind: z.enum(Object.keys(designKinds) as DesignKind[]),
    position: boundedPoint,
    rotation: boundedPoint,
    size: z.tuple([dimension, dimension, dimension]),
    diameter: dimension,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    system: z.string().max(120),
    material: z.string().max(120),
    notes: z.string().max(3000),
    layer: z.string().trim().min(1).max(80).optional(),
    // Sketch vertices use the element's local XY plane; placement and rotation
    // retain the same world-metre convention as all model objects.
    points: z.array(boundedPoint).min(2).max(512).optional(),
  })
  .superRefine((element, ctx) => {
    if (
      ["line", "polyline", "rectangle", "circle", "profile"].includes(
        element.kind,
      ) &&
      (!element.points ||
        element.points.length < (element.kind === "profile" ? 3 : 2))
    )
      ctx.addIssue({
        code: "custom",
        message: "A sketch needs vertices before it can be saved.",
      });
    if (element.kind === "profile" && element.points) {
      const points = element.points;
      const area =
        Math.abs(
          points.reduce((sum, p, i) => {
            const q = points[(i + 1) % points.length]!;
            return sum + p[0] * q[1] - q[0] * p[1];
          }, 0),
        ) / 2;
      if (area < 1e-8 || points.some((p) => Math.abs(p[2]) > 1e-6))
        ctx.addIssue({
          code: "custom",
          message: "An extrusion needs a flat outline with a non-zero area.",
        });
    }
  });
export type DesignElement = z.infer<typeof designElementSchema>;
export const designOverrideSchema = z.object({
  expressId: z.number().int().positive(),
  name: z.string().max(160),
  translation: boundedPoint,
  rotation: boundedPoint,
  deleted: z.boolean(),
});
export type DesignOverride = z.infer<typeof designOverrideSchema>;
export const designSchema = z
  .object({
    elements: z.array(designElementSchema).max(2000),
    overrides: z.array(designOverrideSchema).max(5000),
    layers: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(80),
          visible: z.boolean(),
          locked: z.boolean(),
        }),
      )
      .max(100)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.elements.reduce((count, e) => count + (e.points?.length ?? 0), 0) >
      50000
    )
      ctx.addIssue({
        code: "custom",
        message:
          "This design exceeds 50,000 sketch vertices. Split it into separate models.",
      });
    if (
      new Set(value.elements.map((e) => e.id)).size !== value.elements.length ||
      new Set(value.overrides.map((e) => e.expressId)).size !==
        value.overrides.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Each element must have a unique ID.",
      });
    const names = value.layers?.map((layer) => layer.name) ?? [];
    if (new Set(names).size !== names.length)
      ctx.addIssue({ code: "custom", message: "Layer names must be unique." });
    if (
      value.layers &&
      value.elements.some((e) => !names.includes(e.layer ?? "Design"))
    )
      ctx.addIssue({
        code: "custom",
        message: "Every object must belong to an existing layer.",
      });
  });
export type ModelDesign = z.infer<typeof designSchema>;
export type SavedModelDesign = {
  revision: number;
  design: ModelDesign;
  updatedAt: string | null;
  updatedBy: string | null;
};
export const emptyDesign = (): ModelDesign => ({ elements: [], overrides: [] });
export function newDesignElement(
  kind: DesignKind,
  position: [number, number, number],
): DesignElement {
  const round = ["pipe", "elbow", "tee", "valve"].includes(kind);
  return {
    id: crypto.randomUUID(),
    kind,
    name: designKinds[kind],
    position,
    rotation: [0, 0, 0],
    size:
      kind === "wall"
        ? [3, 2.7, 0.15]
        : kind === "slab"
          ? [3, 0.2, 3]
          : round
            ? [0.1, 1, 0.1]
            : kind === "duct"
              ? [0.4, 1, 0.3]
              : [1, 1, 1],
    diameter: 0.1,
    color: round ? "#38bdf8" : "#f59e0b",
    system: "",
    material: "",
    notes: "",
    layer: "Design",
    ...(["line", "polyline", "rectangle", "circle", "profile"].includes(kind)
      ? {
          points:
            kind === "rectangle" || kind === "profile"
              ? [
                  [0, 0, 0],
                  [1, 0, 0],
                  [1, 1, 0],
                  [0, 1, 0],
                  [0, 0, 0],
                ]
              : kind === "circle"
                ? Array.from({ length: 65 }, (_, i) => [
                    Math.cos((i * Math.PI) / 32),
                    Math.sin((i * Math.PI) / 32),
                    0,
                  ])
                : [
                    [0, 0, 0],
                    [1, 1, 0],
                  ],
        }
      : {}),
  };
}
